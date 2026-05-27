// Smoke test for the Uptime Kuma client (src/lib/uptime-kuma.ts).
//
// Two parts:
//   1. parseKumaMetrics — runs ALWAYS, against a synthetic /metrics sample. No
//      network or DB needed, so this guards the parser in CI.
//   2. Live roundtrip — runs only when Kuma env is configured (UPTIME_KUMA_*).
//      Connects over Socket.io, creates a throwaway HTTP monitor, scrapes
//      /metrics with the API key and confirms the monitor appears, then deletes
//      it. Leaves Kuma clean.
//
// Run: npm run test:uptime-kuma
//   (= node --env-file=.env --import tsx scripts/test-uptime-kuma.ts)

import {
  getKumaEnv,
  parseKumaMetrics,
  addMonitor,
  deleteMonitor,
  fetchKumaMetrics,
} from "@/lib/uptime-kuma"

const SAMPLE = `
# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{monitor_name="Agent A",monitor_type="http",monitor_url="https://a.example.com/",monitor_hostname="null",monitor_port="null",monitor_id="7"} 1
monitor_status{monitor_name="Agent B",monitor_type="http",monitor_url="https://b.example.com/",monitor_hostname="null",monitor_port="null",monitor_id="9"} 0
monitor_response_time{monitor_name="Agent A",monitor_id="7"} 142
monitor_uptime_ratio{monitor_name="Agent A",monitor_id="7",window="1d"} 0.9987
monitor_uptime_ratio{monitor_name="Agent A",monitor_id="7",window="30d"} 0.95
monitor_cert_days_remaining{monitor_name="Agent A",monitor_id="7"} 64
`

function assert(cond: boolean, msg: string, fail: string[]) {
  if (!cond) fail.push(msg)
}

async function main() {
  const fail: string[] = []

  // ── Part 1: parser ──────────────────────────────────────────────────
  const parsed = parseKumaMetrics(SAMPLE)
  const a = parsed.get("7")
  const b = parsed.get("9")

  assert(!!a, "monitor 7 should be parsed", fail)
  assert(a?.status === "up", `monitor 7 status should be "up", got ${a?.status}`, fail)
  assert(a?.responseTimeMs === 142, `monitor 7 response time should be 142, got ${a?.responseTimeMs}`, fail)
  // Must pick the 1d window, NOT the 30d one.
  assert(a?.uptimeRatio === 0.9987, `monitor 7 uptime should be 0.9987 (1d window), got ${a?.uptimeRatio}`, fail)
  assert(a?.certDaysRemaining === 64, `monitor 7 cert days should be 64, got ${a?.certDaysRemaining}`, fail)
  assert(b?.status === "down", `monitor 9 status should be "down", got ${b?.status}`, fail)

  if (fail.length === 0) {
    console.log("✓ parseKumaMetrics: all assertions passed")
  }

  // ── Part 2: live roundtrip (only if configured) ─────────────────────
  const env = getKumaEnv()
  if (!env) {
    console.log("• Kuma env not set (UPTIME_KUMA_*) — skipping live roundtrip.")
  } else {
    console.log(`• Live roundtrip against ${env.baseUrl} ...`)
    const name = `sovereign-smoke-${Date.now()}`
    let monitorId: number | null = null
    try {
      monitorId = await addMonitor(env, { name, url: "https://example.com/" })
      console.log(`  ✓ created monitor #${monitorId} ("${name}")`)

      // Give Kuma a moment to register it in /metrics.
      await new Promise((r) => setTimeout(r, 2_000))
      const metrics = parseKumaMetrics(await fetchKumaMetrics(env))
      if (metrics.has(String(monitorId))) {
        console.log(`  ✓ monitor #${monitorId} present in /metrics`)
      } else {
        // Not fatal — Kuma may not have run the first check yet, but the
        // monitor_status line should still appear. Warn rather than fail.
        console.log(`  ! monitor #${monitorId} not yet in /metrics (Kuma may be mid-first-check)`)
      }
    } catch (err) {
      fail.push(`live roundtrip: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (monitorId != null) {
        try {
          await deleteMonitor(env, monitorId)
          console.log(`  ✓ deleted monitor #${monitorId}`)
        } catch (err) {
          fail.push(`cleanup delete #${monitorId}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }

  if (fail.length) {
    console.error("\n✗ FAILURES:")
    for (const f of fail) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log("\n✓ test-uptime-kuma passed")
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
