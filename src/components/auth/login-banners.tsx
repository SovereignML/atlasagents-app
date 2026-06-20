"use client"

import { useSearchParams } from "next/navigation"
import { CircleCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

export function LoginBanners() {
  const searchParams = useSearchParams()
  const reset = searchParams.get("reset") === "true"
  const registered = searchParams.get("registered") === "true"
  const verified = searchParams.get("verified") === "true"

  return (
    <>
      {reset && (
        <Alert variant="success" className="mb-4 flex w-full max-w-md items-center justify-center gap-2 text-center">
          <CircleCheck className="shrink-0" />
          <AlertDescription className="text-center">
            Password reset successful. You can now sign in with your new password.
          </AlertDescription>
        </Alert>
      )}
      {registered && (
        <Alert variant="success" className="mb-4 flex w-full max-w-md items-center justify-center gap-2 text-center">
          <CircleCheck className="shrink-0" />
          <AlertDescription className="text-center">
            Account created. Welcome! Sign in to get started.
          </AlertDescription>
        </Alert>
      )}
      {verified && (
        <Alert variant="success" className="mb-4 flex w-full max-w-md items-center justify-center gap-2 text-center">
          <CircleCheck className="shrink-0" />
          <AlertDescription className="text-center">
            Email verified. You can now sign in.
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
