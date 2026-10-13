import { afterEach, describe, it, expect, vi } from "vitest"

import { apiError } from "./api-error"

describe("apiError", () => {
  afterEach(() => vi.restoreAllMocks())

  it("logs the real error but returns only a generic message and a reference", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = apiError("deploy", new Error('relation "Instance" does not exist at /srv/app/x.ts'))
    const body = (await res.json()) as { error: string; ref: string }

    expect(res.status).toBe(500)
    expect(body.error).not.toMatch(/relation|\/srv/)
    expect(body.error).toContain(body.ref)
    expect(body.ref).toMatch(/^[0-9a-f]{8}$/)
    expect(log).toHaveBeenCalledWith(`[deploy] ref=${body.ref}`, expect.any(Error))
  })
})
