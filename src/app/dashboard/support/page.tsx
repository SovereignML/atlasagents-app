import Link from "next/link"
import { ChevronRight, LifeBuoy, MessageSquare } from "lucide-react"

import { auth } from "@/auth"
import { db, eq, desc, supportTickets } from "@/db"
import { BRANDING } from "@/configs/branding"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { SupportTicketForm } from "@/components/support/support-ticket-form"

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
        description="Open a ticket or start a live chat — our team replies fast."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LifeBuoy className="size-4" /> Contact support
          </CardTitle>
          <CardDescription>
            Submit a ticket and we&apos;ll follow up here and at {BRANDING.supportEmail}. Need a
            faster answer? Use the live chat bubble in the corner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SupportTicketForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My tickets</CardTitle>
          <CardDescription>Tickets you&apos;ve opened, most recent first.</CardDescription>
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
    </PageContainer>
  )
}
