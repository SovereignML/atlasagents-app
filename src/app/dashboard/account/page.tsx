"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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

export default function AccountPage() {
  const router = useRouter()
  const [account, setAccount] = useState<AccountData | null>(null)
  const [loading, setLoading] = useState(true)

  // Profile state
  const [name, setName] = useState("")
  const [nameSuccess, setNameSuccess] = useState("")
  const [nameError, setNameError] = useState("")
  const [nameSaving, setNameSaving] = useState(false)

  // Socials state
  const [telegramId, setTelegramId] = useState("")
  const [twitterHandle, setTwitterHandle] = useState("")
  const [discordId, setDiscordId] = useState("")
  const [socialsSuccess, setSocialsSuccess] = useState("")
  const [socialsError, setSocialsError] = useState("")
  const [socialsSaving, setSocialsSaving] = useState(false)

  // Password state
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordSuccess, setPasswordSuccess] = useState("")
  const [passwordError, setPasswordError] = useState("")
  const [passwordSaving, setPasswordSaving] = useState(false)

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
      } catch {
        // ignore
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
        setAccount((prev) => prev ? { ...prev, name } : prev)
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
        setAccount((prev) => prev ? { ...prev, hasPassword: true } : prev)
      } else {
        setPasswordError(data.error)
      }
    } catch {
      setPasswordError("Failed to update password")
    } finally {
      setPasswordSaving(false)
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
        setAccount((prev) => prev ? { ...prev, telegramId, twitterHandle, discordId } : prev)
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
      <div className="space-y-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage your profile and security</p>
        </div>
        <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6">
          <p className="text-[var(--text-secondary)]">Loading...</p>
        </div>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="space-y-8 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account Settings</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage your profile and security</p>
        </div>
        <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6">
          <p className="text-red-400">Failed to load account data.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Account Settings</h1>
        <p className="text-[var(--text-secondary)] mt-1">Manage your profile and security</p>
      </div>

      {/* Profile Section */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Profile</h2>
        <div className="space-y-2">
          <Label className="text-[var(--text-secondary)] text-sm">Display Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            placeholder="Your name"
          />
        </div>
        {nameSuccess && <p className="text-emerald-400 text-sm">{nameSuccess}</p>}
        {nameError && <p className="text-red-400 text-sm">{nameError}</p>}
        <Button
          onClick={handleNameSave}
          disabled={nameSaving}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {nameSaving ? "Saving..." : "Save Name"}
        </Button>
      </div>

      {/* Security Section */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Security</h2>
        {account.hasPassword ? (
          <>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-sm">Current Password</Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                placeholder="Enter current password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-sm">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-sm">Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                placeholder="Confirm new password"
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-[var(--text-secondary)] text-sm">
              You signed up with Google and don&apos;t have a password yet. Set one to enable email/password login.
            </p>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-sm">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)] text-sm">Confirm Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
                placeholder="Confirm password"
              />
            </div>
          </>
        )}
        {passwordSuccess && <p className="text-emerald-400 text-sm">{passwordSuccess}</p>}
        {passwordError && <p className="text-red-400 text-sm">{passwordError}</p>}
        <Button
          onClick={handlePasswordSave}
          disabled={passwordSaving}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {passwordSaving ? "Saving..." : account.hasPassword ? "Update Password" : "Set Password"}
        </Button>
      </div>

      {/* Contact & Socials */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Contact & Socials</h2>
        <div className="space-y-2">
          <Label className="text-[var(--text-secondary)] text-sm">Telegram</Label>
          <Input
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            placeholder="@username"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[var(--text-secondary)] text-sm">Twitter / X</Label>
          <Input
            value={twitterHandle}
            onChange={(e) => setTwitterHandle(e.target.value)}
            className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            placeholder="@handle"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[var(--text-secondary)] text-sm">Discord</Label>
          <Input
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
            className="bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-primary)]"
            placeholder="username#1234"
          />
        </div>
        {socialsSuccess && <p className="text-emerald-400 text-sm">{socialsSuccess}</p>}
        {socialsError && <p className="text-red-400 text-sm">{socialsError}</p>}
        <Button
          onClick={handleSocialsSave}
          disabled={socialsSaving}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {socialsSaving ? "Saving..." : "Save Socials"}
        </Button>
      </div>

      {/* Connected Accounts */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Connected Accounts</h2>
        <div className="flex items-center gap-3">
          {account.hasGoogle ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]">
              <svg className="w-4 h-4" viewBox="0 0 24 24">
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
            </span>
          ) : (
            <p className="text-[var(--text-secondary)] text-sm">No connected accounts</p>
          )}
        </div>
      </div>

      {/* Two-Factor */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Two-Factor Authentication</h2>
            <p className="text-[var(--text-secondary)] text-sm mt-1">Add an extra layer of security via TOTP app.</p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.08em] font-mono px-2 py-0.5 border border-[var(--border-color)] text-[var(--text-secondary)]">
            disabled
          </span>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">Enable 2FA</Button>
        <p className="text-[10px] font-mono text-amber-400/80">⚠ TOTP enrollment + backup codes pending</p>
      </div>

      {/* Active Sessions */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Active Sessions</h2>
          <button className="text-xs uppercase tracking-[0.08em] font-mono text-red-400 hover:underline">
            Sign out all
          </button>
        </div>
        <div className="space-y-2">
          {[
            { device: "MacBook Pro · Chrome", ip: "73.210.x.x", loc: "Brooklyn, US", current: true, last: "now" },
            { device: "iPhone · Safari", ip: "73.210.x.x", loc: "Brooklyn, US", current: false, last: "3h ago" },
            { device: "Linux · Firefox", ip: "51.158.x.x", loc: "Paris, FR", current: false, last: "2 days ago" },
          ].map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-[var(--border-color)]/50 last:border-b-0">
              <div>
                <p className="text-sm text-[var(--text-primary)]">{s.device}</p>
                <p className="text-[10px] font-mono text-[var(--text-secondary)]">
                  {s.ip} · {s.loc} · {s.last}
                </p>
              </div>
              {s.current ? (
                <span className="text-[10px] uppercase tracking-[0.08em] font-mono text-[var(--accent-color)] border border-[var(--accent-color)]/40 px-2 py-0.5">
                  current
                </span>
              ) : (
                <button className="text-xs uppercase tracking-[0.08em] font-mono text-red-400 hover:underline">
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono text-amber-400/80">⚠ session store pending</p>
      </div>

      {/* Account Info */}
      <div className="bg-[var(--card-bg)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-6 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Account Info</h2>
        <div className="space-y-3">
          <div>
            <Label className="text-[var(--text-secondary)] text-sm">Email</Label>
            <p className="text-[var(--text-primary)] mt-1">{account.email}</p>
          </div>
          <div>
            <Label className="text-[var(--text-secondary)] text-sm">Member Since</Label>
            <p className="text-[var(--text-primary)] mt-1">
              {new Date(account.createdAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Delete Account */}
      <div className="border border-red-500/30 bg-red-500/5 rounded-2xl p-6 space-y-3">
        <h2 className="text-lg font-semibold text-red-400">Delete Account</h2>
        <p className="text-[var(--text-secondary)] text-sm">
          Permanently delete your account, all agents, subscriptions, and data. This cannot be undone.
        </p>
        <button className="px-4 py-2 text-xs uppercase tracking-[0.08em] font-mono bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20">
          Delete Account
        </button>
        <p className="text-[10px] font-mono text-amber-400/80">⚠ deletion workflow + grace period pending</p>
      </div>
    </div>
  )
}
