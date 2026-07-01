"use client"

import { useSearchParams } from "next/navigation"
import { CircleAlert, CircleCheck } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"

// Auth.js redirects failures to `/login?error=<Type>`. Map the codes it can
// surface to plain-language copy. `Configuration` also covers the common case
// of a user cancelling the Google consent screen, so keep its wording gentle.
const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "We couldn't complete sign-in. If you cancelled, just try again.",
  AccessDenied: "Access was denied. Try again or use a different sign-in method.",
  OAuthAccountNotLinked:
    "That email is already registered with a different sign-in method. Sign in that way instead.",
  Verification: "That sign-in link has expired. Please try again.",
}

const DEFAULT_ERROR_MESSAGE = "Something went wrong while signing in. Please try again."

export function LoginBanners() {
  const searchParams = useSearchParams()
  const reset = searchParams.get("reset") === "true"
  const registered = searchParams.get("registered") === "true"
  const verified = searchParams.get("verified") === "true"
  const error = searchParams.get("error")

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4 flex w-full max-w-md items-center justify-center gap-2 text-center">
          <CircleAlert className="shrink-0" />
          <AlertDescription className="text-center">
            {ERROR_MESSAGES[error] ?? DEFAULT_ERROR_MESSAGE}
          </AlertDescription>
        </Alert>
      )}
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
