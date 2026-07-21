import Link from "next/link"
import { AlertTriangle, CheckCircle2, Coins, Wallet } from "lucide-react"

import { db, desc, inArray, walletTransactions } from "@/db"
import { requireAdminPage } from "@/lib/admin-guard"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
import { PageContainer, PageHeader, PageSection } from "@/components/layout/page-container"
import { getBillingHealthSnapshot } from "@/lib/billing-reconcile"
import { formatCreditsAsUsd } from "@/lib/credit-pricing"
import { CreditAdjustForm, RunReconcileButton } from "./billing-client"

// Live billing data on every render; never prerender.
export const dynamic = "force-dynamic"
export const revalidate = 0

const TX_LABEL: Record<string, string> = {
  refund: "Reversal",
  admin_grant: "Admin adjustment",
}

export default async function AdminBillingPage() {
  await requireAdminPage()
  const [snapshot, recentMutations] = await Promise.all([
    getBillingHealthSnapshot(),
    db.query.walletTransactions.findMany({
      where: inArray(walletTransactions.type, ["refund", "admin_grant"]),
      orderBy: desc(walletTransactions.createdAt),
      limit: 15,
      with: { wallet: { with: { user: { columns: { id: true, email: true } } } } },
    }),
  ])

  const ledgerOk = snapshot.ledgerMismatches.length === 0
  const bigintOk = snapshot.bigintDrift.length === 0

  return (
    <PageContainer>
      <PageHeader
        title="Billing"
        description="Credit liabilities, ledger integrity, and manual adjustments."
        actions={<RunReconcileButton />}
      />

      {/* ─── Stat cards ─────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Wallet className="size-3.5" /> Outstanding credits
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-primary">
              {snapshot.totals.outstandingCredits.toLocaleString()}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              ≈ {formatCreditsAsUsd(snapshot.totals.outstandingCredits)} owed to customers
            </p>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <Coins className="size-3.5" /> Lifetime funded (net)
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-foreground">
              {snapshot.totals.lifetimeFundedCredits.toLocaleString()}
            </CardTitle>
            <p className="text-xs text-muted-foreground">drives total OpenRouter caps</p>
          </CardHeader>
        </Card>
        <HealthCard
          label="Ledger integrity"
          ok={ledgerOk}
          okText="balance = ledger"
          badText={`${snapshot.ledgerMismatches.length} wallet(s) drifted`}
        />
        <HealthCard
          label="Bigint dual-write"
          ok={bigintOk}
          okText="cents = balance"
          badText={`${snapshot.bigintDrift.length} row(s) drifted`}
        />
      </div>

      {/* ─── Drift / integrity detail ───────────────────────────── */}
      {(!ledgerOk || !bigintOk || snapshot.openDrift.length > 0) && (
        <PageSection title="Needs attention">
          <div className="space-y-3">
            {snapshot.ledgerMismatches.map((m) => (
              <DriftRow
                key={`ledger-${m.walletId}`}
                tag="Ledger"
                userId={m.userId}
                detail={`balance ${m.balance} vs ledger ${m.ledgerSum} (off by ${m.diffCredits} cr)`}
              />
            ))}
            {snapshot.bigintDrift.map((m) => (
              <DriftRow
                key={`bigint-${m.walletId}`}
                tag="Bigint"
                userId={m.userId}
                detail={`balance ${m.balance} vs balanceCents ${m.balanceCents}`}
              />
            ))}
            {snapshot.openDrift.map((n) => (
              <DriftRow key={`alert-${n.id}`} tag="Usage drift" userId={n.userId} detail={n.message} />
            ))}
          </div>
        </PageSection>
      )}

      {/* ─── Manual adjustment ──────────────────────────────────── */}
      <PageSection
        title="Manual credit adjustment"
        description="Grant or remove credits. Logged to the ledger + audit trail; the user is notified."
      >
        <CreditAdjustForm />
      </PageSection>

      {/* ─── Recent reversals & adjustments ─────────────────────── */}
      <PageSection title="Recent reversals & adjustments">
        {recentMutations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing yet</EmptyTitle>
              <EmptyDescription>
                Refunds, disputes, and admin adjustments will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Detail</TableHead>
                  <TableHead className="pr-5 text-right">Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMutations.map((tx) => {
                  const isDebit = tx.amount < 0
                  const user = tx.wallet?.user
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="pl-5 text-sm text-muted-foreground">
                        {tx.createdAt.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {TX_LABEL[tx.type] ?? tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user ? (
                          <Link href={`/admin/users/${user.id}`} className="hover:text-foreground">
                            {user.email}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {tx.description || "-"}
                      </TableCell>
                      <TableCell
                        className={
                          isDebit
                            ? "pr-5 text-right font-mono text-sm text-destructive"
                            : "pr-5 text-right font-mono text-sm text-emerald-600 dark:text-emerald-400"
                        }
                      >
                        {isDebit ? "−" : "+"}
                        {Math.abs(Math.round(tx.amount)).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </PageSection>
    </PageContainer>
  )
}

function HealthCard({
  label,
  ok,
  okText,
  badText,
}: {
  label: string
  ok: boolean
  okText: string
  badText: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={
            ok
              ? "flex items-center gap-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400"
              : "flex items-center gap-2 text-2xl font-bold text-destructive"
          }
        >
          {ok ? <CheckCircle2 className="size-5" /> : <AlertTriangle className="size-5" />}
          {ok ? "OK" : "Drift"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{ok ? okText : badText}</p>
      </CardHeader>
    </Card>
  )
}

function DriftRow({
  tag,
  userId,
  detail,
}: {
  tag: string
  userId: string
  detail: string
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-4">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <Badge variant="destructive" className="font-mono text-[10px]">
              {tag}
            </Badge>
            <Link
              href={`/admin/users/${userId}`}
              className="font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {userId}
            </Link>
          </div>
          <p className="text-sm text-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  )
}
