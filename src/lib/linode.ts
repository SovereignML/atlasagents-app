import {
  createLinode,
  deleteLinode,
  getLinode,
  getLinodes,
  getLinodeDisks,
  createImage,
  getImage,
  setToken,
} from "@linode/api-v4"
import type { Linode, CreateLinodeRequest } from "@linode/api-v4/lib/linodes"
import type { Image } from "@linode/api-v4/lib/images"
import type { VmProvider, CreateVmOpts, VmInfo } from "@/lib/vm-provider"

let tokenInitialized = false
function ensureToken() {
  if (tokenInitialized) return
  const token = process.env.LINODE_API_TOKEN
  if (!token) {
    throw new Error("LINODE_API_TOKEN is not set")
  }
  setToken(token)
  tokenInitialized = true
}

function linodeToVmInfo(vm: Linode): VmInfo {
  return {
    id: String(vm.id),
    status: vm.status,
    ipv4: vm.ipv4 ?? [],
    label: vm.label ?? undefined,
    tags: vm.tags ?? [],
    created: vm.created ?? undefined,
  }
}

function isLinodeNotFound(err: unknown): boolean {
  const e = err as { response?: { status?: number } }
  return e?.response?.status === 404
}

/**
 * Turn a Linode/axios error into a single readable line. Crucial for logs:
 * the raw AxiosError includes `config.headers.Authorization` (our bearer
 * token), which must never land in pm2 log files.
 */
export function describeLinodeError(err: unknown): string {
  const e = err as {
    response?: { status?: number; data?: { errors?: Array<{ field?: string; reason?: string }> } }
    message?: string
  }
  const status = e?.response?.status
  const errors = e?.response?.data?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const parts = errors.map((x) => (x.field ? `${x.field}: ${x.reason ?? ""}` : x.reason ?? ""))
    return status ? `Linode ${status}: ${parts.join("; ")}` : parts.join("; ")
  }
  if (status) return `Linode ${status}: ${e.message ?? "unknown"}`
  return e?.message ?? String(err)
}

export class LinodeProvider implements VmProvider {
  readonly name = "linode"

  async createVM(opts: CreateVmOpts): Promise<VmInfo> {
    ensureToken()
    const payload: CreateLinodeRequest = {
      label: opts.label,
      type: opts.plan,
      region: opts.region,
      root_pass: opts.rootPassword,
      image: opts.image ?? "linode/ubuntu24.04",
      authorized_keys: opts.authorizedKeys,
      tags: opts.tags,
      ...(opts.userData
        ? { metadata: { user_data: Buffer.from(opts.userData, "utf8").toString("base64") } }
        : {}),
    } as CreateLinodeRequest
    const vm = await createLinode(payload)
    return linodeToVmInfo(vm)
  }

  async deleteVM(id: string): Promise<boolean> {
    ensureToken()
    try {
      await deleteLinode(Number(id))
      return true
    } catch (err) {
      if (isLinodeNotFound(err)) return false
      throw err
    }
  }

  async getVM(id: string): Promise<VmInfo> {
    ensureToken()
    const vm = await getLinode(Number(id))
    return linodeToVmInfo(vm)
  }

  async getVMOrNull(id: string): Promise<VmInfo | null> {
    ensureToken()
    try {
      const vm = await getLinode(Number(id))
      return linodeToVmInfo(vm)
    } catch (err) {
      if (isLinodeNotFound(err)) return null
      throw err
    }
  }

  async getFirstDiskId(linodeId: string): Promise<number> {
    ensureToken()
    const resp = await getLinodeDisks(Number(linodeId))
    const disks = resp.data ?? []
    if (disks.length === 0) {
      throw new Error(`Linode ${linodeId} has no disks`)
    }
    return disks[0].id
  }

  async captureImage(opts: {
    linodeId: string
    diskId: number
    label: string
    description?: string
    tags?: string[]
  }): Promise<Image> {
    ensureToken()
    return createImage({
      disk_id: opts.diskId,
      label: opts.label,
      description: opts.description,
      tags: opts.tags,
      cloud_init: true,
    })
  }

  async waitForImage(
    imageId: string,
    timeoutMs = 600_000,
    pollMs = 10_000,
  ): Promise<Image> {
    ensureToken()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const img = await getImage(imageId)
      if (img.status === "available") return img
      await new Promise((r) => setTimeout(r, pollMs))
    }
    throw new Error(`Image ${imageId} did not become available within ${timeoutMs}ms`)
  }

  async listVMs(filter?: { tag?: string }): Promise<VmInfo[]> {
    ensureToken()
    const out: VmInfo[] = []
    const pageSize = 100
    let page = 1
    const filterObj: Record<string, unknown> = {}
    if (filter?.tag) filterObj["+order"] = "asc"
    while (true) {
      const resp = await getLinodes({ page, page_size: pageSize }, filterObj)
      const data = resp.data ?? []
      for (const vm of data) {
        if (!filter?.tag || (vm.tags ?? []).includes(filter.tag)) {
          out.push(linodeToVmInfo(vm))
        }
      }
      if (page * pageSize >= (resp.results ?? 0)) break
      page++
      if (page > 50) break
    }
    return out
  }
}
