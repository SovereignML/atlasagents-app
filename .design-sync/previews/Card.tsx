import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "sovereign";
import { MoreHorizontal } from "lucide-react";

export function InstanceCard() {
  return (
    <Card style={{ maxWidth: 400 }}>
      <CardHeader>
        <CardTitle>prod-inference-01</CardTitle>
        <CardDescription>DigitalOcean · nyc3 · 8 vCPU / 32 GB</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Badge>Running</Badge>
          <span style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
            Uptime 14d 6h
          </span>
        </div>
        <div style={{ display: "flex", gap: 32 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>CPU</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>38%</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Memory</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>61%</div>
          </div>
        </div>
      </CardContent>
      <CardFooter style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Last deploy 2h ago
        </span>
        <Button variant="outline" size="sm">
          Manage
        </Button>
      </CardFooter>
    </Card>
  );
}

export function StatTile() {
  return (
    <Card size="sm" className="stat-glow" style={{ maxWidth: 280 }}>
      <CardHeader>
        <CardDescription>Monthly spend</CardDescription>
        <CardTitle style={{ fontSize: 30 }}>$1,284</CardTitle>
      </CardHeader>
      <CardContent>
        <span style={{ color: "var(--primary)", fontSize: 13, fontWeight: 500 }}>
          ▲ 12% vs last month
        </span>
      </CardContent>
    </Card>
  );
}
