/**
 * scripts/bootstrap-shared-host.ts
 *
 * One-shot bootstrap for a shared host. Idempotent: if a BotHost row
 * already exists with capacity in the target region, it exits early.
 * Otherwise it creates a VM via the configured provider, polls until
 * SSH is reachable and Docker is up, then inserts a BotHost row.
 *
 * Usage: npm run bootstrap:host
 *
 * Env required:
 *   - VM_PROVIDER              (optional, default "linode")
 *   - LINODE_API_TOKEN         linode account token (when using linode)
 *   - SSH_FLEET_PRIVATE_KEY    private key the web app will use to SSH in
 *   - SSH_FLEET_PUBLIC_KEY     matching public key baked into authorized_keys
 *   - BOT_RUNTIME_IMAGE        (optional) image to pre-pull on the host
 */
import "dotenv/config"
import { randomBytes } from "node:crypto"
import { db, eq, botHosts, sql } from "../src/db"
import { pool } from "../src/db"
import { getVmProvider } from "../src/lib/vm-provider"
import { sshRun } from "../src/lib/ssh"

const TARGET_REGION = "us-east"
const TARGET_PLAN = "g6-standard-2"
const DEFAULT_CAPACITY = 15

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`missing env: ${name}`)
    process.exit(1)
  }
  return v
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  opts: { timeoutMs: number; intervalMs: number; label: string }
): Promise<T> {
  const start = Date.now()
  let attempt = 0
  while (Date.now() - start < opts.timeoutMs) {
    attempt += 1
    try {
      const result = await fn()
      if (result) return result
    } catch (err) {
      if (attempt % 5 === 0) {
        console.log(`  ... still waiting on ${opts.label} (attempt ${attempt}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    await sleep(opts.intervalMs)
  }
  throw new Error(`timeout waiting on ${opts.label} after ${opts.timeoutMs}ms`)
}

async function main(): Promise<void> {
  requireEnv("SSH_FLEET_PRIVATE_KEY")
  const publicKey = requireEnv("SSH_FLEET_PUBLIC_KEY")
  const provider = getVmProvider()

  const existing = await db
    .select({
      id: botHosts.id,
      ipAddress: botHosts.ipAddress,
      capacity: botHosts.capacity,
      instanceCount: sql<number>`(select count(*) from "Instance" where "botHostId" = ${botHosts.id})`,
    })
    .from(botHosts)
    .where(eq(botHosts.region, TARGET_REGION))

  const withCapacity = existing.find((h) => Number(h.instanceCount) < h.capacity)
  if (withCapacity) {
    console.log(`BotHost ${withCapacity.id} already ready at ${withCapacity.ipAddress} (${withCapacity.instanceCount}/${withCapacity.capacity} used) -- nothing to do`)
    return
  }

  const label = `sml-shared-${Date.now().toString(36)}`
  const rootPass = randomBytes(24).toString("base64")

  console.log(`Creating VM (${TARGET_PLAN} in ${TARGET_REGION}, label=${label}) ...`)
  const vm = await provider.createVM({
    label,
    plan: TARGET_PLAN,
    region: TARGET_REGION,
    rootPassword: rootPass,
    authorizedKeys: [publicKey],
    tags: ["sovereignml", "shared-host"],
  })
  console.log(`  vm_id=${vm.id} ipv4=${vm.ipv4.join(",")}`)

  console.log(`Waiting for VM to report 'running' ...`)
  const running = await pollUntil(
    async () => {
      const fresh = await provider.getVM(vm.id)
      return fresh.status === "running" ? fresh : null
    },
    { timeoutMs: 10 * 60_000, intervalMs: 10_000, label: "vm running" }
  )
  const ip = running.ipv4[0]
  if (!ip) throw new Error(`VM ${running.id} has no ipv4`)
  console.log(`  status=running ip=${ip}`)

  console.log(`Waiting for SSH + docker ...`)
  await pollUntil(
    async () => {
      const r = await sshRun({ host: ip }, "docker --version")
      if (r.code === 0 && r.stdout.toLowerCase().includes("docker")) return r.stdout.trim()
      return null
    },
    { timeoutMs: 10 * 60_000, intervalMs: 10_000, label: "ssh+docker" }
  )

  const [botHost] = await db
    .insert(botHosts)
    .values({
      label,
      vmId: vm.id,
      ipAddress: ip,
      region: TARGET_REGION,
      plan: TARGET_PLAN,
      capacity: DEFAULT_CAPACITY,
      status: "ready",
    })
    .returning()
  console.log(`BotHost ${botHost.id} ready at ${ip}`)
}

main()
  .catch((err) => {
    console.error("bootstrap failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await pool.end()
  })
