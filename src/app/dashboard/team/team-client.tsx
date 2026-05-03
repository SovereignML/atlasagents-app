"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { TeamRole } from "@/lib/team"

type Member = { userId: string; role: TeamRole; name: string | null; email: string }
type Invite = { id: string; email: string; role: TeamRole; expiresAt: string }

const ROLE_STYLES: Record<TeamRole, string> = {
  owner: "text-primary border-primary/40 bg-primary/10",
  admin: "text-amber-400 border-amber-500/40 bg-amber-500/5",
  developer: "text-[var(--text-primary)] border-[var(--border-color)] bg-[var(--card-bg)]",
  viewer: "text-[var(--text-secondary)] border-[var(--border-color)] bg-[var(--card-bg)]",
}

type TeamInfo = { teamId: string; name: string; role: TeamRole }

export function TeamClient({
  team,
  myRole,
  members,
  invites,
  allTeams = [],
  activeTeamId,
}: {
  team: { id: string; name: string; seatLimit: number }
  myRole: TeamRole
  members: Member[]
  invites: Invite[]
  allTeams?: TeamInfo[]
  activeTeamId?: string
}) {
  const router = useRouter()
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<TeamRole>("developer")
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  const canManage = myRole === "owner" || myRole === "admin"
  const assignableRoles: TeamRole[] =
    myRole === "owner" ? ["admin", "developer", "viewer"] : ["developer", "viewer"]

  const seatsUsed = members.length + invites.length

  function refresh() {
    router.refresh()
  }

  async function handleSwitchTeam(teamId: string) {
    if (teamId === activeTeamId) return
    setSwitching(true)
    setError(null)
    const res = await fetch("/api/team/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to switch team")
      setSwitching(false)
      return
    }
    router.refresh()
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const res = await fetch("/api/team/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Failed to send invite")
      return
    }
    setInviteEmail("")
    if (!data.emailSent && data.acceptUrl) {
      setInfo(`Invite created. Email not configured — share this link: ${data.acceptUrl}`)
    } else {
      setInfo(`Invite sent to ${data.invite.email}.`)
    }
    setShowInvite(false)
    startTransition(refresh)
  }

  async function revokeInvite(id: string) {
    if (!confirm("Revoke this invite?")) return
    const res = await fetch(`/api/team/invites/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to revoke")
      return
    }
    startTransition(refresh)
  }

  async function changeRole(userId: string, role: TeamRole) {
    const res = await fetch(`/api/team/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to change role")
      return
    }
    startTransition(refresh)
  }

  async function removeMember(userId: string, label: string) {
    if (!confirm(`Remove ${label} from the team?`)) return
    const res = await fetch(`/api/team/members/${userId}`, { method: "DELETE" })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Failed to remove")
      return
    }
    startTransition(refresh)
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {allTeams.length > 1 && (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4 flex items-center gap-4 flex-wrap">
          <label className="text-[10px] text-[var(--text-secondary)]">
            Active Team
          </label>
          <select
            value={activeTeamId ?? team.id}
            onChange={(e) => handleSwitchTeam(e.target.value)}
            disabled={switching}
            className="bg-[var(--bg-color)] border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono min-w-[200px]"
          >
            {allTeams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.name} ({t.role})
              </option>
            ))}
          </select>
          {switching && (
            <span className="text-xs text-[var(--text-secondary)] font-mono animate-pulse">
              Switching...
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Team
          </h1>
          <p className="text-[var(--text-secondary)] mt-1 text-sm">
            {team.name} · invite teammates and control their access.
          </p>
        </div>
        {canManage && (
          <button
            className="btn-gradient !py-2.5 !px-5 !text-sm"
            disabled={seatsUsed >= team.seatLimit}
            onClick={() => setShowInvite((v) => !v)}
          >
            {showInvite ? "Cancel" : "+ Invite Member"}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs font-mono text-red-400 border border-red-500/40 bg-red-500/5 p-3">
          {error}
        </p>
      )}
      {info && (
        <p className="text-xs font-mono text-[var(--text-secondary)] border border-[var(--border-color)] bg-[var(--card-bg)] p-3 break-all">
          {info}
        </p>
      )}

      {showInvite && canManage && (
        <form
          onSubmit={submitInvite}
          className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="text-[10px] text-[var(--text-secondary)] block mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono"
                placeholder="teammate@company.com"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-secondary)] block mb-1">
                Role
              </label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                className="w-full bg-[var(--bg-color)] border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-primary)] font-mono"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="btn-gradient !py-2.5 !px-5 !text-sm" disabled={busy}>
            Send invite
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4">
          <p className="text-[10px] text-[var(--text-secondary)]">
            Plan
          </p>
          <p className="text-2xl font-bold text-[var(--text-primary)] font-mono mt-2">Pro</p>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Up to {team.seatLimit} seats
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4">
          <p className="text-[10px] text-[var(--text-secondary)]">
            Seats Used
          </p>
          <p className="text-2xl font-bold text-primary font-mono mt-2">
            {seatsUsed} / {team.seatLimit}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-4">
          <p className="text-[10px] text-[var(--text-secondary)]">
            Pending Invites
          </p>
          <p className="text-2xl font-bold text-[var(--text-primary)] font-mono mt-2">
            {invites.length}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-[var(--text-secondary)] font-mono border-b border-[var(--border-color)]">
              <th className="text-left px-4 py-3">Member</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-[var(--border-color)]/50">
                <td className="px-4 py-3 text-[var(--text-primary)]">
                  <div>{m.name || m.email}</div>
                  {m.name && (
                    <div className="text-xs text-[var(--text-secondary)] font-mono">{m.email}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {canManage && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m.userId, e.target.value as TeamRole)}
                      className="bg-[var(--bg-color)] border border-[var(--border-color)] px-2 py-1 text-[10px] font-mono text-[var(--text-primary)]"
                    >
                      {assignableRoles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 border ${ROLE_STYLES[m.role]}`}
                    >
                      {m.role}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">active</td>
                <td className="px-4 py-3 text-right">
                  {canManage && m.role !== "owner" && (
                    <button
                      onClick={() => removeMember(m.userId, m.email)}
                      className="text-xs font-mono text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.id} className="border-b border-[var(--border-color)]/50">
                <td className="px-4 py-3 text-[var(--text-primary)] font-mono">{i.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 border ${ROLE_STYLES[i.role]}`}
                  >
                    {i.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-amber-400">invited</td>
                <td className="px-4 py-3 text-right">
                  {canManage && (
                    <button
                      onClick={() => revokeInvite(i.id)}
                      className="text-xs font-mono text-red-400 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)] p-5">
        <p className="text-[10px] text-[var(--text-secondary)] mb-3">
          Roles
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-[var(--text-secondary)]">
          <div>
            <span className="text-primary font-mono">owner</span> — full access incl.
            billing
          </div>
          <div>
            <span className="text-amber-400 font-mono">admin</span> — manage agents, team, settings
            (no billing)
          </div>
          <div>
            <span className="text-[var(--text-primary)] font-mono">developer</span> — deploy,
            restart, edit agents
          </div>
          <div>
            <span className="text-[var(--text-secondary)] font-mono">viewer</span> — read-only
            dashboards and logs
          </div>
        </div>
      </div>
    </div>
  )
}
