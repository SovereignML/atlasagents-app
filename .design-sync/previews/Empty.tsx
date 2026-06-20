import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
  Button,
} from "sovereign";
import { Server, Plus, Database } from "lucide-react";

export function NoInstances() {
  return (
    <Empty style={{ maxWidth: 420 }}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Server />
        </EmptyMedia>
        <EmptyTitle>No instances yet</EmptyTitle>
        <EmptyDescription>
          Deploy your first self-hosted inference instance to DigitalOcean and
          start serving models in minutes.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>
          <Plus />
          Deploy instance
        </Button>
        <Button variant="ghost" size="sm">
          Browse templates
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function NoBackups() {
  return (
    <Empty style={{ maxWidth: 420 }}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Database />
        </EmptyMedia>
        <EmptyTitle>No backups found</EmptyTitle>
        <EmptyDescription>
          prod-inference-01 has no snapshots yet. Create one or enable a daily
          schedule.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm">
          Create backup
        </Button>
      </EmptyContent>
    </Empty>
  );
}
