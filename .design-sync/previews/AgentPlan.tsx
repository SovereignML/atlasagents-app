import { AgentPlan } from "sovereign";

const deployTasks = [
  {
    id: "provision",
    title: "Provision instance",
    description: "Allocate a DigitalOcean droplet for the new inference node.",
    status: "completed",
    dependencies: ["nyc3", "s-4vcpu-8gb"],
    subtasks: [
      {
        id: "provision-1",
        title: "Reserve droplet in nyc3",
        description: "Create s-4vcpu-8gb droplet via the DigitalOcean API.",
        status: "completed",
        tools: ["digitalocean", "terraform"],
      },
      {
        id: "provision-2",
        title: "Attach 100GB block volume",
        description: "Mount persistent storage for model weights and backups.",
        status: "completed",
      },
    ],
  },
  {
    id: "runtime",
    title: "Install runtime",
    description: "Install container runtime and pull the vLLM serving image.",
    status: "in-progress",
    dependencies: ["provision"],
    subtasks: [
      {
        id: "runtime-1",
        title: "Install Docker engine",
        description: "Provision the container runtime and enable the daemon.",
        status: "completed",
      },
      {
        id: "runtime-2",
        title: "Pull vllm/vllm-openai:latest",
        description: "Fetch the OpenAI-compatible serving image to the node.",
        status: "in-progress",
        tools: ["docker", "registry"],
      },
    ],
  },
  {
    id: "deploy",
    title: "Deploy model",
    description: "Start the Claude-compatible gateway and load weights.",
    status: "pending",
    dependencies: ["runtime"],
    subtasks: [
      {
        id: "deploy-1",
        title: "Load model weights",
        description: "Stream weights from the block volume into GPU memory.",
        status: "pending",
      },
      {
        id: "deploy-2",
        title: "Bind gateway on :8000",
        description: "Expose the OpenAI-compatible endpoint behind the proxy.",
        status: "pending",
      },
    ],
  },
  {
    id: "healthcheck",
    title: "Run health checks",
    description: "Verify the endpoint and register with uptime monitoring.",
    status: "pending",
    dependencies: ["deploy"],
    subtasks: [
      {
        id: "health-1",
        title: "Probe /v1/models",
        description: "Confirm the gateway lists the served model id.",
        status: "pending",
      },
      {
        id: "health-2",
        title: "Register Uptime Kuma monitor",
        description: "Add a heartbeat monitor for prod-inference-01.",
        status: "pending",
      },
    ],
  },
];

export function DeploymentPlan() {
  return (
    <div style={{ maxWidth: 560 }}>
      <AgentPlan tasks={deployTasks} />
    </div>
  );
}

const incidentTasks = [
  {
    id: "triage",
    title: "Triage failed deploy",
    description: "Investigate the failed rollout on prod-inference-01.",
    status: "need-help",
    dependencies: ["prod-inference-01"],
    subtasks: [
      {
        id: "triage-1",
        title: "Pull container logs",
        description: "Retrieve the last 200 lines from the crashed runtime.",
        status: "completed",
      },
      {
        id: "triage-2",
        title: "Out-of-memory on weight load",
        description: "GPU ran out of memory loading the 70B checkpoint.",
        status: "failed",
        tools: ["nvidia-smi", "logs"],
      },
    ],
  },
  {
    id: "remediate",
    title: "Roll back to last backup",
    description: "Restore the previous healthy revision and resize the node.",
    status: "in-progress",
    dependencies: ["triage"],
    subtasks: [
      {
        id: "remediate-1",
        title: "Restore backup 2026-06-18",
        description: "Revert to the last verified snapshot of the instance.",
        status: "in-progress",
        tools: ["backups", "digitalocean"],
      },
      {
        id: "remediate-2",
        title: "Resize droplet to gpu-h100x1",
        description: "Move to a GPU plan with enough VRAM for the model.",
        status: "pending",
      },
    ],
  },
];

export function IncidentPlan() {
  return (
    <div style={{ maxWidth: 560 }}>
      <AgentPlan tasks={incidentTasks} />
    </div>
  );
}
