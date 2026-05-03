/**
 * Shared milestone strings for VPS provisioning. The provisioner writes these
 * exact strings as `instanceLogs.message` rows; the dashboard's
 * `PROVISION_STEPS` matches against them to render stepwise progress. Keeping
 * the strings in one module prevents drift between writer and reader.
 */
export const PROVISION_EVENT = {
  vmCreated: "Creating VM",
  vmBooting: "Waiting for boot",
  cfDnsUpserted: "Cloudflare DNS upserted",
  waitingSsh: "Waiting for SSH",
  bootstrapping: "Bootstrapping server",
  bootstrapComplete: "bootstrap complete",
  writingConfig: "Writing OpenClaw configuration",
  configWritten: "OpenClaw configuration written",
  caddyReloaded: "Caddy reloaded",
  serviceActive: "systemd service active",
  portListening: "Gateway port listening",
  httpHealthOk: "HTTP health check passed",
} as const

export type ProvisionEvent = (typeof PROVISION_EVENT)[keyof typeof PROVISION_EVENT]
