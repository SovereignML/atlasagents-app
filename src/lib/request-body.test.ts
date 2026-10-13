import { describe, it, expect } from "vitest"
import { z } from "zod"

import { readJsonBody } from "./request-body"

const schema = z.object({ credits: z.number().int().min(500).max(100_000) })
const post = (body: string) => new Request("http://x.test", { method: "POST", body })

describe("readJsonBody", () => {
  it("returns typed data for a valid body", async () => {
    const r = await readJsonBody(post('{"credits":2000}'), schema)
    expect(r).toEqual({ ok: true, data: { credits: 2000 } })
  })

  it("rejects malformed JSON with a 400", async () => {
    const r = await readJsonBody(post("{nope"), schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.res.status).toBe(400)
  })

  it("names the field that failed", async () => {
    const r = await readJsonBody(post('{"credits":5000000}'), schema)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(((await r.res.json()) as { field?: string }).field).toBe("credits")
  })

  it("treats an empty body as {} only when allowed", async () => {
    const optional = z.object({ mode: z.enum(["reload", "restart"]).optional() })
    expect((await readJsonBody(post(""), optional, { allowEmpty: true })).ok).toBe(true)
    expect((await readJsonBody(post(""), optional)).ok).toBe(false)
  })
})
