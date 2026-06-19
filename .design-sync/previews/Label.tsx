import { Label, Input } from "sovereign";
import { Lock } from "lucide-react";

export function WithInput() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      <Label htmlFor="region">Deploy region</Label>
      <Input id="region" defaultValue="nyc3" placeholder="nyc3" />
    </div>
  );
}

export function WithIcon() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      <Label htmlFor="token">
        <Lock /> Gateway token
      </Label>
      <Input id="token" type="password" defaultValue="••••••••••••" />
    </div>
  );
}

export function DisabledGroup() {
  return (
    <div className="group" data-disabled="true" style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 }}>
      <Label htmlFor="provider">VPS provider</Label>
      <Input id="provider" disabled defaultValue="DigitalOcean" />
    </div>
  );
}
