"use client"

import { useState, useTransition } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type UserRow = {
  userId: string
  teamId: string
  name: string | null
  email: string
  customer: string
  role: string
  joinedAt: string
}

function roleVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "owner") return "default"
  if (role === "admin") return "secondary"
  return "outline"
}

export function UsersClient({ users }: { users: UserRow[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  async function call(url: string, init: RequestInit) {
    setError(null)
    setSuccess(null)
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || "Something went wrong")
      return false
    }
    return true
  }

  async function sendReset(u: UserRow) {
    setBusyUserId(u.userId)
    const ok = await call(`/api/tenant-admin/users/${u.userId}/reset-password`, {
      method: "POST",
    })
    setBusyUserId(null)
    if (ok) {
      startTransition(() => setSuccess(`Password reset email sent to ${u.email}.`))
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No users across your customers yet.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={`${u.userId}-${u.teamId}`}>
                  <TableCell className="font-medium">{u.name || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{u.customer}</TableCell>
                  <TableCell>
                    <Badge variant={roleVariant(u.role)}>{u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(u.joinedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending || busyUserId === u.userId}
                      onClick={() => sendReset(u)}
                    >
                      {busyUserId === u.userId ? "Sending..." : "Send password reset"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
