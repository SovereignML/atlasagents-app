import { Separator } from "sovereign";

export function SectionDivider() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 320,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Compute</span>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          8 vCPU · 32 GB RAM · 320 GB SSD
        </span>
      </div>
      <Separator />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Networking</span>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          nyc3 · floating IP · Cloudflare proxied
        </span>
      </div>
    </div>
  );
}

export function VerticalMeta() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        height: 24,
        fontSize: 13,
        color: "var(--muted-foreground)",
      }}
    >
      <span style={{ color: "var(--primary)" }}>Running</span>
      <Separator orientation="vertical" />
      <span>14d 6h uptime</span>
      <Separator orientation="vertical" />
      <span>$1,284 / mo</span>
    </div>
  );
}
