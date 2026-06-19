import { Button } from "sovereign";
import { ArrowRight, Download, Plus, Settings, Trash2 } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button>Deploy instance</Button>
      <Button variant="contrast">Open</Button>
      <Button variant="outline">Configure</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="ghost">Dismiss</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">View docs</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
      <Button size="pill">Pill</Button>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button>
        <Plus /> New instance
      </Button>
      <Button variant="outline">
        <Download /> Export
      </Button>
      <Button variant="secondary">
        Continue <ArrowRight />
      </Button>
      <Button variant="outline" size="icon" aria-label="Settings">
        <Settings />
      </Button>
      <Button variant="destructive">
        <Trash2 /> Delete
      </Button>
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Button>Enabled</Button>
      <Button disabled>Disabled</Button>
      <Button variant="outline" disabled>
        Disabled
      </Button>
    </div>
  );
}
