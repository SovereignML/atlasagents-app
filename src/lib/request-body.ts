import { NextResponse } from "next/server"
import type { z } from "zod"

/**
 * Parse a JSON request body against a zod schema. Returns the typed data, or a
 * ready-to-return 400: "Invalid JSON body" for a body that doesn't parse, else
 * `{ error, field }` from the first schema issue. Forms show `error` as is, so
 * schemas give user-facing fields a sentence as their message.
 *
 *   const body = await readJsonBody(req, walletTopupSchema)
 *   if (!body.ok) return body.res
 *   body.data.credits
 *
 * Every route that changes data should read its body through this (or its own
 * safeParse), with upper bounds on numbers, strings and arrays: a schema is
 * the only thing that stops a later edit from trusting an unchecked field.
 */
export async function readJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  opts: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: NextResponse }> {
  let raw: unknown
  try {
    const text = await req.text()
    raw = text.trim() === "" && opts.allowEmpty ? {} : JSON.parse(text)
  } catch {
    return { ok: false, res: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const body: { error: string; field?: string } = { error: issue?.message ?? "Invalid request body" }
    if (issue?.path.length) body.field = issue.path.join(".")
    return { ok: false, res: NextResponse.json(body, { status: 400 }) }
  }
  return { ok: true, data: parsed.data }
}
