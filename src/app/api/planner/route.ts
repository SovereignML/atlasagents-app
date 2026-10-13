import { NextResponse } from "next/server"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"
import { rateLimit } from "@/lib/rate-limit"
import { readJsonBody } from "@/lib/request-body"
import { plannerSchema } from "@/lib/validations"

// Templates that suggest the Operator tier. "default" is deliberately absent:
// it is the entry-level choice and falls through to the Builder suggestion.
const PRO_AGENTS = new Set(["devops", "research", "sales", "social"])

export async function POST(request: Request) {
  try {
    // Public, unauthenticated endpoint — cap per-IP to deter abuse.
    const ip = request.headers.get("x-forwarded-for") || "unknown"
    if (!(await rateLimit(`planner:${ip}`, 30, 60_000))) {
      return NextResponse.json(
        { error: "Too many requests. Try again shortly." },
        { status: 429 }
      )
    }

    const parsed = await readJsonBody(request, plannerSchema)
    if (!parsed.ok) return parsed.res
    const { useCase } = parsed.data

    const agent = AGENT_CATEGORIES.find((a) => a.slug === useCase)

    if (!agent) {
      return NextResponse.json(
        { error: `Unknown agent type: ${useCase}` },
        { status: 400 }
      )
    }

    let suggestedPlan: "free" | "builder" | "operator" | "scale" | "enterprise" = "builder"
    if (useCase === "custom") {
      suggestedPlan = "enterprise"
    } else if (PRO_AGENTS.has(useCase)) {
      suggestedPlan = "operator"
    }

    return NextResponse.json({
      agentType: agent,
      suggestedConfig: {
        compute: "auto-scaled",
        monitoring: "enabled",
        privacy: "strict",
      },
      suggestedPlan,
    })
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    )
  }
}
