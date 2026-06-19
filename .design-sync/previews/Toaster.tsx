import { Button, Toaster } from "sovereign";
import { toast } from "sonner";
import { CircleCheck, OctagonX, X } from "lucide-react";

// A fired sonner toast portals in only after an event + animation, so it can't
// be captured statically. We mount the real <Toaster /> surface and wire a
// button to toast(...), then render representative static notification rows
// that mirror the shipped toast styling (popover bg, hairline border, icons).
export function NotificationSurface() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, maxWidth: 420 }}>
      <Toaster />

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: "var(--radius)",
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <CircleCheck size={16} style={{ color: "var(--primary)", marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Deploy complete</div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
            prod-inference-01 is live in nyc3.
          </div>
        </div>
        <X size={14} style={{ color: "var(--muted-foreground)" }} />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "12px 14px",
          borderRadius: "var(--radius)",
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <OctagonX size={16} style={{ color: "var(--destructive)", marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Backup failed</div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
            DigitalOcean snapshot timed out. Retry available.
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--primary)" }}>Retry</span>
      </div>

      <Button
        variant="outline"
        size="sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() =>
          toast.success("Deploy complete", {
            description: "prod-inference-01 is live in nyc3.",
          })
        }
      >
        Trigger toast
      </Button>
    </div>
  );
}
