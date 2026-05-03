"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function AcceptInviteClient({
  token,
  teamName,
  inviterName,
  role,
}: {
  token: string
  teamName: string
  inviterName: string
  role: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    const res = await fetch("/api/team/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to accept invite")
      setBusy(false)
      return
    }
    router.push("/dashboard/team")
    router.refresh()
  }

  return (
    <>
      <p className="text-sm text-[var(--text-secondary)]">
        <span className="text-[var(--text-primary)]">{inviterName}</span> invited you to join{" "}
        <span className="text-[var(--text-primary)]">{teamName}</span> as{" "}
        <span className="text-primary font-mono">{role}</span>.
      </p>
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
      <button onClick={accept} disabled={busy} className="btn-gradient !py-2.5 !px-5 !text-sm w-full">
        {busy ? "Joining…" : "Accept invite"}
      </button>
    </>
  )
}
