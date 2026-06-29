import { NextRequest, NextResponse } from "next/server"

import { readTextFile, resolveScopedPath } from "@/lib/instance-files"
import { fileErrorResponse, loadFilesContext } from "@/lib/instance-files-route"

/** GET ?path= — read a text file's content for the editor. */
export async function GET(
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
    const abs = resolveScopedPath(ctx.root, rel)
    const { content, size, truncated } = await readTextFile(ctx.target, abs)
    return NextResponse.json({ path: abs, content, size, truncated })
  } catch (err) {
    return fileErrorResponse(err)
  }
}
