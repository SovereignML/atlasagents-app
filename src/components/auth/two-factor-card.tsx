"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, ShieldCheck, ShieldOff } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

interface TwoFactorStatus {
  enabled: boolean
  backupCodesRemaining: number
  enrolledAt: string | null
}

interface SetupResponse {
  secret: string
  otpauthUri: string
}

async function postAction(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch("/api/auth/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ action, ...body }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? "Copied" : label}
    </Button>
  )
}

function QrCodeImg({ value }: { value: string }) {
  // Render the otpauth URI as a QR image via the user's browser using a
  // chart-server. We deliberately use the well-known free api.qrserver.com
  // endpoint — if the host can't reach it the user can still type the
  // secret manually (it's printed below the QR).
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(value)}`
  return (
    <div className="rounded-lg border bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="2FA QR code"
        width={200}
        height={200}
        className="block size-[200px]"
      />
    </div>
  )
}

export function TwoFactorCard() {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")

  const [setup, setSetup] = useState<SetupResponse | null>(null)
  const [enrollCode, setEnrollCode] = useState("")
  const [enrolling, setEnrolling] = useState(false)
  const [submittingEnroll, setSubmittingEnroll] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)

  const [disablePassword, setDisablePassword] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [disabling, setDisabling] = useState(false)

  const [regenCode, setRegenCode] = useState("")
  const [regenerating, setRegenerating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/auth/2fa", { credentials: "include" })
      if (res.ok) {
        const data = (await res.json()) as TwoFactorStatus
        setStatus(data)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startSetup = useCallback(async () => {
    setError("")
    setInfo("")
    setBackupCodes(null)
    setEnrolling(true)
    const { ok, data } = await postAction("setup")
    if (!ok) {
      setError(data?.error || "Failed to start 2FA setup")
      setEnrolling(false)
      return
    }
    setSetup({ secret: data.secret, otpauthUri: data.otpauthUri })
  }, [])

  const cancelSetup = useCallback(() => {
    setEnrolling(false)
    setSetup(null)
    setEnrollCode("")
    setShowSecret(false)
    setError("")
  }, [])

  const verifySetup = useCallback(async () => {
    setError("")
    setInfo("")
    setSubmittingEnroll(true)
    try {
      const { ok, data } = await postAction("verify-setup", { code: enrollCode })
      if (!ok) {
        setError(data?.error || "Invalid code")
        return
      }
      setBackupCodes(data.backupCodes as string[])
      setInfo("Two-factor authentication enabled. Save your backup codes below — they will not be shown again.")
      setSetup(null)
      setEnrolling(false)
      setEnrollCode("")
      void refresh()
    } finally {
      setSubmittingEnroll(false)
    }
  }, [enrollCode, refresh])

  const disable = useCallback(async () => {
    setError("")
    setInfo("")
    setDisabling(true)
    try {
      const { ok, data } = await postAction("disable", {
        password: disablePassword,
        code: disableCode,
      })
      if (!ok) {
        setError(data?.error || "Failed to disable 2FA")
        return
      }
      setInfo("Two-factor authentication disabled.")
      setBackupCodes(null)
      setDisablePassword("")
      setDisableCode("")
      void refresh()
    } finally {
      setDisabling(false)
    }
  }, [disableCode, disablePassword, refresh])

  const regenerateBackupCodes = useCallback(async () => {
    setError("")
    setInfo("")
    setRegenerating(true)
    try {
      const { ok, data } = await postAction("regenerate-backup-codes", {
        code: regenCode,
      })
      if (!ok) {
        setError(data?.error || "Failed to regenerate backup codes")
        return
      }
      setBackupCodes(data.backupCodes as string[])
      setRegenCode("")
      setInfo("Generated a new set of backup codes. Save them — old codes no longer work.")
      void refresh()
    } finally {
      setRegenerating(false)
    }
  }, [regenCode, refresh])

  const backupCodesText = useMemo(
    () => (backupCodes ? backupCodes.join("\n") : ""),
    [backupCodes],
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-9 w-32" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-lg">Two-Factor Authentication</CardTitle>
          <CardDescription>
            Use a TOTP authenticator app (Google Authenticator, 1Password, Authy, etc.) for an extra
            layer of security on sign-in.
          </CardDescription>
        </div>
        <Badge
          variant="outline"
          className={
            status?.enabled
              ? "gap-1 border-emerald-500/30 text-emerald-500"
              : "gap-1 font-mono"
          }
        >
          {status?.enabled ? <ShieldCheck className="size-3" /> : <ShieldOff className="size-3" />}
          {status?.enabled ? "enabled" : "disabled"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {info && (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        )}

        {backupCodes && (
          <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm font-medium">Your backup codes</p>
            <p className="text-xs text-muted-foreground">
              Each code can be used once if you lose access to your authenticator. Store them in a
              password manager — they won&apos;t be shown again.
            </p>
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {backupCodes.map((c) => (
                <code key={c} className="rounded bg-background px-2 py-1.5">
                  {c}
                </code>
              ))}
            </div>
            <CopyButton value={backupCodesText} label="Copy all codes" />
          </div>
        )}

        {!status?.enabled && !enrolling && (
          <Button onClick={startSetup}>Enable 2FA</Button>
        )}

        {!status?.enabled && enrolling && setup && (
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <div>
              <p className="text-sm font-medium">1. Scan this QR code</p>
              <p className="text-xs text-muted-foreground">
                Open your authenticator app and scan the code below. If you can&apos;t scan, enter
                the secret manually.
              </p>
            </div>
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <QrCodeImg value={setup.otpauthUri} />
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Manual entry secret
                </p>
                <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                  {showSecret ? setup.secret : "•".repeat(setup.secret.length)}
                </code>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowSecret((v) => !v)}
                  >
                    {showSecret ? "Hide" : "Reveal"}
                  </Button>
                  <CopyButton value={setup.secret} label="Copy secret" />
                </div>
              </div>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="enroll-code">2. Enter the 6-digit code</FieldLabel>
                <Input
                  id="enroll-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </FieldGroup>
            <div className="flex gap-2">
              <Button
                onClick={verifySetup}
                disabled={submittingEnroll || enrollCode.length !== 6}
              >
                {submittingEnroll ? "Verifying..." : "Verify & enable"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelSetup}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {status?.enabled && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              {status.backupCodesRemaining} backup code
              {status.backupCodesRemaining === 1 ? "" : "s"} remaining
              {status.enrolledAt && (
                <> · enrolled {new Date(status.enrolledAt).toLocaleDateString()}</>
              )}
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="outline">Regenerate backup codes</Button>}
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate backup codes?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your previous codes will stop working immediately. Enter a current 2FA code
                      from your authenticator (or an existing backup code) to confirm.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <FieldGroup className="px-1">
                    <Field>
                      <FieldLabel htmlFor="regen-code">2FA code</FieldLabel>
                      <Input
                        id="regen-code"
                        autoComplete="one-time-code"
                        placeholder="123456 or backup code"
                        value={regenCode}
                        onChange={(e) => setRegenCode(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setRegenCode("")}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault()
                        void regenerateBackupCodes()
                      }}
                      disabled={regenerating || regenCode.length < 6}
                    >
                      {regenerating ? "Regenerating..." : "Regenerate"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="ghost" className="text-destructive hover:text-destructive">
                      Disable 2FA
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Confirm with your current password or a 2FA code. Your account will lose its
                      second factor of protection.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <FieldGroup className="px-1">
                    <Field>
                      <FieldLabel htmlFor="disable-password">Current password</FieldLabel>
                      <Input
                        id="disable-password"
                        type="password"
                        autoComplete="current-password"
                        value={disablePassword}
                        onChange={(e) => setDisablePassword(e.target.value)}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="disable-code">— or — 2FA code</FieldLabel>
                      <Input
                        id="disable-code"
                        autoComplete="one-time-code"
                        placeholder="123456 or backup code"
                        value={disableCode}
                        onChange={(e) => setDisableCode(e.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={() => {
                        setDisablePassword("")
                        setDisableCode("")
                      }}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault()
                        void disable()
                      }}
                      disabled={disabling || (!disablePassword && !disableCode)}
                    >
                      {disabling ? "Disabling..." : "Disable 2FA"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
