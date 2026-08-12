import Link from "next/link"
import { ShieldAlert, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react"

import type { RiskLevel, SecurityCounts, VulnerableUser } from "@/lib/admin-security"
import { StatCard } from "@/components/admin/stat-card"
import { TwoFactorCoverage } from "@/components/admin/dashboard-charts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PageSection } from "@/components/layout/page-container"

/**
 * Security posture.
 *
 * Ordered by blast radius, not by count: admins without 2FA sit at the top even
 * when there is one of them and hundreds of unverified end users below, because
 * an admin account can impersonate, ban, refund and delete.
 *
 * Risk is conveyed by icon + word + colour together — never colour alone.
 */

const RISK_META: Record<
  RiskLevel,
  { label: string; badge: "destructive" | "secondary" | "outline"; className: string }
> = {
  critical: { label: "Critical", badge: "destructive", className: "" },
  high: { label: "High", badge: "secondary", className: "text-amber-700 dark:text-amber-400" },
  medium: { label: "Medium", badge: "outline", className: "text-amber-700 dark:text-amber-400" },
  low: { label: "Low", badge: "outline", className: "text-muted-foreground" },
}

export function SecurityTab({
  counts,
  users,
  failed,
}: {
  counts: SecurityCounts | undefined
  users: VulnerableUser[]
  failed: boolean
}) {
  if (failed || !counts) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Security posture unavailable — the query failed. Check the server logs for{" "}
        <code>[admin-security]</code>. Nothing is shown rather than showing zeros, which
        would read as &ldquo;all clear&rdquo;.
      </div>
    )
  }

  const adminsExposed = counts.adminsNoTwoFactor > 0

  return (
    <div className="space-y-8">
      {/* The one alert worth interrupting for. */}
      {adminsExposed && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-destructive">
              {counts.adminsNoTwoFactor} of {counts.totalAdmins} admin{" "}
              {counts.totalAdmins === 1 ? "account" : "accounts"} {counts.adminsNoTwoFactor === 1 ? "has" : "have"}{" "}
              no two-factor authentication
            </p>
            <p className="text-sm text-destructive/80">
              An admin account can impersonate any user, issue refunds, ban accounts and
              delete infrastructure. This is the highest-value credential on the platform
              and should be the first thing fixed.
            </p>
          </div>
        </div>
      )}

      {/* ── Posture KPIs ── */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Admins without 2FA"
          value={counts.adminsNoTwoFactor}
          tone={adminsExposed ? "danger" : "positive"}
          hint={`of ${counts.totalAdmins} total admin${counts.totalAdmins === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Password accounts, no 2FA"
          value={counts.passwordNoTwoFactor}
          tone={counts.passwordNoTwoFactor > 0 ? "warning" : "positive"}
          hint="directly credential-stuffable"
        />
        <StatCard
          label="Exposed live sessions"
          value={counts.exposedLiveSessions}
          tone={counts.exposedLiveSessions > 0 ? "warning" : "positive"}
          hint="signed in right now, no 2FA"
        />
        <StatCard
          label="Unverified emails"
          value={counts.unverifiedEmail}
          tone="muted"
          hint="never confirmed ownership"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Two-factor coverage</CardTitle>
            <CardDescription>Across accounts that hold a local password</CardDescription>
          </CardHeader>
          <CardContent>
            <TwoFactorCoverage
              covered={counts.twoFactorEnabled}
              total={counts.passwordUsers}
              pct={counts.coveragePct}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credential mix</CardTitle>
            <CardDescription>How the user base authenticates</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              <MixRow
                icon={<ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />}
                label="Password + TOTP"
                value={counts.twoFactorEnabled}
                note="strongest local posture"
              />
              <MixRow
                icon={<ShieldAlert className="size-4 text-destructive" />}
                label="Password only"
                value={counts.passwordNoTwoFactor}
                note="no second factor"
              />
              <MixRow
                icon={<ShieldQuestion className="size-4 text-muted-foreground" />}
                label="OAuth only"
                value={counts.oauthOnly}
                note="2FA enforced by Google / Apple / X"
              />
              <MixRow
                icon={<TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />}
                label="TOTP, no backup codes"
                value={counts.twoFactorNoBackupCodes}
                note="lockout risk, not a breach risk"
              />
              <MixRow
                icon={<ShieldAlert className="size-4 text-muted-foreground" />}
                label="Banned"
                value={counts.bannedUsers}
                note="blocked from signing in"
              />
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ── The actual worklist ── */}
      <PageSection
        title="Users to follow up"
        actions={
          <Link href="/admin/users" className="text-sm font-medium text-primary hover:underline">
            All users &rarr;
          </Link>
        }
      >
        {users.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing outstanding</EmptyTitle>
              <EmptyDescription>
                Every active account has a second factor or a federated identity, and all
                emails are verified.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Why</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const meta = RISK_META[u.risk]
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {u.name || "—"}
                          </Link>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "destructive" : "outline"}>
                            {u.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-1.5 text-sm font-medium ${meta.className}`}>
                            {u.risk === "critical" ? (
                              <ShieldAlert className="size-4 shrink-0" />
                            ) : u.risk === "low" ? (
                              <ShieldQuestion className="size-4 shrink-0" />
                            ) : (
                              <TriangleAlert className="size-4 shrink-0" />
                            )}
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <ul className="space-y-0.5">
                            {u.reasons.map((r) => (
                              <li key={r} className="text-xs text-muted-foreground">
                                {r}
                              </li>
                            ))}
                          </ul>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {u.createdAt.toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        <p className="text-xs text-muted-foreground">
          Banned accounts are excluded — they cannot sign in, so they are not live exposure.
          Capped at 100 rows, worst first.
        </p>
      </PageSection>
    </div>
  )
}

function MixRow({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: number
  note: string
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span>
          <span className="block text-foreground">{label}</span>
          <span className="block text-xs text-muted-foreground">{note}</span>
        </span>
      </span>
      <span className="shrink-0 font-mono font-medium tabular-nums text-foreground">{value}</span>
    </li>
  )
}
