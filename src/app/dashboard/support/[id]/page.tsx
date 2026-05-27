import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { auth } from "@/auth"
import { db, eq, supportTickets } from "@/db"
import { Button } from "@/components/ui/button"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { TicketThread } from "@/components/support/ticket-thread"

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()
  const userId = session?.user?.id

  const ticket = userId
    ? await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, id),
      })
    : null

  // Owner-scoped: a missing ticket and someone else's ticket are indistinguishable.
  if (!ticket || ticket.userId !== userId) {
    notFound()
  }

  return (
    <PageContainer>
      <PageHeader
        title={ticket.subject}
        description={`${ticket.category} · ${ticket.priority} priority`}
        actions={
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href="/dashboard/support">
                <ArrowLeft className="size-4" /> Back to support
              </Link>
            }
          />
        }
      />

      <TicketThread
        ticketId={ticket.id}
        initial={{
          status: ticket.status,
          message: ticket.message,
          createdAt:
            ticket.createdAt instanceof Date
              ? ticket.createdAt.toISOString()
              : String(ticket.createdAt),
          liveChat: Boolean(ticket.chatwootConversationId),
        }}
      />
    </PageContainer>
  )
}
