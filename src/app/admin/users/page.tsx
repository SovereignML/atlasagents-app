"use client"

import { Fragment, useEffect, useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface User {
  id: string
  name: string | null
  email: string
  role: string
  isBanned: boolean
  bannedAt: string | null
  bannedReason: string | null
  telegramId: string | null
  twitterHandle: string | null
  discordId: string | null
  createdAt: string
  _count: { subscriptions: number; payments: number }
}

interface AdminNote {
  id: string
  content: string
  authorName: string
  createdAt: string
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [tab, setTab] = useState("all")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null)
  const [notes, setNotes] = useState<AdminNote[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [newNote, setNewNote] = useState("")
  const [addingNote, setAddingNote] = useState(false)

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("search", debouncedSearch)
    if (tab !== "all") params.set("status", tab)
    const url = `/api/admin/users${params.toString() ? `?${params}` : ""}`
    const res = await fetch(url)
    const data = await res.json()
    setUsers(data)
    setLoading(false)
  }, [tab, debouncedSearch])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers()
  }, [fetchUsers])

  async function fetchNotes(userId: string) {
    setNotesLoading(true)
    const res = await fetch(`/api/admin/users/${userId}/notes`)
    const data = await res.json()
    setNotes(data)
    setNotesLoading(false)
  }

  function handleRowClick(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null)
      setNotes([])
      setNewNote("")
    } else {
      setExpandedUserId(userId)
      setNewNote("")
      fetchNotes(userId)
    }
  }

  async function handleRoleChange(user: User) {
    const newRole = user.role === "admin" ? "user" : "admin"
    setActionLoading(user.id)
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "role", role: newRole }),
    })
    await fetchUsers()
    setActionLoading(null)
  }

  async function handleBan(user: User) {
    const reason = prompt("Ban reason:")
    if (reason === null) return
    setActionLoading(user.id)
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ban", bannedReason: reason || "No reason provided" }),
    })
    await fetchUsers()
    setActionLoading(null)
  }

  async function handleUnban(user: User) {
    setActionLoading(user.id)
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unban" }),
    })
    await fetchUsers()
    setActionLoading(null)
  }

  async function handleResetPassword(user: User) {
    const password = prompt("Enter new password:")
    if (!password) return
    setActionLoading(user.id)
    await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
    setActionLoading(null)
    alert("Password reset successfully.")
  }

  async function handleDelete(user: User) {
    if (!confirm(`Are you sure you want to delete ${user.email}? This cannot be undone.`)) return
    setActionLoading(user.id)
    await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" })
    if (expandedUserId === user.id) {
      setExpandedUserId(null)
      setNotes([])
    }
    await fetchUsers()
    setActionLoading(null)
  }

  async function handleImpersonate(user: User) {
    if (!confirm(`Impersonate ${user.email}? You'll see their dashboard as they see it.`)) return
    setActionLoading(user.id)
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    })
    if (res.ok) {
      window.location.href = "/dashboard"
    } else {
      const data = await res.json().catch(() => ({}))
      alert(data.error || "Failed to impersonate")
    }
    setActionLoading(null)
  }

  async function handleAddNote(userId: string) {
    if (!newNote.trim()) return
    setAddingNote(true)
    await fetch(`/api/admin/users/${userId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newNote.trim() }),
    })
    setNewNote("")
    await fetchNotes(userId)
    setAddingNote(false)
  }

  async function handleDeleteNote(userId: string, noteId: string) {
    await fetch(`/api/admin/users/${userId}/notes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId }),
    })
    await fetchNotes(userId)
  }

  const isDisabled = (userId: string) => actionLoading === userId

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-white">User Management</h1>

      {/* Search */}
      <div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="bg-white/5 border-white/10 text-white max-w-md"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white/5 border border-white/10">
          <TabsTrigger value="all" className="data-[state=active]:bg-zinc-500/20 data-[state=active]:text-zinc-200">
            All
          </TabsTrigger>
          <TabsTrigger value="active" className="data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-400">
            Active
          </TabsTrigger>
          <TabsTrigger value="banned" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
            Banned
          </TabsTrigger>
          <TabsTrigger value="admins" className="data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-400">
            Admins
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">User</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Role</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Status</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Subs</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Payments</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Joined</th>
                    <th className="text-left py-3 px-4 text-zinc-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>
                      {[1, 2, 3].map((i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td colSpan={7} className="py-4 px-4">
                            <div className="h-4 bg-white/5 rounded animate-pulse" />
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-400">
                        No users found
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <Fragment key={user.id}>
                        <tr
                          className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer"
                          onClick={() => handleRowClick(user.id)}
                        >
                          {/* User column: name + email stacked */}
                          <td className="py-3 px-4">
                            <div className="text-white font-medium">{user.name || "—"}</div>
                            <div className="text-zinc-400 text-xs">{user.email}</div>
                          </td>

                          {/* Role badge */}
                          <td className="py-3 px-4">
                            <Badge
                              className={
                                user.role === "admin"
                                  ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                                  : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                              }
                            >
                              {user.role}
                            </Badge>
                          </td>

                          {/* Status badge */}
                          <td className="py-3 px-4">
                            <Badge
                              className={
                                user.isBanned
                                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                                  : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              }
                            >
                              {user.isBanned ? "banned" : "active"}
                            </Badge>
                          </td>

                          <td className="py-3 px-4 text-zinc-300">{user._count.subscriptions}</td>
                          <td className="py-3 px-4 text-zinc-300">{user._count.payments}</td>
                          <td className="py-3 px-4 text-zinc-300">
                            {new Date(user.createdAt).toLocaleDateString()}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4">
                            <div className="flex gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                              {/* Role toggle */}
                              {user.role === "user" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isDisabled(user.id)}
                                  onClick={() => handleRoleChange(user)}
                                  className="border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10"
                                >
                                  Make Admin
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isDisabled(user.id)}
                                  onClick={() => handleRoleChange(user)}
                                  className="border-zinc-500/30 text-zinc-400 hover:bg-zinc-500/10"
                                >
                                  Make User
                                </Button>
                              )}

                              {/* Ban / Unban */}
                              {user.isBanned ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isDisabled(user.id)}
                                  onClick={() => handleUnban(user)}
                                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  Unban
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isDisabled(user.id)}
                                  onClick={() => handleBan(user)}
                                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                  Ban
                                </Button>
                              )}

                              {/* Impersonate */}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isDisabled(user.id)}
                                onClick={() => handleImpersonate(user)}
                                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                              >
                                Impersonate
                              </Button>

                              {/* Reset Password */}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isDisabled(user.id)}
                                onClick={() => handleResetPassword(user)}
                                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                              >
                                Reset PW
                              </Button>

                              {/* Delete (only non-admins) */}
                              {user.role !== "admin" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={isDisabled(user.id)}
                                  onClick={() => handleDelete(user)}
                                  className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded detail row */}
                        {expandedUserId === user.id && (
                          <tr key={`${user.id}-detail`} className="border-b border-white/5">
                            <td colSpan={7} className="bg-white/[0.02] border-t border-white/[0.06] p-6">
                              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Info Card */}
                                <div className="space-y-4">
                                  <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">User Info</h3>
                                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Email</span>
                                      <span className="text-white">{user.email}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Telegram</span>
                                      <span className="text-white">
                                        {user.telegramId ? (
                                          <a
                                            href={`https://t.me/${user.telegramId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-400 hover:text-blue-300"
                                          >
                                            @{user.telegramId}
                                          </a>
                                        ) : (
                                          <span className="text-zinc-500">—</span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Twitter</span>
                                      <span className="text-white">
                                        {user.twitterHandle ? (
                                          <a
                                            href={`https://twitter.com/${user.twitterHandle}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-400 hover:text-blue-300"
                                          >
                                            @{user.twitterHandle}
                                          </a>
                                        ) : (
                                          <span className="text-zinc-500">—</span>
                                        )}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Discord</span>
                                      <span className="text-white">
                                        {user.discordId || <span className="text-zinc-500">—</span>}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Member since</span>
                                      <span className="text-white">
                                        {new Date(user.createdAt).toLocaleDateString("en-US", {
                                          year: "numeric",
                                          month: "long",
                                          day: "numeric",
                                        })}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Ban info */}
                                  {user.isBanned && (
                                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 space-y-1">
                                      <p className="text-red-400 font-medium text-sm">Banned</p>
                                      {user.bannedReason && (
                                        <p className="text-red-300/80 text-sm">Reason: {user.bannedReason}</p>
                                      )}
                                      {user.bannedAt && (
                                        <p className="text-red-300/60 text-xs">
                                          Banned on {new Date(user.bannedAt).toLocaleDateString("en-US", {
                                            year: "numeric",
                                            month: "long",
                                            day: "numeric",
                                          })}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Notes Section */}
                                <div className="space-y-4">
                                  <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Admin Notes</h3>

                                  {/* Add note */}
                                  <div className="flex gap-2">
                                    <Input
                                      value={newNote}
                                      onChange={(e) => setNewNote(e.target.value)}
                                      placeholder="Add a note..."
                                      className="bg-white/5 border-white/10 text-white flex-1"
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault()
                                          handleAddNote(user.id)
                                        }
                                      }}
                                    />
                                    <Button
                                      size="sm"
                                      disabled={addingNote || !newNote.trim()}
                                      onClick={() => handleAddNote(user.id)}
                                      className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                                    >
                                      {addingNote ? "..." : "Add Note"}
                                    </Button>
                                  </div>

                                  {/* Notes list */}
                                  <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {notesLoading ? (
                                      <div className="space-y-2">
                                        {[1, 2].map((i) => (
                                          <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
                                        ))}
                                      </div>
                                    ) : notes.length === 0 ? (
                                      <p className="text-zinc-500 text-sm py-4 text-center">No notes yet</p>
                                    ) : (
                                      notes.map((note) => (
                                        <div
                                          key={note.id}
                                          className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-1"
                                        >
                                          <div className="flex items-start justify-between gap-2">
                                            <p className="text-white text-sm">{note.content}</p>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => handleDeleteNote(user.id, note.id)}
                                              className="text-zinc-500 hover:text-red-400 h-6 w-6 p-0 shrink-0"
                                            >
                                              ×
                                            </Button>
                                          </div>
                                          <p className="text-zinc-500 text-xs">
                                            {note.authorName} — {new Date(note.createdAt).toLocaleString()}
                                          </p>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
