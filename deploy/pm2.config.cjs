// pm2 ecosystem file for bare-metal VPS deploys.
//
// Usage:
//   pm2 start deploy/pm2.config.cjs
//   pm2 save && pm2 startup       # persist across reboots
//
// Env policy: this project loads EXACTLY ONE env file — `.env` at the
// repo root. Next.js' multi-file layering (.env.production,
// .env.local, etc.) caused real-world outages in the past, so the
// guard below refuses to start if any of those files exist.

const fs = require("fs")
const path = require("path")

const repoRoot = path.resolve(__dirname, "..")

const banned = [".env.local", ".env.production", ".env.production.local"]
const found = banned.filter((f) => fs.existsSync(path.join(repoRoot, f)))
if (found.length > 0) {
  console.error(
    `\n[pm2 guard] Refusing to start: this project loads only .env, but these files exist:\n` +
      found.map((f) => `  - ${f}`).join("\n") +
      `\n\nThese files silently override .env in Next.js and will bite you.\n` +
      `Delete them, copy anything you need into .env, and re-run pm2 start.\n`
  )
  process.exit(1)
}

const envPath = path.join(repoRoot, ".env")
if (!fs.existsSync(envPath)) {
  console.error(
    `\n[pm2 guard] Refusing to start: .env does not exist at ${envPath}.\n` +
      `Run \`bash scripts/bootstrap-pg.sh\` to create it.\n`
  )
  process.exit(1)
}

module.exports = {
  apps: [
    {
      name: "redesigned-giggle",
      script: "node",
      args: [
        `--env-file=${envPath}`,
        path.join(repoRoot, ".next/standalone/server.js"),
      ],
      cwd: repoRoot,
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: "3000",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      max_memory_restart: "1G",
      kill_timeout: 10000,
      listen_timeout: 15000,
      out_file: "/var/log/redesigned-giggle/out.log",
      error_file: "/var/log/redesigned-giggle/err.log",
      merge_logs: true,
      time: true,
    },
  ],
}
