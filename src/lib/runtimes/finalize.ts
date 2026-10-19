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
import { platformChatUi, withChatUi, type ChatUi } from "@/lib/runtimes/agentwebui-lite"
import { buildSidecarBakeSteps } from "@/lib/runtimes/open-webui-claim"
import { renderEnvFile } from "@/lib/runtimes/shared"

/**
 * Bake-finalize: the slow-once, per-instance-INDEPENDENT work, run once the box
 * has bootstrapped so the eventual claim is fast. Idempotent.
 *  - Hermes: warm the venv + scaffold config via `setup --quick` + `doctor`
 *    (the expensive CLI cold starts), and pre-start Open WebUI so its SQLite DB
 *    + Python caches are warm (it boots fine without a live gateway upstream).
 *    With `waitForSidecar`, wait until it answers and mark the box prewarmed,
 *    so the claim keeps it running and only signs the customer up.
 *  - Both: install + enable the systemd unit(s) so claim only rewrites config
 *    and restarts, never installs.
 * Everything is best-effort (`|| true`): the authoritative config + start still
 * happens at claim, so a warmup miss only costs a little latency, never breaks.
 */
export function buildBakeFinalizeScript(
  runtimeId: RuntimeId,
  webuiEnabled: boolean,
  opts: {
    /**
     * Wait for Open WebUI to answer and mark the box prewarmed, so a claim can
     * hand the running sidecar over without restarting it (see
     * open-webui-claim.ts). The warm pool sets this; BYOS prebake does not,
     * because its deploy always restarts the sidecar.
     */
    waitForSidecar?: boolean
    /** The chat UI the box was bootstrapped with. Defaults to the platform's (CHAT_UI). */
    chatUi?: ChatUi
  } = {},
): string {
  const runtime = withChatUi(getRuntime(runtimeId), opts.chatUi ?? platformChatUi())
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
  // Only Open WebUI (the sidecar with an admin to seed) is worth prewarming.
  // AgentWebUI Lite starts in a second; its unit is installed at claim.
  if (webuiEnabled && runtime.sidecar?.seedAdmin) {
    const sc = runtime.sidecar
    // Placeholder env — rewritten with the real values at claim. Enough for Open
    // WebUI to boot and initialize its DB (it does not require a live upstream).
    // The session secret is generated on the box, per VM: a prewarmed sidecar
    // keeps running through the claim, so it must never be a shared constant.
    const placeholderEnv = sc.renderEnv({
      // Minimal instance stub; renderEnv reads gatewayToken/port/secret/publicUrl/model.
      instance: { id: "pool", domain: null } as never,
      gatewayToken: "pool-placeholder-token",
      gatewayPort: runtime.gatewayPort,
      secretKey: "replaced-on-box",
      publicUrl: null,
      enableSignup: true,
      // A pooled VM has no instance yet, so no model to pin. Empty means the
      // sidecar env omits DEFAULT_MODELS at bake; claim rewrites this whole file
      // with the real per-instance value before the admin account is seeded.
      model: "",
    })
    sidecarWarm = buildSidecarBakeSteps({
      envB64: Buffer.from(renderEnvFile(placeholderEnv), "utf8").toString("base64"),
      envPath: sc.envPath,
      unitB64: Buffer.from(sc.renderSystemdUnit(), "utf8").toString("base64"),
      serviceName: sc.serviceName,
      port: sc.port,
      healthPath: sc.healthPath,
      waitForReady: opts.waitForSidecar === true,
    })
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
