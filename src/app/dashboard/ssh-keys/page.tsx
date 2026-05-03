import { auth } from "@/auth"
import { db, eq, desc, sshKeys } from "@/db"
import { redirect } from "next/navigation"

export default async function SshKeysPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const keys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, session.user.id),
    orderBy: desc(sshKeys.createdAt),
  })

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">SSH Keys</h1>
        <p className="text-[var(--text-secondary)] mt-1">Manage SSH keys for your deployments</p>
      </div>

      {keys.length === 0 ? (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-8 text-center">
          <p className="text-[var(--text-secondary)]">No SSH keys yet. Keys are automatically added when you deploy with an SSH key.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[var(--text-primary)] font-medium">{key.name}</p>
                  <p className="text-xs text-[var(--text-secondary)] font-mono mt-1">{key.fingerprint}</p>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{key.createdAt.toISOString().slice(0, 10)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
