import { ThemeToggle } from "sovereign";

// next-themes has no provider in this preview, so the toggle renders its
// default (Moon) icon-button state. Shown standalone and inside a console
// top-bar the way it appears next to account controls.
export function Control() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <ThemeToggle />
    </div>
  );
}

export function InToolbar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        width: 420,
        padding: "10px 16px",
        borderRadius: 12,
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
        prod-inference-01
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Appearance
        </span>
        <ThemeToggle />
      </div>
    </div>
  );
}
