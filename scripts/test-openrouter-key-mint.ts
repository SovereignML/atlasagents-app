// Smoke test for getOrMintInstanceOpenRouterKey + the encrypted at-rest
// roundtrip on the new instances.openRouterKey{Id,Enc} columns.
//
// Verifies:
//   1. First call mints exactly once and persists keyId + ciphertext.
//   2. Second call (row now has openRouterKeyEnc) decrypts and returns the
//      same plaintext, with no additional mint call.
//   3. Concurrent calls into the helper for the same instance produce only
//      one mint when the row already has a key — i.e. the cache path is
//      the steady-state behaviour. (We don't claim per-instance lock
//      ordering here; that's enforced upstream by withInstanceLock in the
//      provisioner. This test is about the helper's own invariants.)
//
// Mocks `mintRuntimeKey` with a counter so no OpenRouter call is made.
// Cleans up the inserted instance row at the end.

import { randomUUID } from "node:crypto"
import { getOrMintInstanceOpenRouterKey } from "@/lib/provisioner"
import type { mintRuntimeKey as RealMintFn } from "@/lib/openrouter-provisioning"
import {
  db,
  instances,
  regions,
  serverConfigs,
  teams,
  users,
  eq,
} from "@/db"

async function main() {
  const fail: string[] = []

  // We need a real users row, a real regions row, and a real serverConfigs
  // row because instances FKs to all three (NOT NULL). Reuse whatever the
  // seed put in place rather than inventing fixtures.
  let region = await db.query.regions.findFirst()
  if (!region) {
    const inserted = await db
      .insert(regions)
      .values({ slug: "test-region", name: "Test", country: "US", flag: "🧪" })
      .returning()
    region = inserted[0]
    if (!region) throw new Error("failed to insert fallback region")
  }
  let server = await db.query.serverConfigs.findFirst()
  if (!server) {
    const inserted = await db
      .insert(serverConfigs)
      .values({
        slug: "test-cfg",
        category: "shared",
        label: "Test",
        vcpu: 1,
        ramGb: 1,
        storageGb: 25,
        priceMonthly: 5,
        priceYearly: 50,
      })
      .returning()
    server = inserted[0]
    if (!server) throw new Error("failed to insert fallback serverConfig")
  }

  // Throwaway user — unique email per run.
  const testEmail = `openrouter-key-test-${Date.now()}@example.invalid`
  const [user] = await db
    .insert(users)
    .values({ email: testEmail, name: "OpenRouter Key Test" })
    .returning()

  // Throwaway team — agents are team-scoped.
  const [team] = await db
    .insert(teams)
    .values({ name: "OpenRouter Key Test Team", ownerId: user.id })
    .returning()

  // Throwaway instance — minimal required fields, no real provisioning.
  const slug = `or-key-test-${randomUUID().slice(0, 8)}`
  const [inst] = await db
    .insert(instances)
    .values({
      userId: user.id,
      teamId: team.id,
      name: "or-key-test",
      slug,
      regionId: region.id,
      serverConfigId: server.id,
      storageGb: 25,
      status: "pending",
    })
    .returning()

  try {
    let mintCalls = 0
    const fakeMint: typeof RealMintFn = async ({ label }) => {
      mintCalls++
      return { keyId: `fake-id-${mintCalls}`, key: `sk-or-test-${label}-${mintCalls}` }
    }

    // 1) First call mints.
    const key1 = await getOrMintInstanceOpenRouterKey(inst, fakeMint)
    if (mintCalls !== 1) fail.push(`expected 1 mint call after first, got ${mintCalls}`)
    if (!key1.startsWith("sk-or-test-")) fail.push(`unexpected key shape: ${key1}`)

    // Row should now carry both columns.
    const after1 = await db.query.instances.findFirst({
      where: eq(instances.id, inst.id),
      columns: { openRouterKeyId: true, openRouterKeyEnc: true },
    })
    if (!after1?.openRouterKeyId) fail.push("openRouterKeyId not persisted after first call")
    if (!after1?.openRouterKeyEnc) fail.push("openRouterKeyEnc not persisted after first call")
    // Ciphertext shape: <b64 iv>:<b64 ct>:<b64 tag>
    if (after1?.openRouterKeyEnc && after1.openRouterKeyEnc.split(":").length !== 3) {
      fail.push(
        `openRouterKeyEnc malformed (expected iv:ct:tag), got: ${after1.openRouterKeyEnc}`,
      )
    }

    // 2) Second call hits the cache path — no new mint, same plaintext.
    // We re-load the instance row so the helper sees the persisted ciphertext.
    const reloaded = await db.query.instances.findFirst({ where: eq(instances.id, inst.id) })
    if (!reloaded) throw new Error("instance row vanished between calls")
    const key2 = await getOrMintInstanceOpenRouterKey(reloaded, fakeMint)
    if (mintCalls !== 1) fail.push(`expected 1 mint call after second (cached), got ${mintCalls}`)
    if (key2 !== key1) fail.push(`cached key (${key2}) ≠ original (${key1})`)

    // 3) Ten concurrent reads on the cached row — still no extra mints.
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () => getOrMintInstanceOpenRouterKey(reloaded, fakeMint)),
    )
    if (mintCalls !== 1) fail.push(`expected 1 mint call after concurrent reads, got ${mintCalls}`)
    if (concurrent.some((k) => k !== key1)) {
      fail.push("concurrent cached reads returned divergent keys")
    }
  } finally {
    // Cleanup: drop instance (cascade removes anything else), then the user.
    await db.delete(instances).where(eq(instances.id, inst.id))
    await db.delete(users).where(eq(users.id, user.id))
  }

  if (fail.length === 0) {
    console.log("✅ PASS — getOrMintInstanceOpenRouterKey: mint-once + cache + at-rest encrypt all correct")
  } else {
    console.error("❌ FAIL:", fail.join("; "))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
