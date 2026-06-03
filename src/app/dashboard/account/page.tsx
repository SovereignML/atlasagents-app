"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"

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
import { Skeleton } from "@/components/ui/skeleton"
import { TwoFactorCard } from "@/components/auth/two-factor-card"
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card"

interface AccountData {
  id: string
  name: string | null
  email: string | null
  image: string | null
  hasPassword: boolean
  hasGoogle: boolean
  createdAt: string
  telegramId: string | null
  twitterHandle: string | null
  discordId: string | null
}

interface DeletionRequest {
  id: string
  status: "pending" | "approved" | "denied"
  reason: string | null
  decisionNote: string | null
  createdAt: string
}

export default function AccountPage() {
  const router = useRouter()
  const [account, setAccount] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)

  const [name, setName] = useState("")
  const [nameSuccess, setNameSuccess] = useState("")
  const [nameError, setNameError] = useState("")
  const [nameSaving, setNameSaving] = useState(false)

  const [telegramId, setTelegramId] = useState("")
  const [twitterHandle, setTwitterHandle] = useState("")
  const [discordId, setDiscordId] = useState("")
  const [socialsSuccess, setSocialsSuccess] = useState("")
  const [socialsError, setSocialsError] = useState("")
  const [socialsSaving, setSocialsSaving] = useState(false)

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
          setTelegramId(data.telegramId || "")
          setTwitterHandle(data.twitterHandle || "")
          setDiscordId(data.discordId || "")
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

  async function handleSocialsSave() {
    setSocialsSuccess("")
    setSocialsError("")
    setSocialsSaving(true)
    try {
      const res = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-socials", telegramId, twitterHandle, discordId }),
      })
      const data = await res.json()
      if (res.ok) {
        setSocialsSuccess(data.message)
        setAccount((prev) =>
          prev ? { ...prev, telegramId, twitterHandle, discordId } : prev
        )
      } else {
        setSocialsError(data.error)
      }
    } catch {
      setSocialsError("Failed to update socials")
    } finally {
      setSocialsSaving(false)
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          title="Account Settings"
          description="Manage your profile and security"
        />
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
        <PageHeader
          title="Account Settings"
          description="Manage your profile and security"
        />
        <Alert variant="destructive">
          <AlertDescription>Failed to load account data.</AlertDescription>
        </Alert>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title="Account Settings"
        description="Manage your profile and security"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
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
          <CardTitle className="text-lg">Security</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Contact &amp; Socials</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="telegram">Telegram</FieldLabel>
              <Input
                id="telegram"
                value={telegramId}
                onChange={(e) => setTelegramId(e.target.value)}
                placeholder="@username"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="twitter">Twitter / X</FieldLabel>
              <Input
                id="twitter"
                value={twitterHandle}
                onChange={(e) => setTwitterHandle(e.target.value)}
                placeholder="@handle"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="discord">Discord</FieldLabel>
              <Input
                id="discord"
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                placeholder="username#1234"
              />
            </Field>
          </FieldGroup>
          {socialsSuccess && (
            <Alert>
              <AlertDescription>{socialsSuccess}</AlertDescription>
            </Alert>
          )}
          {socialsError && (
            <Alert variant="destructive">
              <AlertDescription>{socialsError}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleSocialsSave} disabled={socialsSaving}>
            {socialsSaving ? "Saving..." : "Save Socials"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connected Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {account.hasGoogle ? (
            <Badge variant="outline" className="gap-2 px-3 py-1.5">
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
              Google Connected
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground">No connected accounts</p>
          )}
        </CardContent>
      </Card>

      <TwoFactorCard />

      <NotificationPreferencesCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account Info</CardTitle>
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

      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Delete Account</CardTitle>
          <CardDescription>
            Request deletion of your account, all agents, subscriptions, and data. Our team
            reviews each request before any data is removed. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {deletionRequest?.status === "pending" ? (
            <>
              <Alert>
                <AlertDescription>
                  Your deletion request is pending review by the SovereignML team. We&apos;ll email
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
                  This sends a deletion request to the SovereignML team for review. Once approved,
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
        </CardContent>
      </Card>
    </PageContainer>
  )
}
