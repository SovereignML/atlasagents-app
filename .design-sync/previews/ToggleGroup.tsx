import { ToggleGroup, ToggleGroupItem } from "sovereign";
import { LayoutGrid, List, Rows3 } from "lucide-react";

export function ViewMode() {
  return (
    <ToggleGroup variant="outline" defaultValue={["grid"]}>
      <ToggleGroupItem value="grid" aria-label="Grid view">
        <LayoutGrid /> Grid
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List view">
        <List /> List
      </ToggleGroupItem>
      <ToggleGroupItem value="rows" aria-label="Compact rows">
        <Rows3 /> Compact
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export function Environment() {
  return (
    <ToggleGroup variant="outline" spacing={1} defaultValue={["prod"]}>
      <ToggleGroupItem value="dev">Dev</ToggleGroupItem>
      <ToggleGroupItem value="staging">Staging</ToggleGroupItem>
      <ToggleGroupItem value="prod">Prod</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function Vertical() {
  return (
    <ToggleGroup
      variant="outline"
      orientation="vertical"
      defaultValue={["nyc3"]}
      style={{ width: 200 }}
    >
      <ToggleGroupItem value="nyc3">New York (nyc3)</ToggleGroupItem>
      <ToggleGroupItem value="sfo3">San Francisco (sfo3)</ToggleGroupItem>
      <ToggleGroupItem value="ams3">Amsterdam (ams3)</ToggleGroupItem>
    </ToggleGroup>
  );
}
