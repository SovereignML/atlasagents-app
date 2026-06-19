import { ScrollArea } from "sovereign";

const LOG = [
  { t: "12:04:31", level: "info", msg: "Pulling image ghcr.io/sovereignml/inference:0.9.2" },
  { t: "12:04:38", level: "info", msg: "Image pulled (1.84 GB) in 6.9s" },
  { t: "12:04:39", level: "info", msg: "Provisioning droplet on DigitalOcean nyc3" },
  { t: "12:04:55", level: "info", msg: "Droplet 412889201 created · 8 vCPU / 32 GB" },
  { t: "12:05:02", level: "warn", msg: "Cloudflare DNS propagation pending for prod-inference-01" },
  { t: "12:05:21", level: "info", msg: "Attaching block volume vol-nyc3-7c1 (200 GB)" },
  { t: "12:05:40", level: "info", msg: "Starting container · gateway token minted" },
  { t: "12:05:44", level: "info", msg: "Health check :8080/healthz → 200 OK" },
  { t: "12:05:45", level: "warn", msg: "Model weights cache miss · downloading Claude adapter" },
  { t: "12:06:18", level: "info", msg: "Adapter cached (412 MB)" },
  { t: "12:06:19", level: "info", msg: "Uptime-Kuma monitor registered (id 38)" },
  { t: "12:06:20", level: "ok", msg: "Deploy complete · prod-inference-01 is Running" },
];

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--muted-foreground)",
  warn: "var(--chart-4)",
  ok: "var(--primary)",
};

export function DeployLog() {
  return (
    <ScrollArea
      style={{
        height: 240,
        width: 560,
        maxWidth: "100%",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
        {LOG.map((l, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12.5,
              lineHeight: 1.7,
            }}
          >
            <span style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{l.t}</span>
            <span
              style={{
                color: LEVEL_COLOR[l.level] ?? "var(--muted-foreground)",
                textTransform: "uppercase",
                width: 38,
                flexShrink: 0,
              }}
            >
              {l.level}
            </span>
            <span style={{ color: "var(--foreground)" }}>{l.msg}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export function InstanceList() {
  const instances = [
    "prod-inference-01", "prod-inference-02", "staging-router-01",
    "batch-embed-eu", "agent-sandbox-03", "agent-sandbox-04",
    "nightly-eval-01", "vector-store-nyc", "vector-store-ams",
    "webhook-relay-01", "dev-playground-07", "canary-router-02",
  ];

  return (
    <ScrollArea
      style={{
        height: 220,
        width: 360,
        maxWidth: "100%",
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card)",
      }}
    >
      <div style={{ padding: 6 }}>
        {instances.map((name, i) => (
          <div
            key={name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: i % 5 === 3 ? "var(--muted-foreground)" : "var(--primary)",
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{name}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
