/**
 * scripts/bake-golden-image.ts
 *
 * Creates a Linode "golden image" with Node.js, Caddy, and OpenClaw
 * pre-installed. VMs booted from this image skip the 8-minute cloud-init
 * bootstrap entirely.
 *
 * Usage:  npx tsx scripts/bake-golden-image.ts
 *
 * Env required:
 *   LINODE_API_TOKEN
 *   SSH_FLEET_PRIVATE_KEY / SSH_FLEET_PUBLIC_KEY
 *
 * Output: prints the image ID (e.g. private/12345) to stdout. Add it
 *         to .env as LINODE_GOLDEN_IMAGE=private/12345.
 */
import "dotenv/config"
import { LinodeProvider } from "../src/lib/linode"
import {
  buildBootstrapScript,
  sshWaitReady,
  sshRun,
  sshPollBootstrap,
} from "../src/lib/ssh"
import {
  OPENCLAW_VERSION,
  OPENCLAW_VPS_MIN_NODE,
} from "../src/lib/openclaw"
import crypto from "node:crypto"

const BAKE_REGION = process.env.BAKE_REGION ?? "us-east"
const BAKE_PLAN = process.env.BAKE_PLAN ?? "g6-nanode-1"

async function main() {
  const provider = new LinodeProvider()
  const rootPassword =
    "Bake" + crypto.randomBytes(16).toString("hex") + "!"

  console.log(`[bake] Creating temporary Linode (${BAKE_PLAN} in ${BAKE_REGION})...`)

  const bootstrapScript = buildBootstrapScript({
    openclawVersion: OPENCLAW_VERSION(),
    minNodeVersion: OPENCLAW_VPS_MIN_NODE,
  })

  const publicKey = process.env.SSH_FLEET_PUBLIC_KEY
  const vm = await provider.createVM({
    label: `golden-bake-${Date.now()}`,
    plan: BAKE_PLAN,
    region: BAKE_REGION,
    rootPassword,
    authorizedKeys: publicKey ? [publicKey] : undefined,
    tags: ["sovereignml", "golden-bake"],
    userData: bootstrapScript,
  })

  console.log(`[bake] VM ${vm.id} created. Waiting for boot...`)

  let ipAddress: string | undefined
  const started = Date.now()
  while (Date.now() - started < 180_000) {
    const info = await provider.getVM(vm.id)
    if (info.status === "running" && info.ipv4?.[0]) {
      ipAddress = info.ipv4[0]
      break
    }
    await new Promise((r) => setTimeout(r, 3_000))
  }
  if (!ipAddress) {
    throw new Error(`VM ${vm.id} never reached running state`)
  }

  console.log(`[bake] VM online at ${ipAddress}. Waiting for SSH...`)
  await sshWaitReady({ host: ipAddress })

  console.log(`[bake] SSH ready. Polling cloud-init bootstrap (this takes ~8 min)...`)
  await sshPollBootstrap({ host: ipAddress })

  console.log(`[bake] Bootstrap complete. Verifying installation...`)
  const verify = await sshRun({ host: ipAddress }, "openclaw --version && node -v && caddy version")
  console.log(`[bake] ${verify.stdout.trim()}`)

  console.log(`[bake] Cleaning up before image capture...`)
  await sshRun({ host: ipAddress }, [
    "rm -f /tmp/bootstrap.status /tmp/bootstrap.log",
    "apt-get clean",
    "rm -rf /var/cache/apt/archives/*.deb",
    "rm -rf /tmp/* /var/tmp/*",
    "journalctl --vacuum-time=1s",
    "sync",
  ].join(" && "))

  console.log(`[bake] Powering down VM for clean image capture...`)
  await sshRun({ host: ipAddress }, "shutdown -h now").catch(() => {})
  await new Promise((r) => setTimeout(r, 15_000))

  console.log(`[bake] Capturing disk image...`)
  const diskId = await provider.getFirstDiskId(vm.id)
  const image = await provider.captureImage({
    linodeId: vm.id,
    diskId,
    label: `sovereignml-golden-${new Date().toISOString().slice(0, 10)}`,
    description: `Node ${OPENCLAW_VPS_MIN_NODE}+, Caddy, OpenClaw ${OPENCLAW_VERSION()}, Ubuntu 24.04`,
    tags: ["sovereignml", "golden"],
  })

  console.log(`[bake] Image ${image.id} creating... waiting for availability...`)
  const ready = await provider.waitForImage(image.id)
  console.log(`[bake] Image ready: ${ready.id} (${ready.size} MB)`)

  console.log(`[bake] Deleting temporary Linode ${vm.id}...`)
  await provider.deleteVM(vm.id)

  console.log(`\n=== Golden image created ===`)
  console.log(`Add to .env: LINODE_GOLDEN_IMAGE=${ready.id}`)
}

main().catch((err) => {
  console.error("[bake] FATAL:", err)
  process.exit(1)
})
