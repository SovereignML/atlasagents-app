import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
} from "sovereign";
import { Search, Copy, Globe, KeyRound } from "lucide-react";

export function DomainField() {
  return (
    <div style={{ maxWidth: 420 }}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Globe />
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput defaultValue="prod-inference-01" />
        <InputGroupAddon align="inline-end">
          <InputGroupText>.sovereignml.app</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

export function ApiKeyField() {
  return (
    <div style={{ maxWidth: 420 }}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <KeyRound />
        </InputGroupAddon>
        <InputGroupInput defaultValue="sk-or-v1-3f9a2c84d1e7b6f0a5c2" readOnly />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Copy key">
            <Copy />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

export function SearchWithButton() {
  return (
    <div style={{ maxWidth: 420 }}>
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupInput placeholder="Filter deploys by region or status…" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="contrast">Search</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
