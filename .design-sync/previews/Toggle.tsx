import { Toggle } from "sovereign";
import { Bell, Star, Wifi } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Toggle defaultPressed>Auto-scale</Toggle>
      <Toggle variant="outline">Maintenance mode</Toggle>
      <Toggle variant="outline" defaultPressed>
        Pinned
      </Toggle>
    </div>
  );
}

export function WithIcons() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Toggle variant="outline" defaultPressed aria-label="Toggle alerts">
        <Bell /> Alerts
      </Toggle>
      <Toggle variant="outline" aria-label="Toggle favorite">
        <Star /> Favorite
      </Toggle>
      <Toggle variant="outline" aria-label="Toggle uptime ping">
        <Wifi /> Uptime ping
      </Toggle>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
      <Toggle variant="outline" size="sm" defaultPressed>
        Small
      </Toggle>
      <Toggle variant="outline" size="default" defaultPressed>
        Default
      </Toggle>
      <Toggle variant="outline" size="lg" defaultPressed>
        Large
      </Toggle>
      <Toggle variant="outline" disabled>
        Disabled
      </Toggle>
    </div>
  );
}
