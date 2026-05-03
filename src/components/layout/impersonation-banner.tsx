"use client"

import { useState } from "react"

export function ImpersonationBanner({
  userId,
  email,
  name,
}: {
  userId: string
  email: string
  name: string | null
}) {
  const [stopping, setStopping] = useState(false)

  async function handleStop() {
    setStopping(true)
    await fetch("/api/admin/stop-impersonation", { method: "POST" })
    window.location.href = "/admin/users"
  }

  return (
    <div className="bg-amber-500 text-black px-4 py-2 flex items-center justify-between gap-4 text-sm font-medium z-50">
      <span>
        Viewing as <strong>{name || email}</strong>
        {name && <span className="opacity-70"> ({email})</span>}
      </span>
      <button
        onClick={handleStop}
        disabled={stopping}
        className="px-3 py-1 bg-black text-amber-500 text-xs font-medium rounded-full hover:bg-black/80 disabled:opacity-50"
      >
        {stopping ? "Stopping..." : "Stop Impersonating"}
      </button>
    </div>
  )
}
