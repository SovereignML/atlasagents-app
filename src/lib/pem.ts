/**
 * PEM helpers with no dependencies, so pure modules (and their unit tests) can
 * use them without pulling in ssh.ts, which imports the database.
 */

/**
 * Normalize PEM-encoded strings from environment variables. Many secret
 * stores / CI systems encode newlines as literal two-character `\n`
 * sequences; PEM parsing requires real newline characters.
 */
export function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw
}

/**
 * Returns true if `value` looks like it contains at least one PEM block
 * (e.g. `-----BEGIN CERTIFICATE-----`).
 */
export function isValidPem(value: string): boolean {
  return /-----BEGIN [A-Z0-9 ]+-----/.test(value)
}
