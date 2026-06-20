import { Input } from "sovereign";

export function InstanceName() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}>
        Instance name
      </span>
      <Input defaultValue="prod-inference-01" placeholder="my-instance" />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
      <Input placeholder="Search instances and deploys…" />
      <Input type="email" placeholder="teammate@acme.io" />
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
      <Input defaultValue="nyc3" placeholder="Region" />
      <Input aria-invalid defaultValue="bad-name!" placeholder="Instance name" />
      <Input disabled defaultValue="locked-while-deploying" />
    </div>
  );
}
