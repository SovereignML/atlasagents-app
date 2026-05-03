import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { db, auditLogs, eq, desc, and, like } from "@/db"
import { getEffectiveUserId } from "@/lib/effective-user"

const ACTION_STYLES: Record<string, string> = {
  "instance.deploy": "text-primary",
  "instance.delete": "text-red-400",
  "instance.restart": "text-amber-400",
  "instance.stop": "text-amber-400",
  "team.invite": "text-primary",
  "team.accept": "text-primary",
  "team.member_remove": "text-red-400",
  "team.role_change": "text-amber-400",
  "team.switch": "text-[var(--text-secondary)]",
  "account.login": "text-[var(--text-secondary)]",
  "account.password_change": "text-amber-400",
  "account.profile_update": "text-[var(--text-secondary)]",
  "billing.subscription.create": "text-primary",
  "billing.subscription.cancel": "text-red-400",
  "admin.impersonate": "text-amber-400",
  "admin.ban": "text-red-400",
  "admin.unban": "text-primary",
}

const FILTERS = [
  { label: "All", value: "" },
  { label: "Instances", value: "instance" },
  { label: "Team", value: "team" },
  { label: "Billing", value: "billing" },
  { label: "Account", value: "account" },
  { label: "Admin", value: "admin" },
]

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id
  const params = await searchParams
  const filter = params.filter || ""
  const page = Math.max(Number(params.page || "1"), 1)
  const pageSize = 50

  const conditions = [eq(auditLogs.userId, effectiveUserId)]
  if (filter) {
    conditions.push(like(auditLogs.action, `${filter}%`))
  }

  const events = await db.query.auditLogs.findMany({
    where: and(...conditions),
    orderBy: [desc(auditLogs.createdAt)],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Audit Log
        </h1>
        <p className="text-[var(--text-secondary)] mt-1 text-sm">
          Every action taken on your account. Retained for 90 days (Pro) / 365 days (Enterprise).
        </p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <a
            key={f.value}
            href={f.value ? `/dashboard/audit-log?filter=${f.value}` : "/dashboard/audit-log"}
            className={`px-3 py-1.5 text-xs font-mono border ${
              filter === f.value
                ? "border-primary text-primary bg-primary/10"
                : "border-[var(--border-color)] text-[var(--text-secondary)] hover:border-primary hover:text-primary"
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[var(--shadow-sm)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-[var(--text-secondary)] font-mono border-b border-[var(--border-color)]">
              <th className="text-left px-4 py-3">Time</th>
              <th className="text-left px-4 py-3">Action</th>
              <th className="text-left px-4 py-3">Target</th>
              <th className="text-right px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-[var(--text-secondary)] text-sm">
                  No audit events recorded yet.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="border-b border-[var(--border-color)]/50 hover:bg-primary/5">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                    {e.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  </td>
                  <td className={`px-4 py-3 font-mono text-xs ${ACTION_STYLES[e.action] || "text-[var(--text-primary)]"}`}>
                    {e.action}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-primary)]">
                    {e.targetLabel || e.targetId || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-right text-[var(--text-secondary)]">
                    {e.ipAddress || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {events.length >= pageSize && (
        <div className="flex justify-end">
          <a
            href={`/dashboard/audit-log?${filter ? `filter=${filter}&` : ""}page=${page + 1}`}
            className="px-4 py-2 text-xs font-mono border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-primary hover:text-primary"
          >
            Next Page
          </a>
        </div>
      )}
    </div>
  )
}
