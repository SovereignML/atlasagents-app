import { NextResponse } from "next/server"

import { auth } from "@/auth"
import {
  NVIDIA_BASE_URL,
  NVIDIA_FALLBACK_MODELS,
  nvidiaKeyForSlot,
} from "@/lib/model-router"

/**
 * Admin-only NVIDIA fallback debug endpoint, backing the admin "Models" panel.
 *
 *   GET  — liveness-probe each curated NVIDIA_FALLBACK_MODELS entry (1-token
 *          completion) using its per-slot key.
 *   POST {modelId, prompt?} — run a small completion against a configured model.
 *
 * Keys come from env (NVIDIA_API_KEY_PRIMARY/_SECONDARY, legacy NVIDIA_API_KEY);
 * never hardcode.
 */

async function isAdmin(): Promise<boolean> {
  const session = await auth()
  if (!session?.user) return false
  return (session.user as { role?: string }).role === "admin"
}

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const results = await Promise.all(
    NVIDIA_FALLBACK_MODELS.map(async (m) => {
      const started = Date.now()
      try {
        const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${nvidiaKeyForSlot(m.keySlot)}`,
          },
          body: JSON.stringify({
            model: m.model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
        })
        return {
          id: m.id,
          label: m.label,
          model: m.model,
          keySlot: m.keySlot,
          ok: res.ok,
          status: res.status,
          ms: Date.now() - started,
        }
      } catch (e) {
        return {
          id: m.id,
          label: m.label,
          model: m.model,
          keySlot: m.keySlot,
          ok: false,
          error: String(e),
          ms: Date.now() - started,
        }
      }
    }),
  )

  return NextResponse.json({ results })
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  let body: { modelId?: string; prompt?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const target = NVIDIA_FALLBACK_MODELS.find((m) => m.id === body.modelId)
  if (!target) {
    return NextResponse.json({ error: "Unknown modelId" }, { status: 400 })
  }
  const prompt = body.prompt?.trim() || "Reply with exactly: PONG"

  const started = Date.now()
  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${nvidiaKeyForSlot(target.keySlot)}`,
      },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 32,
        temperature: 0,
      }),
    })
    const ms = Date.now() - started
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({
        ok: false,
        status: res.status,
        ms,
        error: text.slice(0, 500),
      })
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const content = json.choices?.[0]?.message?.content ?? ""
    return NextResponse.json({ ok: true, status: res.status, ms, content })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - started,
      error: String(e),
    })
  }
}
