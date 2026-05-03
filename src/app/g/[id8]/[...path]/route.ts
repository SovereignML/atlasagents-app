import { NextRequest, NextResponse } from "next/server"
import { db, like, instances } from "@/db"

/**
 * Path-based gateway: /g/<id8>/<...> proxies to the bot's container at
 * http://<host_ip>:<container_port>/<...>. Lookup uses the first 8 chars of
 * Instance.id (cuid prefix is collision-resistant within a fleet of <1000).
 *
 * Auth: we attach X-Bot-Token automatically so the bot trusts us. Public
 * callers don't need to know the token.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
])

function buildHeaders(req: NextRequest, botToken: string): Headers {
  const out = new Headers()
  for (const [k, v] of req.headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue
    out.set(k, v)
  }
  out.set("x-bot-token", botToken)
  return out
}

async function handle(req: NextRequest, params: { id8: string; path: string[] }) {
  const id8 = params.id8
  if (!id8 || id8.length < 4) {
    return NextResponse.json({ error: "invalid id8" }, { status: 400 })
  }

  const candidates = await db.query.instances.findMany({
    where: like(instances.id, `${id8}%`),
    columns: {
      id: true,
      status: true,
      ipAddress: true,
      containerPort: true,
      botToken: true,
    },
    limit: 2,
  })
  if (candidates.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (candidates.length > 1) {
    return NextResponse.json({ error: "ambiguous id8 — use a longer prefix" }, { status: 409 })
  }
  const inst = candidates[0]
  if (inst.status === "deleted") {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (inst.status !== "running") {
    return NextResponse.json({ error: `bot is ${inst.status}` }, { status: 503 })
  }
  if (!inst.ipAddress || !inst.containerPort) {
    return NextResponse.json({ error: "bot has no host binding" }, { status: 503 })
  }

  const subPath = (params.path ?? []).join("/")
  const upstream = new URL(`http://${inst.ipAddress}:${inst.containerPort}/${subPath}`)
  const search = new URL(req.url).search
  if (search) upstream.search = search

  let body: BodyInit | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = Buffer.from(await req.arrayBuffer())
  }

  let upstreamResp: Response
  try {
    upstreamResp = await fetch(upstream.toString(), {
      method: req.method,
      headers: buildHeaders(req, inst.botToken ?? ""),
      body,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    return NextResponse.json(
      { error: `upstream unreachable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    )
  }

  const respHeaders = new Headers()
  for (const [k, v] of upstreamResp.headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue
    respHeaders.set(k, v)
  }
  return new NextResponse(upstreamResp.body, {
    status: upstreamResp.status,
    headers: respHeaders,
  })
}

type Ctx = { params: Promise<{ id8: string; path: string[] }> }
export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(req, await params)
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(req, await params)
}
export async function PUT(req: NextRequest, { params }: Ctx) {
  return handle(req, await params)
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(req, await params)
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(req, await params)
}
