// First-admin bootstrap / promotion. Referenced by docs/DEPLOYMENT.md step 8.
//
// Creates the admin user if the email doesn't exist yet, or promotes an
// existing account to `role=admin`. The password comes from (in order):
//   1. the ADMIN_PASSWORD env var (non-interactive: CI, SEED_ON_BOOT hosts)
//   2. a hidden interactive prompt (typed input is not echoed)
// For an EXISTING user, leaving the prompt empty keeps their current password
// — so promoting someone never silently resets their credentials.
//
// Idempotent: re-running against an existing admin is a no-op unless you
// type a new password.
//
// Usage:
//   npm run make-admin -- admin@sovereignml.com
//   npm run make-admin                          # email from ADMIN_EMAIL, default admin@sovereignml.com
//   ADMIN_PASSWORD=... npm run make-admin       # non-interactive

import { db, users, eq, pool } from "@/db"
import { hashPassword } from "@/lib/password"

// Matches registerSchema in src/lib/validations.ts.
const MIN_PASSWORD_LENGTH = 6

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.resume()
    stdin.setRawMode?.(true)
    let value = ""
    const onData = (buf: Buffer) => {
      const ch = buf.toString("utf8")
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.off("data", onData)
        process.stdout.write("\n")
        resolve(value)
      } else if (ch === "\u0003") {
        // Ctrl-C
        stdin.setRawMode?.(false)
        process.stdout.write("\n")
        process.exit(130)
      } else if (ch === "\u007f" || ch === "\b") {
        value = value.slice(0, -1)
      } else {
        value += ch
      }
    }
    stdin.on("data", onData)
  })
}

async function resolvePassword(opts: { required: boolean }): Promise<string | null> {
  const fromEnv = process.env.ADMIN_PASSWORD
  if (fromEnv) return fromEnv

  if (!process.stdin.isTTY) {
    if (opts.required) {
      console.error(
        "No TTY and ADMIN_PASSWORD is not set — cannot prompt for a password. " +
          "Set ADMIN_PASSWORD in the environment and re-run.",
      )
      process.exit(1)
    }
    return null
  }

  const hint = opts.required ? "" : " (empty = keep current)"
  const first = await promptHidden(`New admin password${hint}: `)
  if (!first) {
    if (opts.required) {
      console.error("A password is required when creating a new user.")
      process.exit(1)
    }
    return null
  }
  const second = await promptHidden("Confirm password: ")
  if (first !== second) {
    console.error("Passwords do not match.")
    process.exit(1)
  }
  return first
}

async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "admin@sovereignml.com")
    .trim()
    .toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    console.error(`"${email}" doesn't look like an email address.`)
    process.exit(1)
  }

  const existing = await db.query.users.findFirst({ where: eq(users.email, email) })

  const password = await resolvePassword({ required: !existing })
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    process.exit(1)
  }
  if (password === "admin123456") {
    console.error("Refusing the well-known dev default password. Pick a real one.")
    process.exit(1)
  }

  if (existing) {
    await db
      .update(users)
      .set({
        role: "admin",
        // Pre-verify so the admin never hits the verify-email banner.
        emailVerified: existing.emailVerified ?? new Date(),
        ...(password ? { hashedPassword: await hashPassword(password) } : {}),
      })
      .where(eq(users.id, existing.id))
    console.log(
      `${email}: role set to admin${password ? ", password updated" : ", password unchanged"}.`,
    )
  } else {
    await db.insert(users).values({
      email,
      name: "Admin",
      role: "admin",
      hashedPassword: await hashPassword(password!),
      emailVerified: new Date(),
    })
    console.log(`${email}: admin user created.`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
