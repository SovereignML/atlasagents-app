import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "sovereign";

export function RegionSelect() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 12 }}>
      <Select defaultValue="nyc3">
        <SelectTrigger style={{ width: 260 }} aria-label="Deploy region">
          <SelectValue placeholder="Select a region" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>North America</SelectLabel>
            <SelectItem value="nyc3">New York · nyc3</SelectItem>
            <SelectItem value="sfo3">San Francisco · sfo3</SelectItem>
            <SelectItem value="tor1">Toronto · tor1</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Europe</SelectLabel>
            <SelectItem value="ams3">Amsterdam · ams3</SelectItem>
            <SelectItem value="fra1">Frankfurt · fra1</SelectItem>
            <SelectItem value="lon1">London · lon1</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
