"use client"

import { useState } from "react"
import { UserCog } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export function ImpersonationBanner({
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
    <Alert className="sticky top-0 z-50 rounded-none border-x-0 border-t-0 border-b border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300">
      <UserCog />
      <AlertTitle>Impersonating user</AlertTitle>
      <AlertDescription className="text-amber-700/80 dark:text-amber-300/80">
        Viewing as <span className="font-medium">{name || email}</span>
        {name && <span className="opacity-70"> ({email})</span>}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" disabled={stopping} onClick={handleStop}>
          {stopping ? "Stopping..." : "Stop Impersonating"}
        </Button>
      </AlertAction>
    </Alert>
  )
}
