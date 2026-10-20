import { NextResponse } from "next/server"

import { auth } from "@/auth"
import type { BudgetTier } from "@/lib/agent-config"
import { allowedModelSlugs } from "@/lib/allowed-models"
import {
  OPENROUTER_BASE_URL,
  claudeCodeModel,
  codexModel,
  geminiCliModel,
  grokModel,
  hermesModel,
  isValidOpenRouterSlug,
  routeModel,
} from "@/lib/model-router"
import { readJsonBody } from "@/lib/request-body"
import { modelProbeSchema } from "@/lib/validations"

/**
 * Admin-only OpenRouter debug endpoint, backing the admin "Models" panel.
 *
 *   GET  — returns the full OpenRouter model catalog (public endpoint, no key)
 *          plus a liveness probe (1-token completion) of each model the
 *          platform routes by default, using the platform OPENROUTER_API_KEY.
 *   POST {model, prompt?} — run a small completion against any OpenRouter slug.
 *
 * The platform key comes from env (OPENROUTER_API_KEY); never hardcode.
 */

const TIERS: BudgetTier[] = ["low", "mid", "high"]

function platformKey(): string {
  return (process.env.OPENROUTER_API_KEY || "").trim()
}

async function isAdmin(): Promise<boolean> {
  const session = await auth()
  if (!session?.user) return false
  return (session.user as { role?: string }).role === "admin"
}

type CatalogModel = {
  id: string
  name: string
  contextLength: number | null
  promptPrice: string | null
  completionPrice: string | null
  /** On the OpenRouter ACCOUNT allowlist — bots can only reach these. */
  allowed: boolean
}

async function fetchCatalog(allowed: Set<string>): Promise<CatalogModel[]> {
  const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
    // The catalog changes as providers list/delist models; don't cache stale lists.
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`)
  const json = (await res.json()) as {
    data?: {
      id: string
      name?: string
      context_length?: number
      pricing?: { prompt?: string; completion?: string }
    }[]
  }
  return (json.data ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    contextLength: m.context_length ?? null,
    promptPrice: m.pricing?.prompt ?? null,
    completionPrice: m.pricing?.completion ?? null,
    allowed: allowed.has(m.id),
  }))
}

/** The model slugs the platform routes by default, with where each is used. */
function configuredModels(): { model: string; role: string }[] {
  const route = routeModel("mid")
  const entries: { model: string; role: string }[] = [
    { model: route.model, role: "OpenClaw primary" },
    { model: route.fallback, role: "OpenClaw fallback" },
    ...(
      [
        ["Hermes, OpenCode, Pi", hermesModel],
        ["Claude Code", claudeCodeModel],
        ["Codex", codexModel],
        ["Gemini CLI", geminiCliModel],
        ["Grok", grokModel],
      ] as const
    ).flatMap(([engine, ladder]) =>
      TIERS.map((tier) => ({ model: ladder(tier), role: `${engine} ${tier} tier` })),
    ),
  ]
  // Dedupe by slug, merging roles, so shared slugs probe (and bill) once.
  const byModel = new Map<string, string[]>()
  for (const e of entries) {
    byModel.set(e.model, [...(byModel.get(e.model) ?? []), e.role])
  }
  return [...byModel.entries()].map(([model, roles]) => ({
    model,
    role: roles.join(", "),
  }))
}

async function probeCompletion(
  model: string,
  prompt: string,
  maxTokens: number,
): Promise<{ ok: boolean; status?: number; ms: number; content?: string; error?: string }> {
  const started = Date.now()
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platformKey()}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
      }),
    })
    const ms = Date.now() - started
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, status: res.status, ms, error: text.slice(0, 500) }
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return {
      ok: true,
      status: res.status,
      ms,
      content: json.choices?.[0]?.message?.content ?? "",
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: String(e) }
  }
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!platformKey()) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set" },
      { status: 503 },
    )
  }

  const allowed = await allowedModelSlugs()
  let catalog: CatalogModel[]
  try {
    catalog = await fetchCatalog(allowed)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
  const catalogIds = new Set(catalog.map((m) => m.id))

  const configured = await Promise.all(
    configuredModels().map(async ({ model, role }) => {
      const probe = await probeCompletion(model, "ping", 1)
      return {
        model,
        role,
        listed: catalogIds.has(model),
        allowed: allowed.has(model),
        ok: probe.ok,
        status: probe.status,
        ms: probe.ms,
        error: probe.error,
      }
    }),
  )

  return NextResponse.json({ configured, catalog })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (!platformKey()) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not set" },
      { status: 503 },
    )
  }

  const parsed = await readJsonBody(req, modelProbeSchema)
  if (!parsed.ok) return parsed.res
  const body = parsed.data

  const model = body.model?.trim() ?? ""
  if (!isValidOpenRouterSlug(model)) {
    return NextResponse.json(
      { error: "model must be a valid OpenRouter <author>/<slug>" },
      { status: 400 },
    )
  }
  const prompt = body.prompt?.trim() || "Reply with exactly: PONG"

  const result = await probeCompletion(model, prompt, 32)
  return NextResponse.json(result)
}
