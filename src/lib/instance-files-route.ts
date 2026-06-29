// Shared auth/loading for the agent file-browser API routes. Resolves the
// instance through impersonation + per-agent ACL, enforces operator access, and
// hands back a ready SSH target jailed to the agent root.

import { NextResponse } from "next/server"
import type { InferSelectModel } from "drizzle-orm"

import { auth } from "@/auth"
import { db, instances, eq } from "@/db"
import type { SshTarget } from "@/lib/ssh"
import { getEffectiveUserId } from "@/lib/effective-user"
import { whereUserInstanceVisible } from "@/lib/instance-queries"
import { canOperateInstance } from "@/lib/instance-access"
import {
  FilePathError,
  FileUnsupportedError,
  instanceFilesRoot,
  instanceSupportsFiles,
  sshTargetForInstance,
} from "@/lib/instance-files"

type Instance = InferSelectModel<typeof instances>

export type FilesContext = {
  userId: string
  instance: Instance
  target: SshTarget
  root: string
}

type LoadError = { error: NextResponse }

/**
 * Load the instance for a file-browser request. Operator+ is required for all
 * file actions (matching the gating on the Files tab). Returns either a context
 * or a ready-to-return error response.
 */
export async function loadFilesContext(
  instanceId: string,
): Promise<FilesContext | LoadError> {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const isAdmin = (session.user as { role?: string }).role === "admin"
  const effectiveUserId = (await getEffectiveUserId()) ?? session.user.id

  const instance = await db.query.instances.findFirst({
    where: isAdmin
      ? eq(instances.id, instanceId)
      : whereUserInstanceVisible(effectiveUserId, instanceId),
  })
  if (!instance || instance.status === "deleted") {
    return { error: NextResponse.json({ error: "Instance not found" }, { status: 404 }) }
  }

  if (!isAdmin && !(await canOperateInstance(effectiveUserId, instance.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  if (!instanceSupportsFiles(instance)) {
    return {
      error: NextResponse.json(
        { error: "File browsing is not available for this agent tier." },
        { status: 409 },
      ),
    }
  }

  let target: SshTarget
  try {
    target = sshTargetForInstance(instance)
  } catch (err) {
    if (err instanceof FileUnsupportedError) {
      return { error: NextResponse.json({ error: err.message }, { status: 409 }) }
    }
    throw err
  }

  return { userId: session.user.id, instance, target, root: instanceFilesRoot(instance) }
}

/** Map a thrown file-operation error to an API response. */
export function fileErrorResponse(err: unknown): NextResponse {
  if (err instanceof FilePathError) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  if (err instanceof FileUnsupportedError) {
    return NextResponse.json({ error: err.message }, { status: 409 })
  }
  const message = err instanceof Error ? err.message : "File operation failed."
  return NextResponse.json({ error: message }, { status: 500 })
}
