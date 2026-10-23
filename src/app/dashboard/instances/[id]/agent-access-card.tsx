"use client"

import { ArrowUpRight, Copy, ExternalLink, MessageSquare } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { useAgentChat } from "@/components/agent-chat/agent-chat-provider"
import { addressLabel, type ChatAgent } from "@/lib/chat-windows"

/**
 * How to reach an agent. Agents with a chat page lead with the chat inside the
 * dashboard; every agent also lists its own addresses (hostname or custom
 * domain, and the IP as a fallback) to open directly.
 */
export function AgentAccessCard({
  agent,
  dashboardChat,
  canChat,
  hostname,
  ipAddress,
  hostnameNote,
}: {
  agent: ChatAgent
  /** The agent's chat page can open in the dashboard (AgentWebUI Lite). */
  dashboardChat: boolean
  /** Operator or above: chatting runs the agent. */
  canChat: boolean
  /** The agent's primary address (custom domain or managed hostname), or null for a raw-IP agent. */
  hostname: { url: string; kind: "domain" | "managed" } | null
  ipAddress: string | null
  /** TLS status line for the hostname, if any. */
  hostnameNote: string | null
}) {
  const { openChat, openChatInNewTab } = useAgentChat()
  // The chat signs in over HTTPS only (its framed cookie needs it).
  const chatReady = dashboardChat && canChat && Boolean(agent.publicUrl?.startsWith("https://"))

  return (
    <Card>
      <CardHeader>
        <CardDescription className="font-mono text-[10px] tracking-[0.1em] uppercase">Access</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {dashboardChat && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-foreground">Chat with {agent.name}</p>
              <p className="text-xs text-muted-foreground">
                {!canChat
                  ? "Chatting runs the agent, so it needs Operator access. Ask a manager of this agent."
                  : chatReady
                    ? "Opens right here, already signed in. Minimize it to keep working; it stays open while you move around the dashboard."
                    : "The chat opens here once the agent's HTTPS certificate is ready. Until then, use its address below."}
              </p>
            </div>
            {canChat && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button onClick={() => openChat(agent)} disabled={!chatReady}>
                  <MessageSquare data-icon="inline-start" />
                  Open chat
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openChatInNewTab(agent)}
                  disabled={!chatReady}
                  title="Opens the chat at the agent's own address, signed in"
                >
                  <ExternalLink data-icon="inline-start" />
                  New tab
                </Button>
              </div>
            )}
          </div>
        )}

        {hostname || ipAddress ? (
          <div className="divide-y divide-border rounded-xl border border-border">
            {hostname && (
              <AddressRow
                label={hostname.kind === "domain" ? "Custom domain" : "Hostname"}
                url={hostname.url}
                note={hostnameNote}
              />
            )}
            {ipAddress && (
              <AddressRow
                label={hostname ? "Direct IP · fallback" : "Direct IP"}
                url={`http://${ipAddress}`}
                note={
                  hostname
                    ? "For when the hostname is unavailable. HTTP only; allow port 80 on the server's firewall."
                    : "HTTP only. A managed hostname or custom domain enables HTTPS."
                }
              />
            )}
            {dashboardChat && (
              <p className="px-4 py-2.5 text-xs text-muted-foreground">
                At these addresses the chat asks you to sign in with the chat login in Overview.
              </p>
            )}
          </div>
        ) : (
          <p className="font-mono text-sm text-muted-foreground">Provisioning… no public access yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

function AddressRow({ label, url, note }: { label: string; url: string; note: string | null }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Address copied")
    } catch {
      toast.error("Copy failed")
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          className="group mt-0.5 inline-flex max-w-full items-center gap-1 font-mono text-sm text-foreground hover:text-primary"
        >
          <span className="truncate">{addressLabel(url)}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
        </a>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      <Button size="xs" variant="ghost" onClick={copy} aria-label={`Copy ${label}`}>
        <Copy data-icon="inline-start" />
        Copy
      </Button>
    </div>
  )
}
