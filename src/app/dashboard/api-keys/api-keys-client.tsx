"use client"

import { useState } from "react"

type Key = {
  id: string
  name: string
  prefix: string
  created: string
  lastUsed: string
  scopes: string[]
}

export function ApiKeysClient({ initial }: { initial: Key[] }) {
  const [keys, setKeys] = useState<Key[]>(initial)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  function handleCreate() {
    if (!newKeyName.trim()) return
    const secret = `sk_live_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
    const prefix = secret.slice(0, 12)
    setKeys((prev) => [
      {
        id: `ak_${Date.now()}`,
        name: newKeyName.trim(),
        prefix,
        created: new Date().toISOString().slice(0, 10),
        lastUsed: "never",
        scopes: ["agents:read", "agents:write"],
      },
      ...prev,
    ])
    setRevealedSecret(secret)
    setNewKeyName("")
    setCreating(false)
  }

  function handleRevoke(id: string) {
    if (!confirm("Revoke this key? Clients using it will stop working immediately.")) return
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1
            className="text-2xl font-bold uppercase tracking-[0.02em] text-[var(--text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            API Keys
          </h1>
          <p className="text-[var(--text-secondary)] mt-1 text-sm">
            Personal access tokens for the public API. Treat like passwords — never commit them.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="btn-primary text-sm px-5 py-2.5"
        >
          + New Key
        </button>
      </div>

      {creating && (
        <div className="border border-[var(--accent-color)] bg-[var(--accent-dim)]/30 p-5 space-y-3">
          <p className="text-[10px] uppercase tracking-[0.1em] font-mono text-[var(--accent-color)]">
            Create key
          </p>
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Production, CI, local-dev"
            className="w-full bg-[var(--card-bg)] border border-[var(--border-color)] px-4 py-2 font-mono text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)]"
            autoFocus
          />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs px-4 py-2">Create</button>
            <button
              onClick={() => { setCreating(false); setNewKeyName("") }}
              className="px-4 py-2 text-xs uppercase tracking-[0.08em] font-mono border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {revealedSecret && (
        <div className="border border-amber-500/40 bg-amber-500/5 p-5 space-y-3">
          <p className="text-xs uppercase tracking-[0.1em] font-mono text-amber-400">
            Copy now — you won&apos;t see this again
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-[var(--code-bg)] border border-[var(--border-color)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] break-all">
              {revealedSecret}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(revealedSecret); }}
              className="px-4 py-2 text-xs uppercase tracking-[0.08em] font-mono border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-color)]"
            >
              Copy
            </button>
            <button
              onClick={() => setRevealedSecret(null)}
              className="px-4 py-2 text-xs uppercase tracking-[0.08em] font-mono border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="border border-[var(--border-color)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)] font-mono border-b border-[var(--border-color)]">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Key</th>
              <th className="text-left px-4 py-3">Scopes</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="text-left px-4 py-3">Last Used</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No keys yet. Create one to get started.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-[var(--border-color)]/50">
                <td className="px-4 py-3 text-[var(--text-primary)]">{k.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                  {k.prefix}••••••••
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {k.scopes.map((s) => (
                      <span key={s} className="text-[10px] font-mono border border-[var(--border-color)] px-1.5 py-0.5 text-[var(--text-secondary)]">
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">{k.created}</td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">{k.lastUsed}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleRevoke(k.id)}
                    className="text-xs uppercase tracking-[0.08em] font-mono text-red-400 hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] font-mono text-amber-400/80">
        ⚠ local UI state only — ApiKey model + `/api/keys` endpoints pending
      </p>
    </div>
  )
}
