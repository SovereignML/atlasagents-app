// Remote command framing for SSH. Kept dependency-free (no DB, no network) so
// it can be unit-tested in isolation — ssh.ts imports it.

/**
 * Build the remote command that base64-decodes and runs a bash script in one
 * shot. When `elevate` is set (BYOS servers whose SSH user is not root but has
 * passwordless sudo — the documented "root / sudo access" requirement), the
 * script runs under `sudo -n bash`; `-n` fails fast with a clear error instead
 * of hanging on a password prompt if sudo isn't actually passwordless.
 *
 * With `elevate=false` this reproduces the historical, root-only invocation
 * (`echo <b64> | base64 -d | bash`) byte-for-byte, so VPS/shared paths are
 * unchanged.
 */
export function buildPipedBashCommand(script: string, elevate = false): string {
  const b64 = Buffer.from(script, "utf8").toString("base64")
  const shell = elevate ? "sudo -n bash" : "bash"
  return `echo '${b64}' | base64 -d | ${shell}`
}

/** Result of the two remote privilege probes (`id -u`, then `sudo -n true`). */
export type ElevationProbe = {
  /** stdout of `id -u`. */
  uidStdout: string
  /** exit code of `id -u`. */
  uidCode: number | null
  /** exit code of `sudo -n true`. */
  sudoCode: number | null
  /** combined stdout/stderr of the sudo probe, surfaced in the failure message. */
  sudoDetail?: string
}

/**
 * Decide whether remote privileged commands must run under `sudo`, from the
 * outcome of the two probes. Kept pure (no SSH/DB) so the decision matrix is
 * unit-testable in isolation; `resolveElevation` in ssh.ts runs the probes and
 * calls this.
 *
 *   - uid 0            → already root, no sudo needed → false
 *   - else sudo -n ok  → passwordless sudo available  → true
 *   - else             → throw (needs root or passwordless sudo)
 */
export function decideElevation(probe: ElevationProbe, username: string): boolean {
  if (probe.uidCode === 0 && probe.uidStdout.trim() === "0") {
    return false
  }
  if (probe.sudoCode === 0) {
    return true
  }
  const detail = probe.sudoDetail?.trim()
  throw new Error(
    `SSH user "${username}" is not root and does not have passwordless sudo, so the ` +
      `bootstrap cannot install packages, write /etc, or manage systemd. Grant ` +
      `passwordless sudo (or connect as root) and try again.` +
      (detail ? ` (sudo probe: ${detail})` : ""),
  )
}
