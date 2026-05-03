import { NextResponse } from "next/server"
import { AGENT_CATEGORIES } from "@/configs/agent-categories"

const PRO_AGENTS = new Set(["devops", "research", "content", "sales", "social"])

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { useCase } = body

    if (!useCase || typeof useCase !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'useCase' field" },
        { status: 400 }
      )
    }

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
