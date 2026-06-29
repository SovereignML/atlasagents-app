import { NextRequest, NextResponse } from "next/server"
import { posix as posixPath } from "node:path"

import { readFileBytes, resolveScopedPath } from "@/lib/instance-files"
import { fileErrorResponse, loadFilesContext } from "@/lib/instance-files-route"

/** GET ?path= — stream a file back to the browser as an attachment. */
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
    const bytes = await readFileBytes(ctx.target, abs)
    const fileName = posixPath.basename(abs) || "download"

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      },
    })
  } catch (err) {
    return fileErrorResponse(err)
  }
}
