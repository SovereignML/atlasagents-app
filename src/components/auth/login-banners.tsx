"use client"

import { useSearchParams } from "next/navigation"

export function LoginBanners() {
  const searchParams = useSearchParams()
  const reset = searchParams.get("reset") === "true"
  const registered = searchParams.get("registered") === "true"

  return (
    <>
      {reset && (
        <div className="w-full max-w-md p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center mb-4">
          Password reset successful. You can now sign in with your new password.
        </div>
      )}
      {registered && (
        <div className="w-full max-w-md p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm text-center mb-4">
          Account created. Sign in to continue.
        </div>
      )}
    </>
  )
}
