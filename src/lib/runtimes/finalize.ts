/**
 * Post-install finalize: the per-instance-INDEPENDENT work that makes a later
 * claim (warm pool) or deploy (BYOS) fast.
 *
 * Lifted out of warm-pool.ts so the BYOS connect-time prebake can run exactly
 * the same steps. It has to live outside warm-pool.ts because that module
 * pulls in the database, and the prebake builders are pure — unit tests in
 * this repo do no DB and no network.
 *
 * Nothing here depends on an Instance row, which is the whole point: it runs
 * on a pooled VM before anyone claims it, and on a customer's BYOS box before
 * they have picked an engine.
 */

import { getRuntime, type RuntimeId } from "@/lib/runtimes"

/**
 * Bake-finalize: the slow-once, per-instance-INDEPENDENT work, run once the box
 * has bootstrapped so the eventual claim is fast. Idempotent.
 *  - Hermes: warm the venv + scaffold config via `setup --quick` + `doctor`
 *    (the expensive CLI cold starts).
 *  - Both: install + enable the gateway's systemd unit so claim only rewrites
 *    config and restarts, never installs.
 * The chat UI (AgentWebUI Lite) needs no warm-up: it starts in about a second,
 * and its unit is written at claim with the customer's settings.
 * Everything is best-effort (`|| true`): the authoritative config + start still
 * happens at claim, so a warmup miss only costs a little latency, never breaks.
 */
export function buildBakeFinalizeScript(runtimeId: RuntimeId): string {
  const runtime = getRuntime(runtimeId)
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
  const unitB64 = Buffer.from(runtime.renderSystemdUnit(), "utf8").toString("base64")

  let hermesWarm = ""
  if (runtime.id === "hermes") {
    const runAs = (sub: string) =>
      `sudo -u ${q(runtime.paths.systemUser)} env HOME=${q(runtime.paths.installDir)} ${q(runtime.cliBinary)} ${sub} || true`
    hermesWarm = `
echo "=== bake: hermes warmup ==="
${runAs("setup --non-interactive --quick")}
${runAs("doctor --fix")}
`
  }

  return `#!/bin/bash
set -uo pipefail
export SYSTEMD_PAGER=cat
${hermesWarm}
echo "=== bake: install gateway unit ==="
echo ${q(unitB64)} | base64 -d > "/etc/systemd/system/${runtime.serviceName}.service"
systemctl daemon-reload
systemctl enable ${q(runtime.serviceName)} || true
echo "=== bake: finalize done ==="
`
}
