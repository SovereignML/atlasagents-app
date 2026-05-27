"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{inviterName}</span> invited you to join{" "}
        <span className="text-foreground">{teamName}</span> as{" "}
        <span className="font-mono text-primary">{role}</span>.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="font-mono text-xs">{error}</AlertDescription>
        </Alert>
      )}
      <Button
        onClick={accept}
        disabled={busy}
        variant="gradient"
        size="pill"
        className="w-full"
      >
        {busy ? "Joining…" : "Accept invite"}
      </Button>
    </div>
  )
}
