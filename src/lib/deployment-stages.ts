import type { Task, StageStatus } from "@/components/ui/agent-plan"

/**
 * Maps an instance's live provisioning state into the grouped phase/substep
 * structure rendered by the agent-plan component on the deployment-cycle screen.
 *
 * Completion is driven primarily by log messages (the same signal the legacy
 * ProvisioningCard used, so it works for vps / byos / shared even when
 * `provisionStage` is null for non-VPS targets), with `provisionStage`
 * ordering merged in to advance the "in-progress" marker on the VPS path:
 *   - status === "running"             → every stage completed
 *   - status === "failed_provisioning" → the furthest-started stage is the
 *     failure point; earlier stages completed, later stages pending
 *   - otherwise (pending/provisioning) → started-and-superseded stages are
 *     completed, the furthest-started stage is in-progress, the rest pending
 *
 * The post-provision DNS/TLS flow for custom domains is intentionally NOT part
 * of this view: the dashboard reveals at status === "running" and DNS/TLS
 * continues there (DnsCard), so it must not block the cycle from completing.
 */

export interface DeploymentStageInput {
  status: string
  provisionStage: string | null
  deploymentTarget: string | null
  logMessages: string[]
}

interface StageDef {
  stage: string
  // Substring of the log line emitted when this stage starts (mirrors the
  // legacy PROVISION_STEPS matching). Used to detect progress from logs.
  enterLog: string
  title: string
  description: string
}

interface PhaseDef {
  id: string
  title: string
  description: string
  stages: StageDef[]
}

const VPS_PHASES: PhaseDef[] = [
  {
    id: "provision",
    title: "Provision agent",
    description: "Prepare your agent.",
    stages: [
      { stage: "create_vm", enterLog: "Creating VM", title: "Prepare agent", description: "Preparing your agent." },
      { stage: "wait_boot", enterLog: "Waiting for boot", title: "Boot agent", description: "Booting your agent." },
    ],
  },
  {
    id: "connect",
    title: "Connect & bootstrap",
    description: "Establish a secure connection and prepare the environment.",
    stages: [
      { stage: "waiting_ssh", enterLog: "Waiting for SSH", title: "Connect", description: "Establishing a secure connection." },
      { stage: "bootstrap", enterLog: "Bootstrapping server", title: "Bootstrap", description: "Setting up the environment." },
    ],
  },
  {
    id: "configure",
    title: "Configure agent",
    description: "Write the agent configuration.",
    stages: [
      { stage: "writing_config", enterLog: "Writing agent configuration", title: "Write configuration", description: "Writing configuration files." },
    ],
  },
  {
    id: "start",
    title: "Start service",
    description: "Install and start the agent gateway, then verify health.",
    stages: [
      { stage: "installing_service", enterLog: "systemd service active", title: "Install service", description: "Installing services." },
      { stage: "starting_service", enterLog: "Gateway port listening", title: "Start gateway", description: "Starting the agent gateway." },
      { stage: "health_check", enterLog: "HTTP health check passed", title: "Health check", description: "Verifying the gateway is responding." },
    ],
  },
  {
    id: "finalize",
    title: "Finalize",
    description: "Finalize the deployment.",
    stages: [
      { stage: "commit", enterLog: "Deployment complete", title: "Finalize deployment", description: "Finalizing deployment and bringing the agent online." },
    ],
  },
]

// BYOS reuses the customer's host, so there's no VM creation/boot.
const BYOS_PHASES: PhaseDef[] = [
  { ...VPS_PHASES[1], description: "Connect to your server and prepare its environment." },
  VPS_PHASES[2],
  VPS_PHASES[3],
  VPS_PHASES[4],
]

const SHARED_PHASES: PhaseDef[] = [
  {
    id: "host",
    title: "Reserve host",
    description: "Select a shared host and start the container.",
    stages: [
      { stage: "select_host", enterLog: "Selecting shared host", title: "Select host", description: "Selecting a shared host with capacity." },
      { stage: "start_container", enterLog: "Starting bot container", title: "Start container", description: "Starting the bot container." },
    ],
  },
  {
    id: "finalize",
    title: "Finalize",
    description: "Finalize the deployment.",
    stages: [
      { stage: "commit", enterLog: "Deployment complete", title: "Finalize deployment", description: "Finalizing deployment and bringing the agent online." },
    ],
  },
]

function phasesFor(target: string | null): PhaseDef[] {
  if (target === "byos") return BYOS_PHASES
  if (target === "shared") return SHARED_PHASES
  return VPS_PHASES
}

export function buildDeploymentTasks(input: DeploymentStageInput): Task[] {
  const phases = phasesFor(input.deploymentTarget)
  const orderedStages = phases.flatMap((p) => p.stages)

  const started = (s: StageDef) => input.logMessages.some((m) => m.includes(s.enterLog))

  // Furthest stage we have evidence for, from logs and from provisionStage.
  let furthest = -1
  orderedStages.forEach((s, idx) => {
    if (started(s)) furthest = Math.max(furthest, idx)
  })
  if (input.provisionStage) {
    const psIdx = orderedStages.findIndex((s) => s.stage === input.provisionStage)
    if (psIdx >= 0) furthest = Math.max(furthest, psIdx)
  }

  const isRunning = input.status === "running"
  const isFailed = input.status === "failed_provisioning"

  const stageStatus = (idx: number): StageStatus => {
    if (isRunning) return "completed"
    if (furthest < 0) return "pending"
    if (idx < furthest) return "completed"
    if (idx === furthest) return isFailed ? "failed" : "in-progress"
    return "pending"
  }

  let flatIdx = -1
  return phases.map((phase) => {
    const subtasks = phase.stages.map((s) => {
      flatIdx += 1
      return {
        id: s.stage,
        title: s.title,
        description: s.description,
        status: stageStatus(flatIdx),
      }
    })

    const statuses = subtasks.map((s) => s.status)
    let phaseStatus: StageStatus
    if (statuses.includes("failed")) phaseStatus = "failed"
    else if (statuses.every((s) => s === "completed")) phaseStatus = "completed"
    else if (statuses.some((s) => s === "in-progress" || s === "completed"))
      phaseStatus = "in-progress"
    else phaseStatus = "pending"

    return {
      id: phase.id,
      title: phase.title,
      description: phase.description,
      status: phaseStatus,
      subtasks,
    }
  })
}
