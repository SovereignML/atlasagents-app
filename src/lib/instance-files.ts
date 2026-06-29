// Live file browser for a deployed agent's VPS filesystem.
//
// Every operation is jailed to the runtime install dir (e.g. /opt/openclaw).
// The browser talks to the VM over the existing SSH helpers (sshRun /
// sshWriteFile); we never trust a client-supplied absolute path — callers pass
// a path relative to the agent root and we resolve + verify it stays inside.

import { posix as posixPath } from "node:path"
import type { InferSelectModel } from "drizzle-orm"

import type { instances } from "@/db"
import { getRuntime } from "@/lib/runtimes"
import { sshRun, sshWriteFile, type SshTarget, type SshRunResult } from "@/lib/ssh"

type Instance = InferSelectModel<typeof instances>

/** Text editing is capped — configs/data files, not corpora. */
export const MAX_TEXT_BYTES = 1_000_000
/** Upload/download ceiling. base64-over-SSH keeps the whole payload in memory. */
export const MAX_BINARY_BYTES = 25_000_000

export type FileEntry = {
  name: string
  type: "dir" | "file" | "other"
  size: number
  /** Unix epoch milliseconds, or null when unknown. */
  modifiedAt: number | null
}

/** Thrown when a resolved path escapes the agent root, or input is invalid. */
export class FilePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FilePathError"
  }
}

/** Thrown when an instance has no SSH-reachable host (shared tier / not running). */
export class FileUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "FileUnsupportedError"
  }
}

/** True when this instance runs on an SSH-reachable host (managed VPS or BYOS). */
export function instanceSupportsFiles(instance: Instance): boolean {
  return instance.deploymentTarget === "vps" || instance.deploymentTarget === "byos"
}

/** Absolute root every path for this agent is jailed under. */
export function instanceFilesRoot(instance: Instance): string {
  return getRuntime(instance.runtime).paths.installDir
}

/** Runtime system user that should own files the agent reads. */
function instanceSystemUser(instance: Instance): string {
  return getRuntime(instance.runtime).paths.systemUser
}

/**
 * SSH target for an instance's host. Managed VPS always uses root@22; BYOS
 * servers may carry a custom login user / port on the row. Mirrors the private
 * `sshTargetFor` in provisioner.ts (duplicated to avoid importing that module).
 */
export function sshTargetForInstance(instance: Instance): SshTarget {
  if (!instanceSupportsFiles(instance)) {
    throw new FileUnsupportedError("File browsing is not available for this agent tier.")
  }
  if (!instance.ipAddress) {
    throw new FileUnsupportedError("This agent has no reachable host yet.")
  }
  const target: SshTarget = { host: instance.ipAddress, instanceId: instance.id }
  if (instance.deploymentTarget === "byos") {
    target.port = instance.byosPort ?? 22
    target.username = instance.byosUser ?? "root"
  }
  return target
}

/**
 * Resolve a client-supplied relative path against the agent root, returning the
 * absolute path. Throws FilePathError if the result would escape the root —
 * this is the core security control, so it runs on EVERY operation.
 */
export function resolveScopedPath(root: string, relPath: string): string {
  if (typeof relPath !== "string") {
    throw new FilePathError("A path is required.")
  }
  if (relPath.includes("\0")) {
    throw new FilePathError("Invalid path.")
  }
  // Treat the input as relative to root regardless of leading slashes.
  const cleaned = relPath.replace(/^\/+/, "")
  const abs = posixPath.normalize(posixPath.join(root, cleaned))
  if (abs !== root && !abs.startsWith(root + "/")) {
    throw new FilePathError("Path is outside the agent directory.")
  }
  return abs
}

/** Single-quote wrap for safe interpolation into a shell command. */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function ensureOk(result: SshRunResult, action: string): SshRunResult {
  if (result.code !== 0 && result.code !== null) {
    const detail = (result.stderr || result.stdout || "").trim().slice(0, 300)
    throw new Error(`${action} failed${detail ? `: ${detail}` : ""}.`)
  }
  return result
}

/**
 * List the immediate children of a directory. Uses GNU find's -printf so we get
 * structured type/size/mtime without parsing `ls`.
 */
export async function listDir(target: SshTarget, absDir: string): Promise<FileEntry[]> {
  const cmd =
    `test -d ${shellEscape(absDir)} && ` +
    `find ${shellEscape(absDir)} -maxdepth 1 -mindepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n'`
  const result = await sshRun(target, cmd)
  if (result.code !== 0) {
    const detail = (result.stderr || "").trim()
    if (/No such file|not a directory/i.test(detail) || result.code === 1) {
      throw new FilePathError("Directory not found.")
    }
    throw new Error(`Listing failed${detail ? `: ${detail.slice(0, 200)}` : ""}.`)
  }

  const entries: FileEntry[] = []
  for (const line of result.stdout.split("\n")) {
    if (!line) continue
    const [rawType, rawSize, rawMtime, ...nameParts] = line.split("\t")
    const name = nameParts.join("\t")
    if (!name) continue
    const type = rawType === "d" ? "dir" : rawType === "f" ? "file" : "other"
    const size = Number.parseInt(rawSize, 10)
    const mtimeSec = Number.parseFloat(rawMtime)
    entries.push({
      name,
      type,
      size: Number.isFinite(size) ? size : 0,
      modifiedAt: Number.isFinite(mtimeSec) ? Math.round(mtimeSec * 1000) : null,
    })
  }
  // Directories first, then alphabetical (case-insensitive).
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1
    if (a.type !== "dir" && b.type === "dir") return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
  return entries
}

