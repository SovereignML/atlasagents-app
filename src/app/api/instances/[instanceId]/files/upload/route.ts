import { NextRequest, NextResponse } from "next/server"
import { posix as posixPath } from "node:path"

import { db, instanceLogs } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import { resolveScopedPath, uploadFile, MAX_BINARY_BYTES } from "@/lib/instance-files"
import { fileErrorResponse, loadFilesContext } from "@/lib/instance-files-route"

/** POST multipart { path (target dir), file } — upload a file into a directory. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadFilesContext(instanceId)
  if ("error" in ctx) return ctx.error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 })
  }

  const dir = String(form.get("path") ?? "")
  const file = form.get("file")
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 })
  }
  if (file.size > MAX_BINARY_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.floor(MAX_BINARY_BYTES / 1_000_000)} MB).` },
      { status: 413 },
    )
  }

  // Derive the filename from the upload; reject anything with path separators.
  const rawName = file instanceof File ? file.name : "upload"
  const fileName = posixPath.basename(rawName)
  if (!fileName || fileName === "." || fileName === ".." || fileName.includes("/")) {
    return NextResponse.json({ error: "Invalid file name." }, { status: 400 })
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "Empty file." }, { status: 400 })
    }
    const absDir = resolveScopedPath(ctx.root, dir)
    const absPath = resolveScopedPath(ctx.root, posixPath.join(dir, fileName))
    await uploadFile(ctx.target, ctx.instance, absPath, bytes)

    await db.insert(instanceLogs).values({
      instanceId,
      level: "info",
      message: `File uploaded: ${absPath}`,
    })
    await logAuditEvent({
      userId: ctx.userId,
      action: "instance.file_upload",
      targetType: "instance",
      targetId: instanceId,
      targetLabel: ctx.instance.name,
      meta: { path: absPath, size: bytes.byteLength },
    })
    return NextResponse.json({ success: true, path: absPath, dir: absDir })
  } catch (err) {
    return fileErrorResponse(err)
  }
}
