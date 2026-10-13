import { NextRequest, NextResponse } from "next/server"

import { db, instanceLogs } from "@/db"
import { logAuditEvent } from "@/lib/audit"
import {
  deletePath,
  listDir,
  makeDir,
  renamePath,
  resolveScopedPath,
  writeTextFile,
  MAX_TEXT_BYTES,
} from "@/lib/instance-files"
import { fileErrorResponse, loadFilesContext } from "@/lib/instance-files-route"
import { readJsonBody } from "@/lib/request-body"
import { fileSaveSchema, fileOpSchema } from "@/lib/validations"

/** GET ?path= — list the immediate children of a directory (defaults to root). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadFilesContext(instanceId)
  if ("error" in ctx) return ctx.error

  try {
    const rel = req.nextUrl.searchParams.get("path") ?? ""
    const abs = resolveScopedPath(ctx.root, rel)
    const entries = await listDir(ctx.target, abs)
    return NextResponse.json({ root: ctx.root, path: abs, entries })
  } catch (err) {
    return fileErrorResponse(err)
  }
}

/** PUT { path, content } — overwrite (or create) a text file. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadFilesContext(instanceId)
  if ("error" in ctx) return ctx.error

  try {
    const parsed = await readJsonBody(req, fileSaveSchema)
    if (!parsed.ok) return parsed.res
    const body = parsed.data
    const content = body.content ?? ""
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
      return NextResponse.json(
        { error: `File is too large to save (max ${Math.floor(MAX_TEXT_BYTES / 1_000_000)} MB).` },
        { status: 413 },
      )
    }
    const abs = resolveScopedPath(ctx.root, body.path)
    await writeTextFile(ctx.target, ctx.instance, abs, content)

    await db.insert(instanceLogs).values({
      instanceId,
      level: "info",
      message: `File saved: ${abs}`,
    })
    await logAuditEvent({
      userId: ctx.userId,
      action: "instance.file_save",
      targetType: "instance",
      targetId: instanceId,
      targetLabel: ctx.instance.name,
      meta: { path: abs },
    })
    return NextResponse.json({ success: true, path: abs })
  } catch (err) {
    return fileErrorResponse(err)
  }
}

/** DELETE ?path=&recursive= — remove a file or directory. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadFilesContext(instanceId)
  if ("error" in ctx) return ctx.error

  try {
    const rel = req.nextUrl.searchParams.get("path")
    if (!rel) {
      return NextResponse.json({ error: "A path is required." }, { status: 400 })
    }
    const recursive = req.nextUrl.searchParams.get("recursive") === "true"
    const abs = resolveScopedPath(ctx.root, rel)
    await deletePath(ctx.target, ctx.root, abs, recursive)

    await db.insert(instanceLogs).values({
      instanceId,
      level: "info",
      message: `File deleted: ${abs}`,
    })
    await logAuditEvent({
      userId: ctx.userId,
      action: "instance.file_delete",
      targetType: "instance",
      targetId: instanceId,
      targetLabel: ctx.instance.name,
      meta: { path: abs, recursive },
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return fileErrorResponse(err)
  }
}

/** PATCH { op: "mkdir" | "rename", path, newPath? } — create folder or rename. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params
  const ctx = await loadFilesContext(instanceId)
  if ("error" in ctx) return ctx.error

  try {
    const parsed = await readJsonBody(req, fileOpSchema)
    if (!parsed.ok) return parsed.res
    const body = parsed.data
    const abs = resolveScopedPath(ctx.root, body.path)

    if (body.op === "mkdir") {
      await makeDir(ctx.target, ctx.instance, abs)
      await logAuditEvent({
        userId: ctx.userId,
        action: "instance.file_mkdir",
        targetType: "instance",
        targetId: instanceId,
        targetLabel: ctx.instance.name,
        meta: { path: abs },
      })
      return NextResponse.json({ success: true, path: abs })
    }

    if (body.op === "rename") {
      const absTo = resolveScopedPath(ctx.root, body.newPath)
      await renamePath(ctx.target, ctx.root, abs, absTo)
      await logAuditEvent({
        userId: ctx.userId,
        action: "instance.file_rename",
        targetType: "instance",
        targetId: instanceId,
        targetLabel: ctx.instance.name,
        meta: { from: abs, to: absTo },
      })
      return NextResponse.json({ success: true, path: absTo })
    }

    return NextResponse.json({ error: 'op must be "mkdir" or "rename".' }, { status: 400 })
  } catch (err) {
    return fileErrorResponse(err)
  }
}