/** Byte size of a regular file, or throw if it isn't one. */
async function fileSize(target: SshTarget, absPath: string): Promise<number> {
  const result = await sshRun(
    target,
    `test -f ${shellEscape(absPath)} && stat -c %s ${shellEscape(absPath)}`,
  )
  if (result.code !== 0) {
    throw new FilePathError("File not found.")
  }
  const size = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isFinite(size)) {
    throw new Error("Could not determine file size.")
  }
  return size
}

export type ReadTextResult = { content: string; size: number; truncated: boolean }

/**
 * Read a file's text for the editor. Files larger than maxBytes are rejected as
 * `truncated` with no content, so we never stream a huge file into the browser.
 */
export async function readTextFile(
  target: SshTarget,
  absPath: string,
  maxBytes = MAX_TEXT_BYTES,
): Promise<ReadTextResult> {
  const size = await fileSize(target, absPath)
  if (size > maxBytes) {
    return { content: "", size, truncated: true }
  }
  const result = ensureOk(
    await sshRun(target, `base64 -w0 ${shellEscape(absPath)}`),
    "Read",
  )
  const content = Buffer.from(result.stdout.trim(), "base64").toString("utf8")
  return { content, size, truncated: false }
}

/** Read a file's raw bytes (for download). Rejects files over maxBytes. */
export async function readFileBytes(
  target: SshTarget,
  absPath: string,
  maxBytes = MAX_BINARY_BYTES,
): Promise<Buffer> {
  const size = await fileSize(target, absPath)
  if (size > maxBytes) {
    throw new FilePathError(
      `File is too large to download (max ${Math.floor(maxBytes / 1_000_000)} MB).`,
    )
  }
  const result = ensureOk(
    await sshRun(target, `base64 -w0 ${shellEscape(absPath)}`),
    "Download",
  )
  return Buffer.from(result.stdout.trim(), "base64")
}

/** chown a path (best-effort) to the runtime system user so the agent can read it. */
async function chownToRuntime(
  target: SshTarget,
  instance: Instance,
  absPath: string,
): Promise<void> {
  const user = instanceSystemUser(instance)
  await sshRun(
    target,
    `chown -R ${shellEscape(user)}:${shellEscape(user)} ${shellEscape(absPath)} 2>/dev/null || true`,
  )
}

/** Write UTF-8 text to a file, creating parents, then chown to the runtime user. */
export async function writeTextFile(
  target: SshTarget,
  instance: Instance,
  absPath: string,
  content: string,
): Promise<void> {
  ensureOk(await sshWriteFile(target, absPath, content), "Save")
  await chownToRuntime(target, instance, absPath)
}

/**
 * Write raw bytes to a file (upload), creating parents, then chown. We base64
 * the buffer ourselves and pipe it through `base64 -d` so arbitrary bytes are
 * byte-exact — sshWriteFile assumes UTF-8 input and would corrupt binary.
 */
export async function uploadFile(
  target: SshTarget,
  instance: Instance,
  absPath: string,
  bytes: Buffer,
): Promise<void> {
  const b64 = bytes.toString("base64")
  const dir = posixPath.dirname(absPath)
  const cmd = [
    `mkdir -p ${shellEscape(dir)}`,
    `echo ${shellEscape(b64)} | base64 -d > ${shellEscape(absPath)}`,
  ].join(" && ")
  ensureOk(await sshRun(target, cmd), "Upload")
  await chownToRuntime(target, instance, absPath)
}

/** Create a directory (mkdir -p) and chown it to the runtime user. */
export async function makeDir(
  target: SshTarget,
  instance: Instance,
  absPath: string,
): Promise<void> {
  ensureOk(await sshRun(target, `mkdir -p ${shellEscape(absPath)}`), "Create folder")
  await chownToRuntime(target, instance, absPath)
}

/** Delete a file, or a directory when recursive. Refuses to delete the root. */
export async function deletePath(
  target: SshTarget,
  root: string,
  absPath: string,
  recursive: boolean,
): Promise<void> {
  if (absPath === root) {
    throw new FilePathError("Cannot delete the agent root directory.")
  }
  const cmd = recursive
    ? `rm -rf ${shellEscape(absPath)}`
    : `rm -f ${shellEscape(absPath)}`
  ensureOk(await sshRun(target, cmd), "Delete")
}

/** Rename/move a path. Both source and destination must already be scoped. */
export async function renamePath(
  target: SshTarget,
  root: string,
  absFrom: string,
  absTo: string,
): Promise<void> {
  if (absFrom === root) {
    throw new FilePathError("Cannot rename the agent root directory.")
  }
  ensureOk(
    await sshRun(target, `mv -n ${shellEscape(absFrom)} ${shellEscape(absTo)}`),
    "Rename",
  )
}
