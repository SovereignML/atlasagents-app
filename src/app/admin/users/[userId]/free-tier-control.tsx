"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Props = {
  userId: string
  defaultLimit: number
  limitOverride: number | null
  lifetimeCount: number
}

export function FreeTierControl({
  userId,
  defaultLimit,
  limitOverride,
  lifetimeCount,
}: Props) {
  const router = useRouter()
  const [value, setValue] = useState(
    String(limitOverride ?? defaultLimit),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(limit: number | null) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/free-tier`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Failed to update limit")
      }
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update limit")
    } finally {
      setSaving(false)
    }
  }

  function onSave() {
    const n = Number(value)
    if (!Number.isInteger(n) || n < 0 || n > 1000) {
      setError("Enter a whole number between 0 and 1000.")
      return
    }
    save(n)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label
            htmlFor="free-limit"
            className="text-xs font-medium text-muted-foreground"
          >
            Lifetime free-agent limit
          </label>
          <Input
            id="free-limit"
            type="number"
            min={0}
            max={1000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-32"
          />
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save limit"}
        </Button>
        {limitOverride !== null && (
          <Button
            variant="outline"
            onClick={() => save(null)}
            disabled={saving}
          >
            Reset to default ({defaultLimit})
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {limitOverride === null
          ? `Using the platform default of ${defaultLimit}. `
          : `Custom override of ${limitOverride} is active. `}
        This user has deployed {lifetimeCount} free agent
        {lifetimeCount === 1 ? "" : "s"} so far. To grant a fresh allowance, set
        the limit above their current usage.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
