import {
  Badge,
  Button,
  Field,
  FieldLabel,
  Input,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "sovereign";
import { SlidersHorizontal } from "lucide-react";

export function FiltersSheet() {
  return (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button variant="outline" />}>
        <SlidersHorizontal /> Filters
      </SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Filter instances</SheetTitle>
          <SheetDescription>
            Narrow the fleet by provider, status, and region.
          </SheetDescription>
        </SheetHeader>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            padding: "0 16px",
          }}
        >
          <Field>
            <FieldLabel>Search name</FieldLabel>
            <Input placeholder="prod-inference-…" />
          </Field>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              Status
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Badge>Running</Badge>
              <Badge variant="secondary">Provisioning</Badge>
              <Badge variant="secondary">Stopped</Badge>
              <Badge variant="secondary">Errored</Badge>
            </div>
          </div>
          <Separator />
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              Region
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Badge variant="secondary">nyc3</Badge>
              <Badge variant="secondary">sfo3</Badge>
              <Badge variant="secondary">ams3</Badge>
            </div>
          </div>
        </div>
        <SheetFooter>
          <Button>Apply filters</Button>
          <Button variant="ghost">Reset</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function InstanceDetailSheet() {
  return (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button variant="outline" />}>Details</SheetTrigger>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>prod-inference-01</SheetTitle>
          <SheetDescription>DigitalOcean · nyc3</SheetDescription>
        </SheetHeader>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: "0 16px",
            fontSize: 13,
          }}
        >
          <Row label="Status" value="Running" accent />
          <Separator />
          <Row label="Size" value="8 vCPU / 32 GB" />
          <Row label="Uptime" value="14d 6h" />
          <Row label="Token quota" value="2.4M / 5M" />
          <Row label="Monthly spend" value="$168.00" />
        </div>
        <SheetFooter>
          <Button>Manage</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ color: accent ? "var(--primary)" : "var(--foreground)", fontWeight: 500 }}>
        {value}
      </span>
    </div>
  );
}
