"use client"

import { Button } from "@/components/ui/button"
import {
  signInWithApple,
  signInWithGoogle,
  signInWithTwitter,
} from "@/app/actions/auth"

export interface OAuthAvailability {
  google: boolean
  twitter: boolean
  apple: boolean
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        fill="currentColor"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M16.365 1.43c0 1.14-.42 2.21-1.25 3.05-.86.91-2.04 1.5-3.05 1.42-.12-1.1.45-2.25 1.21-3 .82-.83 2.18-1.43 3.09-1.47zM21 17.36c-.32.73-.7 1.4-1.13 2.02-.6.85-1.09 1.43-1.46 1.75-.6.55-1.24.83-1.92.85-.49 0-1.08-.14-1.77-.42-.7-.28-1.34-.42-1.93-.42-.62 0-1.28.14-1.99.42-.71.28-1.28.43-1.71.45-.65.03-1.31-.26-1.97-.85-.42-.36-.94-.96-1.55-1.8-.66-.91-1.21-1.96-1.63-3.16C2.32 15 2 13.73 2 12.5c0-1.42.31-2.65.92-3.69a5.4 5.4 0 0 1 4.6-2.74c.59 0 1.36.18 2.32.54.96.36 1.58.54 1.85.54.2 0 .89-.21 2.06-.63 1.1-.39 2.04-.55 2.81-.49 2.08.17 3.64.99 4.69 2.47-1.86 1.13-2.78 2.7-2.76 4.72.02 1.57.59 2.88 1.71 3.92.51.49 1.07.86 1.7 1.13-.14.4-.28.79-.43 1.17z"
        fill="currentColor"
      />
    </svg>
  )
}

export function OAuthButtons({ providers }: { providers: OAuthAvailability }) {
  const anyEnabled = providers.google || providers.twitter || providers.apple
  if (!anyEnabled) return null

  return (
    <div className="grid gap-2">
      {providers.google && (
        <form action={signInWithGoogle}>
          <Button type="submit" variant="outline" size="lg" className="w-full gap-3">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
      )}
      {providers.twitter && (
        <form action={signInWithTwitter}>
          <Button type="submit" variant="outline" size="lg" className="w-full gap-3">
            <XIcon />
            Continue with X
          </Button>
        </form>
      )}
      {providers.apple && (
        <form action={signInWithApple}>
          <Button type="submit" variant="outline" size="lg" className="w-full gap-3">
            <AppleIcon />
            Continue with Apple
          </Button>
        </form>
      )}
    </div>
  )
}
