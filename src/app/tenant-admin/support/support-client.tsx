"use client"

import { useCallback, useEffect, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type Conversation = {
  id: number
  status: string
  contactName: string | null
  subject: string | null
  updatedAt: number
}

type Message = {
  id: number
  content: string
  author: "customer" | "agent" | "system"
  createdAt: number
  senderName: string | null
}

export function SupportInboxClient() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/tenant-admin/support?status=open")
      const data = res.ok ? await res.json() : { conversations: [] }
      setConversations(data.conversations ?? [])
    } catch {
      setError("Could not load conversations")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadThread = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/tenant-admin/support/${id}`)
      const data = res.ok ? await res.json() : { messages: [] }
      setMessages(data.messages ?? [])
    } catch {
      setError("Could not load the conversation")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList()
  }, [loadList])

  // Poll the open thread for new messages.
  useEffect(() => {
    if (selected == null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadThread(selected)
    const t = setInterval(() => void loadThread(selected), 10_000)
    return () => clearInterval(t)
  }, [selected, loadThread])

  async function send() {
    if (selected == null || !reply.trim()) return
    setSending(true)
    setError(null)
    const res = await fetch(`/api/tenant-admin/support/${selected}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: reply }),
    })
    setSending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Failed to send")
      return
    }
    setReply("")
    void loadThread(selected)
  }

  async function setStatus(status: "resolved" | "open") {
    if (selected == null) return
    await fetch(`/api/tenant-admin/support/${selected}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    void loadList()
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="divide-y">
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No open conversations.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelected(c.id)}
                  className={`flex w-full flex-col items-start gap-1 p-3 text-left hover:bg-muted/50 ${
                    selected === c.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="text-sm font-medium">{c.contactName || `Conversation #${c.id}`}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">{c.subject || "-"}</span>
                  <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="flex min-h-[420px] flex-col p-0">
          {selected == null ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b p-3">
                <span className="text-sm font-medium">Conversation #{selected}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setStatus("resolved")}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus("open")}>
                    Reopen
                  </Button>
                </div>
              </div>
              <div className="flex-1 space-y-3 overflow-auto p-4">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      m.author === "agent"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : m.author === "system"
                          ? "mx-auto bg-muted text-xs text-muted-foreground"
                          : "bg-muted"
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No messages yet.</p>
                )}
              </div>
              <CardContent className="border-t pt-3">
                <div className="flex gap-2">
                  <Input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type a reply…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                  />
                  <Button onClick={() => void send()} disabled={sending || !reply.trim()}>
                    Send
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
