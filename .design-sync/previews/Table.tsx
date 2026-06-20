import {
  Badge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "sovereign";

const INSTANCES = [
  { name: "prod-inference-01", provider: "DigitalOcean", region: "nyc3", status: "Running", variant: "default", cpu: 38 },
  { name: "prod-inference-02", provider: "DigitalOcean", region: "nyc3", status: "Running", variant: "default", cpu: 52 },
  { name: "staging-router-01", provider: "DigitalOcean", region: "sfo3", status: "Provisioning", variant: "secondary", cpu: 12 },
  { name: "batch-embed-eu", provider: "Hetzner", region: "fsn1", status: "Stopped", variant: "outline", cpu: 0 },
  { name: "agent-sandbox-03", provider: "DigitalOcean", region: "ams3", status: "Failed", variant: "destructive", cpu: 0 },
] as const;

function cpuColor(cpu: number) {
  if (cpu === 0) return "var(--muted-foreground)";
  if (cpu >= 75) return "var(--destructive)";
  return "var(--foreground)";
}

export function InstancesTable() {
  return (
    <div style={{ maxWidth: 720 }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Instance</TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Status</TableHead>
            <TableHead style={{ textAlign: "right" }}>CPU</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {INSTANCES.map((i) => (
            <TableRow key={i.name}>
              <TableCell style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>
                {i.name}
              </TableCell>
              <TableCell style={{ color: "var(--muted-foreground)" }}>{i.provider}</TableCell>
              <TableCell style={{ color: "var(--muted-foreground)" }}>{i.region}</TableCell>
              <TableCell>
                <Badge variant={i.variant}>{i.status}</Badge>
              </TableCell>
              <TableCell
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: cpuColor(i.cpu),
                }}
              >
                {i.cpu === 0 ? "—" : `${i.cpu}%`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function BackupsTable() {
  const rows = [
    { id: "bkp_9f2a", instance: "prod-inference-01", size: "4.2 GB", when: "2h ago", status: "Complete", variant: "default" },
    { id: "bkp_7c10", instance: "prod-inference-02", size: "3.9 GB", when: "1d ago", status: "Complete", variant: "default" },
    { id: "bkp_5b81", instance: "staging-router-01", size: "1.1 GB", when: "3d ago", status: "Expired", variant: "outline" },
  ] as const;

  return (
    <div style={{ maxWidth: 640 }}>
      <Table>
        <TableCaption>Automated nightly snapshots · retained 14 days</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Backup</TableHead>
            <TableHead>Instance</TableHead>
            <TableHead style={{ textAlign: "right" }}>Size</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell style={{ fontFamily: "var(--font-mono, monospace)" }}>{r.id}</TableCell>
              <TableCell style={{ color: "var(--muted-foreground)" }}>{r.instance}</TableCell>
              <TableCell style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.size}
              </TableCell>
              <TableCell style={{ color: "var(--muted-foreground)" }}>{r.when}</TableCell>
              <TableCell>
                <Badge variant={r.variant}>{r.status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
