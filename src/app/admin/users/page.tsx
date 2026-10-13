"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Search, X } from "lucide-react"
import { toast } from "sonner"

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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
  teams: { id: string; name: string; role: string }[]
  // Mirrors the shape returned by /api/admin/users. There is no `payments`
  // table in the schema — the column that used to read `_count.payments`
  // rendered blank for every user and now shows `instances`, which the API
  // was already computing but nothing displayed.
  _count: { subscriptions: number; instances: number; adminNotes: number }
}

interface AdminNote {
  id: string
  content: string
  authorName: string
  createdAt: string
}

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
  }
  return email.slice(0, 2).toUpperCase()
}

function roleVariant(role: string): "default" | "secondary" | "outline" {
  switch (role) {
    case "owner":
      return "default"
    case "admin":
      return "secondary"
    default: // developer | viewer
      return "outline"
  }
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

  const [banDialog, setBanDialog] = useState<{ open: boolean; user: User | null; reason: string }>({
    open: false,
    user: null,
    reason: "",
  })
  const [resetPwDialog, setResetPwDialog] = useState<{
    open: boolean
    user: User | null
    password: string
  }>({ open: false, user: null, password: "" })

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

  async function confirmBan() {
    if (!banDialog.user) return
    setActionLoading(banDialog.user.id)
    await fetch(`/api/admin/users/${banDialog.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ban",
        bannedReason: banDialog.reason || "No reason provided",
      }),
    })
    setBanDialog({ open: false, user: null, reason: "" })
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

  async function confirmResetPassword() {
    if (!resetPwDialog.user || !resetPwDialog.password) return
    setActionLoading(resetPwDialog.user.id)
    await fetch(`/api/admin/users/${resetPwDialog.user.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPwDialog.password }),
    })
    setResetPwDialog({ open: false, user: null, password: "" })
    setActionLoading(null)
  }

  async function handleDelete(user: User) {
    setActionLoading(user.id)
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" })
    if (!res.ok) {
      // Refusals explain what to do first (delete agents, cancel a plan, …).
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      toast.error(body.error ?? "Could not close the account.")
    }
    if (expandedUserId === user.id) {
      setExpandedUserId(null)
      setNotes([])
    }
    await fetchUsers()
    setActionLoading(null)
  }

  async function handleImpersonate(user: User) {
    setActionLoading(user.id)
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    })
    if (res.ok) {
      window.location.href = "/dashboard"
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
    <PageContainer>
      <PageHeader title="User Management" description="Search, ban, and impersonate platform users." />

      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
        />
      </InputGroup>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="banned">Banned</TabsTrigger>
          <TabsTrigger value="admins">Admins</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Subs</TableHead>
                  <TableHead>Agents</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Empty>
                        <EmptyHeader>
                          <EmptyTitle>No users found</EmptyTitle>
                          <EmptyDescription>
                            Try adjusting your search or filters.
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    </TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <Fragment key={user.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => handleRowClick(user.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar size="sm">
                              <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
                            </Avatar>
                            <div>
                              <Link
                                href={`/admin/users/${user.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-medium text-foreground hover:underline"
                              >
                                {user.name || "-"}
                              </Link>
                              <div className="text-xs text-muted-foreground">{user.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === "admin" ? "outline" : "secondary"}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.isBanned ? "destructive" : "default"}>
                            {user.isBanned ? "banned" : "active"}
                          </Badge>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {user.teams.length === 0 ? (
                            <span className="text-xs text-muted-foreground">-</span>
                          ) : (
                            <Popover>
                              <PopoverTrigger
                                render={
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 font-medium"
                                  >
                                    {user.teams.length}
                                  </Button>
                                }
                              />
                              <PopoverContent className="w-72 p-2" align="start">
                                <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Team access
                                </p>
                                <div className="flex max-h-64 flex-col overflow-y-auto">
                                  {user.teams.map((t) => (
                                    <div
                                      key={t.id}
                                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                                    >
                                      <Link
                                        href={`/admin/teams?teamId=${t.id}`}
                                        className="truncate text-sm text-primary hover:underline"
                                      >
                                        {t.name}
                                      </Link>
                                      <Badge
                                        variant={roleVariant(t.role)}
                                        className="shrink-0"
                                      >
                                        {t.role}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user._count.subscriptions}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {user._count.instances}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex flex-wrap gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isDisabled(user.id)}
                                  >
                                    {user.role === "user" ? "Make Admin" : "Make User"}
                                  </Button>
                                }
                              />
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    {user.role === "user"
                                      ? "Promote to admin?"
                                      : "Demote to regular user?"}
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {user.role === "user"
                                      ? `${user.email} will gain admin privileges.`
                                      : `${user.email} will lose admin privileges.`}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleRoleChange(user)}>
                                    Confirm
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>

                            {user.isBanned ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isDisabled(user.id)}
                                onClick={() => handleUnban(user)}
                              >
                                Unban
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isDisabled(user.id)}
                                onClick={() =>
                                  setBanDialog({ open: true, user, reason: "" })
                                }
                              >
                                Ban
                              </Button>
                            )}

                            <AlertDialog>
                              <AlertDialogTrigger
                                render={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isDisabled(user.id)}
                                  >
                                    Impersonate
                                  </Button>
                                }
                              />
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Impersonate {user.email}?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    You&apos;ll see their dashboard exactly as they see it.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleImpersonate(user)}>
                                    Impersonate
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>

                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isDisabled(user.id)}
                              onClick={() =>
                                setResetPwDialog({ open: true, user, password: "" })
                              }
                            >
                              Reset PW
                            </Button>

                            {user.role !== "admin" && (
                              <AlertDialog>
                                <AlertDialogTrigger
                                  render={
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={isDisabled(user.id)}
                                    >
                                      Delete
                                    </Button>
                                  }
                                />
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete {user.email}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Closes the account: sign-in is removed and personal details are
                                      anonymized. Billing and audit records are kept. Their agents must
                                      be deleted and subscriptions canceled first. This cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDelete(user)}
                                      render={<Button variant="destructive">Delete</Button>}
                                    />
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {expandedUserId === user.id && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={8} className="whitespace-normal p-6">
                            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                              <div className="space-y-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  User Info
                                </h3>
                                <Card size="sm">
                                  <CardContent className="space-y-2 text-sm">
                                    <Row label="Email" value={user.email} />
                                    <Row
                                      label="Telegram"
                                      value={
                                        user.telegramId ? (
                                          <a
                                            href={`https://t.me/${user.telegramId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline"
                                          >
                                            @{user.telegramId}
                                          </a>
                                        ) : (
                                          <span className="text-muted-foreground">-</span>
                                        )
                                      }
                                    />
                                    <Row
                                      label="Twitter"
                                      value={
                                        user.twitterHandle ? (
                                          <a
                                            href={`https://twitter.com/${user.twitterHandle}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline"
                                          >
                                            @{user.twitterHandle}
                                          </a>
                                        ) : (
                                          <span className="text-muted-foreground">-</span>
                                        )
                                      }
                                    />
                                    <Row
                                      label="Discord"
                                      value={
                                        user.discordId || (
                                          <span className="text-muted-foreground">-</span>
                                        )
                                      }
                                    />
                                    <Row
                                      label="Member since"
                                      value={new Date(user.createdAt).toLocaleDateString(
                                        "en-US",
                                        {
                                          year: "numeric",
                                          month: "long",
                                          day: "numeric",
                                        }
                                      )}
                                    />
                                  </CardContent>
                                </Card>

                                {user.isBanned && (
                                  <Card
                                    size="sm"
                                    className="border-destructive/30 bg-destructive/5"
                                  >
                                    <CardContent className="space-y-1">
                                      <p className="text-sm font-medium text-destructive">
                                        Banned
                                      </p>
                                      {user.bannedReason && (
                                        <p className="text-sm text-destructive/80">
                                          Reason: {user.bannedReason}
                                        </p>
                                      )}
                                      {user.bannedAt && (
                                        <p className="text-xs text-destructive/60">
                                          Banned on{" "}
                                          {new Date(user.bannedAt).toLocaleDateString("en-US", {
                                            year: "numeric",
                                            month: "long",
                                            day: "numeric",
                                          })}
                                        </p>
                                      )}
                                    </CardContent>
                                  </Card>
                                )}
                              </div>

                              <div className="space-y-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Admin Notes
                                </h3>

                                <Card size="sm">
                                  <CardContent>
                                    <FieldGroup>
                                      <Field orientation="vertical">
                                        <FieldLabel htmlFor={`note-${user.id}`}>
                                          New note
                                        </FieldLabel>
                                        <div className="flex gap-2">
                                          <Input
                                            id={`note-${user.id}`}
                                            value={newNote}
                                            onChange={(e) => setNewNote(e.target.value)}
                                            placeholder="Add a note..."
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
                                          >
                                            {addingNote ? "..." : "Add"}
                                          </Button>
                                        </div>
                                      </Field>
                                    </FieldGroup>
                                  </CardContent>
                                </Card>

                                <div className="max-h-64 space-y-2 overflow-y-auto">
                                  {notesLoading ? (
                                    Array.from({ length: 2 }).map((_, i) => (
                                      <Skeleton key={i} className="h-12 w-full" />
                                    ))
                                  ) : notes.length === 0 ? (
                                    <p className="py-4 text-center text-sm text-muted-foreground">
                                      No notes yet
                                    </p>
                                  ) : (
                                    notes.map((note) => (
                                      <Card key={note.id} size="sm">
                                        <CardContent className="space-y-1">
                                          <div className="flex items-start justify-between gap-2">
                                            <p className="text-sm text-foreground">
                                              {note.content}
                                            </p>
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => handleDeleteNote(user.id, note.id)}
                                              className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                                            >
                                              <X className="size-3" />
                                            </Button>
                                          </div>
                                          <p className="text-xs text-muted-foreground">
                                            {note.authorName},{" "}
                                            {new Date(note.createdAt).toLocaleString()}
                                          </p>
                                        </CardContent>
                                      </Card>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={banDialog.open}
        onOpenChange={(open) =>
          setBanDialog((d) => ({ ...d, open, reason: open ? d.reason : "" }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banDialog.user?.email}</DialogTitle>
            <DialogDescription>
              Provide a reason for the ban. The user will be signed out and prevented from logging
              in.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ban-reason">Reason</FieldLabel>
              <Input
                id="ban-reason"
                value={banDialog.reason}
                onChange={(e) => setBanDialog((d) => ({ ...d, reason: e.target.value }))}
                placeholder="Ban reason"
              />
              <FieldDescription>Visible to the user on their banned screen.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button variant="destructive" onClick={confirmBan}>
              Ban user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetPwDialog.open}
        onOpenChange={(open) =>
          setResetPwDialog((d) => ({ ...d, open, password: open ? d.password : "" }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetPwDialog.user?.email}</DialogTitle>
            <DialogDescription>
              The new password takes effect immediately. Share it securely.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-pw">New password</FieldLabel>
              <Input
                id="new-pw"
                type="text"
                value={resetPwDialog.password}
                onChange={(e) =>
                  setResetPwDialog((d) => ({ ...d, password: e.target.value }))
                }
                placeholder="New password"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={confirmResetPassword} disabled={!resetPwDialog.password}>
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}
