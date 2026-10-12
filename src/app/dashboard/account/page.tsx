"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, KeyRound, Link2, Trash2, UserCircle } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { StatCard } from "@/components/dashboard/stat-card"
import { TwoFactorCard } from "@/components/auth/two-factor-card"
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card"
import { linkGoogle } from "@/app/actions/auth"
import { BRANDING } from "@/configs/branding"

interface AccountData {
  id: string
  name: string | null
  email: string | null
  image: string | null
  hasPassword: boolean
  hasGoogle: boolean
  googleConfigured: boolean
  createdAt: string
}

interface DeletionRequest {
  id: string
  status: "pending" | "approved" | "denied"
  reason: string | null
  decisionNote: string | null
  createdAt: string
}

function GoogleGlyph() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}

export default function AccountPage() {
  const router = useRouter()
  const [account, setAccount] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)
  const [googleLinked, setGoogleLinked] = useState(false)

  const [name, setName] = useState("")
  const [nameSuccess, setNameSuccess] = useState("")
  const [nameError, setNameError] = useState("")
  const [nameSaving, setNameSaving] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordSuccess, setPasswordSuccess] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [passwordSaving, setPasswordSaving] = useState(false)

  const [deletionRequest, setDeletionRequest] = useState<DeletionRequest | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteReason, setDeleteReason] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState("")
  const [deleteError, setDeleteError] = useState("")
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function fetchAccount() {
      try {
        const res = await fetch("/api/auth/account", { credentials: "include" })
        if (cancelled) return
        if (res.status === 401) {
          router.push("/login")
          return
        }
        if (res.ok) {
          const data = await res.json()
          setAccount(data)
          setName(data.name || "")
        }

        const delRes = await fetch("/api/auth/account/delete-request", {
          credentials: "include",
        })
        if (!cancelled && delRes.ok) {
          const delData = await delRes.json()
          setDeletionRequest(delData.request)
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchAccount()

    return () => {
      cancelled = true
    }
  }, [router])

  // Surface a one-time success notice after returning from the Google OAuth
  // link flow, then strip the query param so a refresh doesn't repeat it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("linked") === "google") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGoogleLinked(true)
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  async function handleNameSave() {
    setNameSuccess("")
    setNameError("")
    setNameSaving(true)
    try {
      const res = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-name", name }),
      })
      const data = await res.json()
      if (res.ok) {
        setNameSuccess(data.message)
        setAccount((prev) => (prev ? { ...prev, name } : prev))
      } else {
        setNameError(data.error)
      }
    } catch {
      setNameError("Failed to update name")
    } finally {
      setNameSaving(false)
    }
  }

  async function handlePasswordSave() {
    setPasswordSuccess("")
    setPasswordError("")

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match")
      return
    }

    setPasswordSaving(true)
    try {
      const res = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-password",
          currentPassword: account?.hasPassword ? currentPassword : undefined,
          newPassword,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setPasswordSuccess(data.message)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
        setAccount((prev) => (prev ? { ...prev, hasPassword: true } : prev))
      } else {
        setPasswordError(data.error)
      }
    } catch {
      setPasswordError("Failed to update password")
    } finally {
      setPasswordSaving(false)
    }
  }

  async function handleDeleteRequest() {
    setDeleteError("")
    setDeleteSubmitting(true)
    try {
      const res = await fetch("/api/auth/account/delete-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason || undefined }),
      })
      const data = await res.json()
      if (res.ok) {
        setDeletionRequest(data.request)
        setDeleteOpen(false)
        setDeleteReason("")
        setDeleteConfirm("")
      } else {
        setDeleteError(data.error || "Failed to submit request")
      }
    } catch {
      setDeleteError("Failed to submit request")
    } finally {
      setDeleteSubmitting(false)
    }
  }

  async function handleCancelDeleteRequest() {
    setDeleteSubmitting(true)
    try {
      const res = await fetch("/api/auth/account/delete-request", {
        method: "DELETE",
      })
      if (res.ok) setDeletionRequest(null)
    } catch {
      /* ignore */
    } finally {
      setDeleteSubmitting(false)
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <PageHeader title="Settings" description="Manage your profile and security" />
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-24" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 py-6">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  if (!account) {
    return (
      <PageContainer>
        <PageHeader title="Settings" description="Manage your profile and security" />
        <Alert variant="destructive">
          <AlertDescription>Failed to load account data.</AlertDescription>
        </Alert>
      </PageContainer>
    )
  }

  const accountType =
    account.hasGoogle && account.hasPassword
      ? "Hybrid"
      : account.hasGoogle
        ? "Google"
        : "Email"
  const memberSinceYear = new Date(account.createdAt).getFullYear().toString()

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Manage your profile and security" />

      {/* ─── Stat strip ─────────────────────────────────────────── */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Account type" value={accountType} icon={UserCircle} tone="primary" />
        <StatCard
          label="Security"
          value={account.hasPassword ? "Protected" : "Basic"}
          hint={account.hasPassword ? "Password set" : "No password yet"}
          icon={KeyRound}
          tone="emerald"
        />
        <StatCard
          label="Connections"
          value={account.hasGoogle ? "Google" : "None"}
          icon={Link2}
          tone="sky"
        />
        <StatCard label="Member since" value={memberSinceYear} icon={CalendarDays} tone="violet" />
      </div>

      {/* ─── Tabbed settings: General · Security · Notifications ─── */}
      <Tabs defaultValue="general">
        <TabsList
          variant="line"
          className="w-full justify-start gap-1 border-b [&_[data-active]]:after:bg-primary [&_[data-active]]:text-foreground"
        >
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* ─── General ──────────────────────────────────────────── */}
        <TabsContent value="general" className="pt-6">
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Profile</CardTitle>
                  <CardDescription>How your name appears across the app.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="display-name">Display Name</FieldLabel>
                      <Input
                        id="display-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                      />
                    </Field>
                  </FieldGroup>
                  {nameSuccess && (
                    <Alert>
                      <AlertDescription>{nameSuccess}</AlertDescription>
                    </Alert>
                  )}
                  {nameError && (
                    <Alert variant="destructive">
                      <AlertDescription>{nameError}</AlertDescription>
                    </Alert>
                  )}
                  <Button onClick={handleNameSave} disabled={nameSaving}>
                    {nameSaving ? "Saving..." : "Save Name"}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Connected Accounts</CardTitle>
                  <CardDescription>
                    Link Google to sign in with one click alongside your email and password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {googleLinked && (
                    <Alert>
                      <AlertDescription>Your Google account is now connected.</AlertDescription>
                    </Alert>
                  )}
                  {account.hasGoogle ? (
                    <Badge variant="outline" className="gap-2 px-3 py-1.5">
                      <GoogleGlyph />
                      Google Connected
                    </Badge>
                  ) : account.googleConfigured ? (
                    <form action={linkGoogle}>
                      <Button type="submit" variant="outline" className="gap-2">
                        <GoogleGlyph />
                        Connect Google
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm text-muted-foreground">No connected accounts</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Account Info</CardTitle>
                <CardDescription>Read-only details about your account.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel>Email</FieldLabel>
                    <FieldDescription className="text-foreground">{account.email}</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Member Since</FieldLabel>
                    <FieldDescription className="text-foreground">
                      {new Date(account.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Security ─────────────────────────────────────────── */}
        <TabsContent value="security" className="space-y-5 pt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Password</CardTitle>
              {!account.hasPassword && (
                <CardDescription>
                  You signed up with Google and don&apos;t have a password yet. Set one to enable
                  email/password login.
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldGroup>
                {account.hasPassword && (
                  <Field>
                    <FieldLabel htmlFor="current-password">Current Password</FieldLabel>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                    />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="new-password">New Password</FieldLabel>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="confirm-password">Confirm New Password</FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                </Field>
              </FieldGroup>
              {passwordSuccess && (
                <Alert>
                  <AlertDescription>{passwordSuccess}</AlertDescription>
                </Alert>
              )}
              {passwordError && (
                <Alert variant="destructive">
                  <AlertDescription>{passwordError}</AlertDescription>
                </Alert>
              )}
              <Button onClick={handlePasswordSave} disabled={passwordSaving}>
                {passwordSaving
                  ? "Saving..."
                  : account.hasPassword
                    ? "Update Password"
                    : "Set Password"}
              </Button>
            </CardContent>
          </Card>

          <TwoFactorCard />

          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h3 className="font-semibold text-destructive">Delete Account</h3>
                <p className="max-w-prose text-sm text-muted-foreground">
                  Request deletion of your account, all agents, subscriptions, and data. Our team
                  reviews each request before any data is removed. This cannot be undone.
                </p>
              </div>
              <div className="shrink-0 space-y-3 sm:min-w-[14rem] sm:text-right">
              {deletionRequest?.status === "pending" ? (
                <>
                  <Alert>
                    <AlertDescription>
                      Your deletion request is pending review by the {BRANDING.name} team. We&apos;ll email
                      you once a decision is made.
                    </AlertDescription>
                  </Alert>
                  <Button
                    variant="outline"
                    disabled={deleteSubmitting}
                    onClick={handleCancelDeleteRequest}
                  >
                    {deleteSubmitting ? "Cancelling…" : "Cancel request"}
                  </Button>
                </>
              ) : deletionRequest?.status === "denied" ? (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>
                      Your previous deletion request was declined.
                      {deletionRequest.decisionNote ? ` Reason: ${deletionRequest.decisionNote}` : ""}
                    </AlertDescription>
                  </Alert>
                  <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 data-icon="inline-start" />
                    Request deletion again
                  </Button>
                </>
              ) : deletionRequest?.status === "approved" ? (
                <Alert>
                  <AlertDescription>
                    Your deletion request was approved and will be processed by our team shortly.
                  </AlertDescription>
                </Alert>
              ) : (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 data-icon="inline-start" />
                  Request account deletion
                </Button>
              )}

              <AlertDialog
                open={deleteOpen}
                onOpenChange={(open) => {
                  setDeleteOpen(open)
                  if (!open) {
                    setDeleteReason("")
                    setDeleteConfirm("")
                    setDeleteError("")
                  }
                }}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Request account deletion?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends a deletion request to the {BRANDING.name} team for review. Once approved,
                      all agents, subscriptions, and data are permanently removed. This cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-3">
                    <Field>
                      <FieldLabel htmlFor="delete-reason">Reason (optional)</FieldLabel>
                      <Textarea
                        id="delete-reason"
                        placeholder="Let us know why you're leaving…"
                        value={deleteReason}
                        onChange={(e) => setDeleteReason(e.target.value)}
                        maxLength={1000}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="delete-confirm">
                        Type <span className="font-mono font-semibold">DELETE</span> to confirm
                      </FieldLabel>
                      <Input
                        id="delete-confirm"
                        value={deleteConfirm}
                        onChange={(e) => setDeleteConfirm(e.target.value)}
                        placeholder="DELETE"
                        autoComplete="off"
                      />
                    </Field>
                    {deleteError ? (
                      <Alert variant="destructive">
                        <AlertDescription>{deleteError}</AlertDescription>
                      </Alert>
                    ) : null}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteSubmitting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={deleteConfirm !== "DELETE" || deleteSubmitting}
                      onClick={(e) => {
                        e.preventDefault()
                        void handleDeleteRequest()
                      }}
                    >
                      {deleteSubmitting ? "Submitting…" : "Submit request"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ─── Notifications ────────────────────────────────────── */}
        <TabsContent value="notifications" className="pt-6">
          <NotificationPreferencesCard />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
