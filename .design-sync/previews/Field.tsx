import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
  Input,
  Textarea,
} from "sovereign";

export function WithDescription() {
  return (
    <div style={{ maxWidth: 420 }}>
      <Field>
        <FieldLabel htmlFor="f-name">Instance name</FieldLabel>
        <Input id="f-name" defaultValue="prod-inference-01" />
        <FieldDescription>
          Used in DNS and dashboards. Lowercase letters, numbers and dashes only.
        </FieldDescription>
      </Field>
    </div>
  );
}

export function WithError() {
  return (
    <div style={{ maxWidth: 420 }}>
      <Field data-invalid="true">
        <FieldLabel htmlFor="f-domain">Custom domain</FieldLabel>
        <Input id="f-domain" aria-invalid defaultValue="inference.acme" />
        <FieldError errors={[{ message: "Domain must include a valid TLD (e.g. .com)." }]} />
      </Field>
    </div>
  );
}

export function FieldSetGroup() {
  return (
    <div style={{ maxWidth: 420 }}>
      <FieldSet>
        <FieldLegend>Backup schedule</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="f-window">Window</FieldLabel>
            <Input id="f-window" defaultValue="02:00 UTC" />
            <FieldDescription>Daily snapshot of prod-inference-01 to nyc3.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="f-notes">Retention notes</FieldLabel>
            <Textarea id="f-notes" defaultValue="Keep 7 daily, 4 weekly." rows={2} />
          </Field>
        </FieldGroup>
      </FieldSet>
    </div>
  );
}
