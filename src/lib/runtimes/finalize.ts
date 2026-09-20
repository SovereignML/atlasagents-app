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
 *    (the expensive CLI cold starts), and pre-start Open WebUI so its SQLite DB
 *    + Python caches are warm (it boots fine without a live gateway upstream).
 *  - Both: install + enable the systemd unit(s) so claim only rewrites config
 *    and restarts, never installs.
 * Everything is best-effort (`|| true`): the authoritative config + start still
 * happens at claim, so a warmup miss only costs a little latency, never breaks.
 */
export function buildBakeFinalizeScript(runtimeId: RuntimeId, webuiEnabled: boolean): string {
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

  let sidecarWarm = ""
  if (webuiEnabled && runtime.sidecar) {
    const sc = runtime.sidecar
    const sidecarUnitB64 = Buffer.from(sc.renderSystemdUnit(), "utf8").toString("base64")
    // Placeholder env — rewritten with real secrets at claim. Enough for Open
    // WebUI to boot and initialize its DB (it does not require a live upstream).
    const placeholderEnv = sc.renderEnv({
      // Minimal instance stub; renderEnv reads gatewayToken/port/secret/publicUrl/model.
      instance: { id: "pool", domain: null } as never,
      gatewayToken: "pool-placeholder-token",
      gatewayPort: runtime.gatewayPort,
      secretKey: "pool-placeholder-secret",
      publicUrl: null,
      enableSignup: true,
      // A pooled VM has no instance yet, so no model to pin. Empty means the
      // sidecar env omits DEFAULT_MODELS at bake; claim rewrites this whole file
      // with the real per-instance value before the admin account is seeded.
      model: "",
    })
    const envB64 = Buffer.from(
      Object.entries(placeholderEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      "utf8",
    ).toString("base64")
    sidecarWarm = `
echo "=== bake: open-webui warmup ==="
mkdir -p "$(dirname ${q(sc.envPath)})"
echo ${q(envB64)} | base64 -d > ${q(sc.envPath)}
chmod 600 ${q(sc.envPath)}
echo ${q(sidecarUnitB64)} | base64 -d > "/etc/systemd/system/${sc.serviceName}.service"
systemctl daemon-reload
systemctl enable ${q(sc.serviceName)} || true
systemctl start ${q(sc.serviceName)} || true
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
${sidecarWarm}
echo "=== bake: finalize done ==="
`
}
