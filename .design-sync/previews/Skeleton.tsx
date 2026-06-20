import { Skeleton } from "sovereign";

export function InstanceRowLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 400,
      }}
    >
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <Skeleton style={{ height: 36, width: 36, borderRadius: 9999 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <Skeleton style={{ height: 12, width: "55%" }} />
            <Skeleton style={{ height: 10, width: "35%" }} />
          </div>
          <Skeleton style={{ height: 20, width: 64, borderRadius: 9999 }} />
        </div>
      ))}
    </div>
  );
}

export function StatTileLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--border)",
        background: "var(--card)",
        maxWidth: 240,
      }}
    >
      <Skeleton style={{ height: 12, width: 96 }} />
      <Skeleton style={{ height: 28, width: 128 }} />
      <Skeleton style={{ height: 8, width: "100%", borderRadius: 9999 }} />
    </div>
  );
}
