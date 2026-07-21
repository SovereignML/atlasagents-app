import Link from "next/link"
import { ChevronRight, MessageSquare, Mail } from "lucide-react"

import { auth } from "@/auth"
import { db, eq, desc, supportTickets } from "@/db"
import { BRANDING } from "@/configs/branding"
import { KB_CATEGORIES, categoryArticleCount } from "@/configs/knowledge-base"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { SupportTicketForm } from "@/components/support/support-ticket-form"
import {
  LiveChatButton,
  StartConversationButton,
  SupportFaq,
  SupportSearch,
} from "./support-widgets"

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  pending: "Awaiting your reply",
  resolved: "Resolved",
}

export default async function SupportPage() {
  const session = await auth()
  const userId = session?.user?.id

  const tickets = userId
    ? await db.query.supportTickets.findMany({
        where: eq(supportTickets.userId, userId),
        orderBy: desc(supportTickets.createdAt),
      })
    : []

  return (
    <PageContainer>
      <PageHeader
        title="Support"
        description="Grounded help from a team that runs agents in the real world."
      />

      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        {/* LEFT COLUMN */}
        <div className="space-y-[18px]">
          {/* Hero search card */}
          <div className="console-hero relative overflow-hidden rounded-2xl border border-border p-8">
            <SupportSearch />
          </div>

          {/* Category cards */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {KB_CATEGORIES.map((cat) => {
              const Icon = cat.icon
              const count = categoryArticleCount(cat)
              return (
                <Link
                  key={cat.title}
                  href={`/docs#${cat.sectionIds[0]}`}
                  className="rounded-2xl border border-border bg-card p-5 transition-colors hover:bg-muted/50"
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl ${cat.tile}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <p className="mt-3.5 text-sm font-medium text-foreground">
                    {cat.title}
                  </p>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {count} article{count === 1 ? "" : "s"}
                  </p>
                </Link>
              )
            })}
          </div>

          {/* Popular questions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Popular questions</CardTitle>
            </CardHeader>
            <CardContent>
              <SupportFaq />
            </CardContent>
          </Card>

          {/* Contact form */}
          <Card id="ticket-form" className="scroll-mt-24">
            <CardHeader>
              <CardTitle className="text-lg">Contact support</CardTitle>
              <CardDescription>
                Submit a ticket and we&apos;ll follow up here and at{" "}
                {BRANDING.supportEmail}. Need a faster answer? Use the live chat
                bubble in the corner.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SupportTicketForm />
            </CardContent>
          </Card>

          {/* My tickets */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My tickets</CardTitle>
              <CardDescription>
                Tickets you&apos;ve opened, most recent first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You haven&apos;t opened any tickets yet.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/dashboard/support/${t.id}`}
                        className="-mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium">{t.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            {t.category} · {t.priority} ·{" "}
                            {new Date(t.createdAt).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                            {t.chatwootConversationId && (
                              <span className="ml-2 inline-flex items-center gap-1 text-foreground/70">
                                <MessageSquare className="size-3" /> in live chat
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {STATUS_LABELS[t.status] ?? t.status}
                          </Badge>
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT RAIL — Still stuck? */}
        <aside className="lg:sticky lg:top-20">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-foreground">
              Still stuck?
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Open a ticket or start a live chat. Our team replies fast.
            </p>
            <div className="mt-5 space-y-2.5">
              <StartConversationButton />
              <LiveChatButton />
              <a
                href={`mailto:${BRANDING.supportEmail}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                <Mail className="size-4" />
                Email support
              </a>
            </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  )
}
