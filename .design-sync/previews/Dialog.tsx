import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
} from "sovereign";
import { Rocket } from "lucide-react";

export function DeployDialog() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button />}>
        <Rocket /> Deploy
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy new instance</DialogTitle>
          <DialogDescription>
            Provision a DigitalOcean droplet and run the inference image.
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Field>
            <FieldLabel>Instance name</FieldLabel>
            <Input defaultValue="prod-inference-02" />
          </Field>
          <Field>
            <FieldLabel>Region</FieldLabel>
            <Input defaultValue="nyc3 · New York" />
            <FieldDescription>
              Closest region to your gateway lowers token latency.
            </FieldDescription>
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge variant="secondary">8 vCPU</Badge>
            <Badge variant="secondary">32 GB</Badge>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              ~$168 / mo
            </span>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Deploy instance</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button variant="outline" />}>Rename</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename instance</DialogTitle>
          <DialogDescription>
            Used across deploys, billing, and the monitoring dashboard.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>Display name</FieldLabel>
          <Input defaultValue="prod-inference-01" />
        </Field>
        <DialogFooter showCloseButton>
          <Button>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
