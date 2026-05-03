"use client"

import { useEffect, useState, useCallback } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  past_due: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  canceled: "bg-red-500/20 text-red-400 border-red-500/30",
  incomplete: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
}

const tabs = [
  { label: "All", value: "" },
  { label: "Active", value: "active" },
  { label: "Canceled", value: "canceled" },
  { label: "Past Due", value: "past_due" },
]

interface Sub {
  id: string
  status: string
  interval: string
  currentPeriodEnd: string | null
  createdAt: string
  user: { id: string; name: string | null; email: string }
  plan: { name: string }
  instance?: {
    name: string
    serverConfig: { label: string }
    region: { name: string }
  } | null
}

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<Sub[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const fetchSubs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/admin/subscriptions?${params.toString()}`)
      if (res.ok) setSubs(await res.json())
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter])

  useEffect(() => { fetchSubs() }, [fetchSubs])

  async function handleAction(id: string, action: "cancel" | "activate" | "delete") {
    if (action === "delete" && !confirm("Delete this subscription?")) return
    if (action === "delete") {
      await fetch(`/api/admin/subscriptions/${id}`, { method: "DELETE" })
    } else {
      await fetch(`/api/admin/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action === "cancel" ? "canceled" : "active" }),
      })
    }
    fetchSubs()
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-white">All Subscriptions</h1>

      <Input
        placeholder="Search by user email or name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="bg-white/5 border-white/10 text-white max-w-md"
      />

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-white/10 text-white border border-white/20"
                : "text-zinc-400 hover:text-white hover:bg-white/5 border border-transparent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
          <p className="text-zinc-400">Loading...</p>
        </div>
      ) : subs.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
          <p className="text-zinc-400">No subscriptions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((sub) => (
            <div key={sub.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <p className="text-white font-medium">{sub.plan.name} Plan</p>
                    <Badge className={statusStyles[sub.status] || ""}>{sub.status}</Badge>
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">{sub.user.email}</p>
                  {sub.instance && (
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {sub.instance.name} &middot; {sub.instance.region.name} &middot; {sub.instance.serverConfig.label}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sub.status !== "active" && (
                    <Button size="sm" onClick={() => handleAction(sub.id, "activate")} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                      Activate
                    </Button>
                  )}
                  {sub.status === "active" && (
                    <Button size="sm" onClick={() => handleAction(sub.id, "cancel")} className="bg-amber-600 hover:bg-amber-700 text-white text-xs">
                      Cancel
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleAction(sub.id, "delete")} className="bg-red-600 hover:bg-red-700 text-white text-xs">
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
