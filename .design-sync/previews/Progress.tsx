import { Progress } from "sovereign";

export function DeployProgress() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 360,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
        }}
      >
        <span style={{ fontWeight: 500 }}>Deploying prod-inference-01</span>
        <span style={{ color: "var(--muted-foreground)" }}>62%</span>
      </div>
      <Progress value={62} />
      <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        Pulling container image · step 4 of 7
      </span>
    </div>
  );
}

export function BackupStages() {
  const stages = [
    { label: "Snapshot volume", value: 100 },
    { label: "Encrypt archive", value: 78 },
    { label: "Upload to R2", value: 24 },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 360,
      }}
    >
      {stages.map((s) => (
        <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
            }}
          >
            <span>{s.label}</span>
            <span style={{ color: "var(--muted-foreground)" }}>{s.value}%</span>
          </div>
          <Progress value={s.value} />
        </div>
      ))}
    </div>
  );
}

export function QuotaUsed() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 320,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500 }}>Token quota</span>
      <Progress value={91} />
      <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
        9.1M / 10M tokens used this cycle
      </span>
    </div>
  );
}
