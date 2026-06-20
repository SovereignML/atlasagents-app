"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, MessageCircle, MessageSquare, Search } from "lucide-react"

import { openLiveChat } from "@/lib/live-chat"
import { KB_FAQS, searchKnowledgeBase } from "@/configs/knowledge-base"

/**
 * Real knowledge-base search. Filters the shared KB index as you type and links
 * each result to its section anchor on /docs.
 */
export function SupportSearch() {
  const [query, setQuery] = useState("")
  const results = useMemo(() => searchKnowledgeBase(query), [query])

  const trimmed = query.trim()
  const hasResults = results.sections.length > 0 || results.faqs.length > 0

  return (
    <div className="relative space-y-4">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        How can we help?
      </h2>
      <div className="flex max-w-md items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-2.5 text-sm text-foreground backdrop-blur focus-within:border-primary/60">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search articles, guides, and FAQs…"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search the knowledge base"
        />
      </div>

      {trimmed && (
        <div className="max-w-md rounded-2xl border border-border bg-card p-2 shadow-sm">
          {hasResults ? (
            <ul className="divide-y divide-border">
              {results.sections.map((s) => (
                <li key={`section-${s.id}`}>
                  <Link
                    href={`/docs#${s.id}`}
                    className="flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50"
                  >
                    <s.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {s.title}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {s.summary}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {results.faqs.map((f) => (
                <li key={`faq-${f.question}`}>
                  <Link
                    href={f.anchor ? `/docs#${f.anchor}` : "/docs"}
                    className="flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50"
                  >
                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {f.question}
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {f.answer}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              No results for “{trimmed}”. Try the{" "}
              <Link href="/docs" className="text-primary hover:underline">
                full docs
              </Link>{" "}
              or{" "}
              <a href="#ticket-form" className="text-primary hover:underline">
                open a ticket
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Scrolls to the (already-rendered) SupportTicketForm and focuses its first
 * field. The real form lives in the left column under id="ticket-form".
 */
export function StartConversationButton() {
  function open() {
    const el = document.getElementById("ticket-form")
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    const subject = el.querySelector<HTMLInputElement>("#ticket-subject")
    // Delay focus slightly so the scroll has started before the field grabs it.
    window.setTimeout(() => subject?.focus(), 300)
  }

  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
    >
      <MessageSquare className="size-4" />
      Start a conversation
    </button>
  )
}

/**
 * Opens the live-chat widget, re-enabling it first if the user had hidden the
 * bubble with the × on the widget.
 */
export function LiveChatButton() {
  return (
    <button
      type="button"
      onClick={() => openLiveChat()}
      className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
    >
      <MessageCircle className="size-4" />
      Live chat
    </button>
  )
}

export function SupportFaq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <ul className="divide-y divide-border">
      {KB_FAQS.map((item, idx) => {
        const isOpen = open === idx
        return (
          <li key={item.question}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : idx)}
              className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
              aria-expanded={isOpen}
            >
              <span className="text-sm font-medium text-foreground">
                {item.question}
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {isOpen && (
              <div className="pb-4 pr-7">
                <p className="text-sm text-muted-foreground">{item.answer}</p>
                {item.anchor && (
                  <Link
                    href={`/docs#${item.anchor}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Read more in docs
                    <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
