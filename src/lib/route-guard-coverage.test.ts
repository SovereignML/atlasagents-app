import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

// Every handler under /api/admin must go through requireAdmin() (or
// requireAdminOrCron() for routes the scheduler also calls), and every
// /api/tenant-admin handler through requireTenantAdmin() or
// requireTenantAdminOverChild(). Hand-rolled session checks were all correct
// when this test was written; it exists so a new or edited route can't quietly
// drift. Reads source files only.

const ROOT = join(__dirname, "..", "app", "api")

// Deliberately open to any signed-in user: an admin impersonating a customer
// is that customer for the session, so the button to stop must work for them.
const EXEMPT = new Set(["admin/stop-impersonation/route.ts"])

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return routeFiles(path)
    return name === "route.ts" ? [path] : []
  })
}

/** Each exported HTTP handler's source, keyed by method. */
function handlers(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /export async function (GET|POST|PUT|PATCH|DELETE)\b/g
  const starts = [...source.matchAll(re)]
  starts.forEach((m, i) => {
    out.set(m[1], source.slice(m.index, starts[i + 1]?.index ?? source.length))
  })
  return out
}

describe.each([
  ["admin", /\brequireAdmin(OrCron)?\(/],
  ["tenant-admin", /\brequireTenantAdmin(OverChild)?\(/],
])("/api/%s routes", (scope, guard) => {
  const files = routeFiles(join(ROOT, scope))

  it("has routes to check", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const rel = relative(ROOT, file)
    if (EXEMPT.has(rel)) continue
    for (const [method, body] of handlers(readFileSync(file, "utf8"))) {
      it(`${method} ${rel} uses the guard`, () => {
        expect(body).toMatch(guard)
      })
    }
  }
})
