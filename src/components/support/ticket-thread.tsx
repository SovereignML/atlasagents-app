"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
}

const POLL_MS = 10_000

type ChatMessage = {
  id: number
  content: string
  author: "customer" | "agent" | "system"
  createdAt: number
  senderName: string | null
}

type TicketThreadProps = {
  ticketId: string
  initial: {
    status: string
    message: string
    createdAt: string
    liveChat: boolean
  }
}

function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return ""
  return new Date(unixSeconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function TicketThread({ ticketId, initial }: TicketThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState(initial.status)
  const [liveChat, setLiveChat] = useState(initial.liveChat)
  const [loaded, setLoaded] = useState(false)
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        credentials: "include",
      })
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages ?? [])
      setLiveChat(Boolean(data.liveChat))
      if (data.ticket?.status) setStatus(data.ticket.status)
    } finally {
      setLoaded(true)
    }
  }, [ticketId])

  // Fetch on mount, then poll so agent replies / status changes show up.
  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Keep the latest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" })
  }, [messages.length])

  async function onSend(e: React.FormEvent) {
    e.preventDefault()
    const content = reply.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? "Failed to send reply")
        return
      }
      setReply("")
      await load()
    } catch {
      toast.error("Something went wrong. Please try again.")
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Conversation</span>
          <Badge variant="outline" className="capitalize">
            {STATUS_LABELS[status] ?? status}
          </Badge>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {/* The original ticket message — always shown, even before live chat
              messages load (or when the ticket fell back to email). */}
          <Bubble author="customer">{initial.message}</Bubble>

          {messages
            // Skip the first incoming message: it's the original ticket body we
            // already render above (Chatwoot stores it as the opening message).
            .filter((m, i) => !(i === 0 && m.author === "customer"))
            .map((m) =>
              m.author === "system" ? (
                <p key={m.id} className="text-center text-xs text-muted-foreground">
                  {m.content}
                </p>
              ) : (
                <Bubble key={m.id} author={m.author} time={formatTime(m.createdAt)} name={m.senderName}>
                  {m.content}
                </Bubble>
              ),
            )}
          <div ref={endRef} />
        </div>

        {liveChat ? (
          <form onSubmit={onSend} className="flex items-end gap-2">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type a reply…"
              rows={2}
              maxLength={5000}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void onSend(e)
              }}
            />
            <Button type="submit" disabled={sending || !reply.trim()}>
              <Send className="size-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loaded
              ? "This ticket was sent by email and isn't connected to live chat. Our team will reply by email."
              : "Loading conversation…"}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Bubble({
  author,
  time,
  name,
  children,
}: {
  author: "customer" | "agent"
  time?: string
  name?: string | null
  children: React.ReactNode
}) {
  const isCustomer = author === "customer"
  return (
    <div className={cn("flex flex-col", isCustomer ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isCustomer ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {children}
      </div>
      {(time || name) && (
        <span className="mt-1 text-[11px] text-muted-foreground">
          {[name, time].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  )
}
