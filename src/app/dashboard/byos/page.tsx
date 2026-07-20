import Link from "next/link"
import { redirect } from "next/navigation"
import {
  Server,
  Plus,
  KeyRound,
  Wallet,
  Check,
} from "lucide-react"

import { auth } from "@/auth"
import { db, desc, instances } from "@/db"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { whereUserInstancesVisible } from "@/lib/instance-queries"
import { getEffectiveUserId } from "@/lib/effective-user"
import { BYOS_PLAN, formatUsd } from "@/configs/plans"

const PLAN_FEATURES = [
  "100 AI credits included (managed mode)",
  "Full monitoring & alerts",
  "Managed updates & backups",
  "No vendor lock-in",
]

export default async function ByosPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  // Resolve through impersonation so an admin viewing-as a user sees their agents.
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const rows = await db.query.instances.findMany({
    where: whereUserInstancesVisible(effectiveUserId),
    orderBy: desc(instances.createdAt),
  })

  const items = rows.filter(
    (i) => i.deploymentTarget === "byos" && i.status !== "deleted",
  )

  return (
    <PageContainer>
      <PageHeader
        title="Bring Your Own Server"
        description="Run managed agents on infrastructure you own. Sovereign by default — your data never leaves your box."
      />

      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        {/* LEFT COLUMN */}
        <div className="space-y-[18px]">
          {/* Connect-a-server intro card */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Server className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h2 className="text-base font-semibold text-foreground">
                  Connect a server
                </h2>
                <p className="text-sm text-muted-foreground">
                  Paste our fleet SSH key into your box and we&apos;ll act as
                  its management panel: deploy, monitor, restart, and configure
                  your agent. No user SSH secret is ever stored.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-center">
              <Button
                variant="gradient"
                size="pill"
                render={
                  <Link href="/dashboard/byos/connect">
                    <Plus data-icon="inline-start" />
                    Connect a server
                  </Link>
                }
              />
            </div>
          </div>

          {/* Connected servers */}
          {items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>No connected servers yet</EmptyTitle>
                <EmptyDescription>
                  Connect a server you own and we&apos;ll act as its management
                  panel: deploy, monitor, restart, and configure your agent.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2 className="text-base font-semibold text-foreground">
                  Connected servers
                </h2>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  {items.length} {items.length === 1 ? "server" : "servers"}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-sidebar">
                      <th className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Server
                      </th>
                      <th className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Specs
                      </th>
                      <th className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Agents
                      </th>
                      <th className="px-5 py-2.5 text-left font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        Status
                      </th>
                      <th className="px-5 py-2.5 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((i) => {
                      const host =
                        i.byosHost ?? i.ipAddress ?? null
                      const port =
                        i.byosPort && i.byosPort !== 22 ? `:${i.byosPort}` : ""
                      const addr = host
                        ? `${i.byosUser ?? "root"}@${host}${port}`
                        : null
                      const isConnected =
                        i.status === "running"
                      return (
                        <tr
                          key={i.id}
                          className="group transition-colors hover:bg-muted/40"
                        >
                          <td className="px-5 py-4">
                            <Link
                              href={`/dashboard/instances/${i.id}`}
                              className="flex items-center gap-3"
                            >
                              <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground">
                                <Server className="size-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-foreground">
                                  {i.name}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                  {addr ?? "—"}
                                </span>
                              </span>
                            </Link>
                          </td>
                          <td className="px-5 py-4 font-mono text-[12px] text-muted-foreground">
                            —
                          </td>
                          <td className="px-5 py-4 font-mono text-[12px] text-muted-foreground">
                            —
                          </td>
                          <td className="px-5 py-4">
                            {isConnected ? (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-foreground/80">
                                <span className="relative flex size-2">
                                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
                                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                                </span>
                                connected
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                                <span className="inline-flex size-2 rounded-full bg-muted-foreground/50" />
                                {i.status.replace(/_/g, " ")}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                              {i.byosLlmMode === "own_key" ? (
                                <>
                                  <KeyRound className="size-3.5" /> own key
                                </>
                              ) : (
                                <>
                                  <Wallet className="size-3.5" /> credits
                                </>
                              )}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT RAIL — BYOS plan */}
        <aside className="rounded-2xl border border-border bg-card p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            BYOS plan
          </p>
          <div className="mt-2 flex items-end gap-1.5">
            <span className="font-mono text-4xl font-semibold leading-none text-primary">
              {formatUsd(BYOS_PLAN.displayPriceMonthly)}
            </span>
            <span className="pb-0.5 text-sm text-muted-foreground">/mo</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            A flat monthly fee per connected server. We manage the agent; you
            keep the hardware and the data. Managed-AI servers start with 100
            credits, then top up anytime.
          </p>
          <ul className="mt-5 space-y-3">
            {PLAN_FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2.5 text-sm text-foreground/90"
              >
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </PageContainer>
  )
}
