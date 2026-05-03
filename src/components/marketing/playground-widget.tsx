"use client"

import { useState } from "react"

type Msg = { role: "user" | "bot"; text: string }

const CANNED: Record<string, string> = {
  default: "I'm a demo bot. Sign up to deploy your own — I can triage tickets, qualify leads, summarize logs, and more.",
  hello: "Hi! Ask me what SovereignML can do, or try: 'deploy a support bot'.",
  deploy: "Deploying a support bot takes ~90s. Pick template → choose region → pay → done. Want to try?",
  price: "Plans from Free (100 credits) to Builder ($79/mo) through Scale ($399/mo), plus Enterprise from $1,000+/mo. Credits cover AI usage and workflows; buy overage packs when you need more.",
}

function reply(q: string): string {
  const k = q.toLowerCase()
  if (k.includes("hi") || k.includes("hello")) return CANNED.hello
  if (k.includes("deploy")) return CANNED.deploy
  if (k.includes("price") || k.includes("cost")) return CANNED.price
  return CANNED.default
}

export function PlaygroundWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "bot", text: "👋 I'm a live demo agent. Try me before you sign up." },
  ])
  const [input, setInput] = useState("")

  function send() {
    const q = input.trim()
    if (!q) return
    setMsgs((m) => [...m, { role: "user", text: q }])
    setInput("")
    setTimeout(() => {
      setMsgs((m) => [...m, { role: "bot", text: reply(q) }])
    }, 400)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="w-80 h-[28rem] rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <p className="text-xs font-mono text-[var(--text-primary)]">
                Try the Agent
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`text-xs rounded-xl ${
                  m.role === "user"
                    ? "ml-auto bg-primary/10 text-primary border border-primary/30"
                    : "bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]"
                } px-3 py-2 max-w-[85%] w-fit`}
              >
                {m.text}
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--border-color)] p-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask something..."
              className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:border-primary"
            />
            <button
              onClick={send}
              className="text-xs uppercase font-mono px-3 rounded-lg bg-primary text-black hover:opacity-90"
            >
              Send
            </button>
          </div>
          <p className="text-[9px] font-mono text-amber-400/80 px-3 py-1 border-t border-[var(--border-color)]">
            canned demo - real agent backend pending
          </p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="btn-gradient text-xs uppercase px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-black/40 animate-pulse" />
          Try the Agent
        </button>
      )}
    </div>
  )
}
