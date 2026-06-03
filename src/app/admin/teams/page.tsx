"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface Team {
  id: string
  name: string
  whiteLabelEnabled: boolean
  seatLimit: number
  agentLimit: number | null
  parentTeamId: string | null
  suspendedAt: string | null
  createdAt: string
  owner: { id: string; name: string | null; email: string }
  hasEnterpriseSub: boolean
  _count: { members: number; agents: number }
}

function AdminTeamsInner() {
  const searchParams = useSearchParams()
  const focusTeamId = searchParams.get("teamId") || ""

  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const fetchTeams = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("search", debouncedSearch)
    // Deep-link from the Users page focuses a single team until the admin
    // starts typing a search of their own.
    if (focusTeamId && !debouncedSearch) params.set("teamId", focusTeamId)
    const url = `/api/admin/teams${params.toString() ? `?${params}` : ""}`
    const res = await fetch(url)
    const data = await res.json()
    setTeams(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [debouncedSearch, focusTeamId])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  async function toggleWhiteLabel(team: Team) {
    const next = !team.whiteLabelEnabled
    setActionLoading(team.id)
    try {
      const res = await fetch(`/api/admin/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whiteLabelEnabled: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "Request failed")
      }
      setTeams((prev) =>
        prev.map((t) =>
          t.id === team.id ? { ...t, whiteLabelEnabled: next } : t,
        ),
      )
      toast.success(
        next
          ? `White-label enabled for ${team.name}`
          : `White-label disabled for ${team.name}`,
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update team",
      )
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Team Management"
        description="Grant or revoke white-label access per team. This switch is the sole source of truth — it overrides plan tier."
      />

      <InputGroup className="max-w-md">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by team or owner..."
        />
      </InputGroup>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Agents</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>White-label</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : teams.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No teams found</EmptyTitle>
                      <EmptyDescription>
                        Try adjusting your search.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : (
              teams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>
                    <div className="font-medium text-foreground">{team.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {team.parentTeamId && (
                        <Badge variant="secondary">child</Badge>
                      )}
                      {team.suspendedAt && (
                        <Badge variant="destructive">suspended</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {team.owner.name || "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {team.owner.email}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {team._count.members}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {team._count.agents}
                  </TableCell>
                  <TableCell>
                    {team.hasEnterpriseSub ? (
                      <Badge variant="outline">Enterprise</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={team.whiteLabelEnabled ? "default" : "secondary"}
                    >
                      {team.whiteLabelEnabled ? "enabled" : "disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant={
                              team.whiteLabelEnabled ? "outline" : "default"
                            }
                            disabled={actionLoading === team.id}
                          >
                            {team.whiteLabelEnabled ? "Disable" : "Enable"}
                          </Button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {team.whiteLabelEnabled
                              ? `Disable white-label for ${team.name}?`
                              : `Enable white-label for ${team.name}?`}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {team.whiteLabelEnabled
                              ? "Custom branding, custom domains, and the reseller panel will stop working immediately. Stored config is kept."
                              : "This grants custom branding, custom domains, and the reseller panel regardless of the team's plan."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => toggleWhiteLabel(team)}
                          >
                            {team.whiteLabelEnabled ? "Disable" : "Enable"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </PageContainer>
  )
}

export default function AdminTeamsPage() {
  return (
    <Suspense fallback={null}>
      <AdminTeamsInner />
    </Suspense>
  )
}
