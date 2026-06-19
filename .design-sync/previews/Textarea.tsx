import { Textarea } from "sovereign";

export function DeployNotes() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>
        Deploy notes
      </span>
      <Textarea
        defaultValue={
          "Bumped vLLM to 0.6.3 and switched prod-inference-01 to nyc3.\nRolling restart scheduled after backup completes."
        }
        rows={4}
      />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ maxWidth: 420 }}>
      <Textarea
        placeholder="Describe what changed in this deploy (models, regions, scaling)…"
        rows={4}
      />
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
      <Textarea
        aria-invalid
        defaultValue="Webhook URL is missing a scheme"
        rows={2}
      />
      <Textarea disabled defaultValue="Locked while instance is provisioning…" rows={2} />
    </div>
  );
}
