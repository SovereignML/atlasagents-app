"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

/**
 * Per-row destroy for a pre-baked (warm) VM. Confirms, then DELETEs
 * /api/admin/warm-pool/:id and refreshes the server component. The pool
 * self-refills, so a destroyed slot is replaced on the next refill pass.
 */
export function DestroyWarmVmButton({
  warmVmId,
  poolKey,
  status,
}: {
  warmVmId: string
  poolKey: string
  status: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  async function destroy() {
    try {
      const res = await fetch(`/api/admin/warm-pool/${warmVmId}`, { method: "DELETE" })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
        throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`)
      }
      toast.success("Warm VM destroyed")
      setOpen(false)
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(`Destroy failed: ${(err as Error).message}`)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="icon-sm"
        className="text-destructive"
        title="Destroy warm VM"
        onClick={() => setOpen(true)}
      >
        <Trash2 />
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Destroy this pre-baked VM?</AlertDialogTitle>
            <AlertDialogDescription>
              {status === "claimed" ? (
                <>
                  This VM is <strong>claimed</strong> by a live instance — only the pool tracking row
                  is removed; the VM keeps running for its instance.
                </>
              ) : (
                <>
                  This deletes the provider VM and its DNS record for{" "}
                  <span className="font-mono">{poolKey}</span>. The pool will replace it on the next
                  refill. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={pending} onClick={destroy}>
              {pending ? "Destroying…" : "Destroy"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
