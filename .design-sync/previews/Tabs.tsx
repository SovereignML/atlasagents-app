import { Tabs, TabsList, TabsTrigger, TabsContent, Badge } from "sovereign";
import { Activity, ScrollText, Settings } from "lucide-react";

export function InstanceTabs() {
  return (
    <Tabs defaultValue="overview" style={{ maxWidth: 420 }}>
      <TabsList>
        <TabsTrigger value="overview">
          <Activity />
          Overview
        </TabsTrigger>
        <TabsTrigger value="logs">
          <ScrollText />
          Logs
        </TabsTrigger>
        <TabsTrigger value="settings">
          <Settings />
          Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge>Running</Badge>
            <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
              Uptime 14d 6h
            </span>
          </div>
          <div style={{ display: "flex", gap: 32 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>CPU</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>38%</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Memory</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>61%</div>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="logs">
        <div style={{ padding: 16, fontFamily: "monospace", fontSize: 12 }}>
          [12:04:11] vLLM server listening on :8000
        </div>
      </TabsContent>
      <TabsContent value="settings">
        <div style={{ padding: 16, fontSize: 13, color: "var(--muted-foreground)" }}>
          Manage region, scaling and gateway tokens.
        </div>
      </TabsContent>
    </Tabs>
  );
}

export function LineTabs() {
  return (
    <Tabs defaultValue="metrics" style={{ maxWidth: 420 }}>
      <TabsList variant="line">
        <TabsTrigger value="metrics">Metrics</TabsTrigger>
        <TabsTrigger value="events">Events</TabsTrigger>
        <TabsTrigger value="alerts">Alerts</TabsTrigger>
      </TabsList>
      <TabsContent value="metrics">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          Requests/min, p95 latency and token throughput.
        </div>
      </TabsContent>
      <TabsContent value="events">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          Deploy and restart history.
        </div>
      </TabsContent>
      <TabsContent value="alerts">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          Uptime-Kuma heartbeat alerts.
        </div>
      </TabsContent>
    </Tabs>
  );
}

export function PillTabs() {
  return (
    <Tabs defaultValue="all" style={{ maxWidth: 420 }}>
      <TabsList variant="pills">
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="running">Running</TabsTrigger>
        <TabsTrigger value="stopped">Stopped</TabsTrigger>
        <TabsTrigger value="errored">Errored</TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          12 instances across 3 regions.
        </div>
      </TabsContent>
      <TabsContent value="running">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          9 instances running.
        </div>
      </TabsContent>
      <TabsContent value="stopped">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          2 instances stopped.
        </div>
      </TabsContent>
      <TabsContent value="errored">
        <div style={{ padding: "16px 4px", fontSize: 13, color: "var(--muted-foreground)" }}>
          1 instance needs attention.
        </div>
      </TabsContent>
    </Tabs>
  );
}
