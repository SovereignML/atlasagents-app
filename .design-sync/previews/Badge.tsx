import { Badge } from "sovereign";
import { Check, CircleDot, AlertTriangle, Zap } from "lucide-react";

export function StatusPills() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <Badge>
        <span data-icon="inline-start">
          <Check />
        </span>
        Running
      </Badge>
      <Badge variant="outline">Stopped</Badge>
      <Badge variant="destructive">
        <span data-icon="inline-start">
          <AlertTriangle />
        </span>
        Error
      </Badge>
      <Badge variant="secondary">Provisioning</Badge>
    </div>
  );
}

export function InstanceRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--card)",
        maxWidth: 380,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>prod-inference-01</span>
        <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          DigitalOcean · nyc3
        </span>
      </div>
      <Badge>
        <CircleDot />
        Healthy
      </Badge>
    </div>
  );
}

export function CountBadges() {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Badge variant="secondary">3 backups</Badge>
      <Badge variant="outline">v1.42.0</Badge>
      <Badge>
        <Zap />
        Pro
      </Badge>
      <Badge variant="link" render={<a href="#" />}>
        View logs
      </Badge>
    </div>
  );
}
