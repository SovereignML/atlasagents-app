export type CreateVmOpts = {
  label: string
  plan: string
  region: string
  rootPassword: string
  authorizedKeys?: string[]
  tags?: string[]
  image?: string
  /** Cloud-init user-data script. Provider-agnostic: Linode, Hetzner, DO, Vultr all support this. */
  userData?: string
}

export type VmInfo = {
  id: string
  status: string
  ipv4: string[]
  label?: string
  tags?: string[]
  created?: string
}

export interface VmProvider {
  readonly name: string
  createVM(opts: CreateVmOpts): Promise<VmInfo>
  deleteVM(id: string): Promise<boolean>
  getVM(id: string): Promise<VmInfo>
  getVMOrNull(id: string): Promise<VmInfo | null>
  listVMs(filter?: { tag?: string }): Promise<VmInfo[]>
}

export async function getVmProvider(): Promise<VmProvider> {
  const provider = process.env.VM_PROVIDER ?? "linode"
  switch (provider) {
    case "linode": {
      const { LinodeProvider } = await import("@/lib/linode")
      return new LinodeProvider()
    }
    default:
      throw new Error(`Unknown VM_PROVIDER: ${provider}`)
  }
}

export async function describeVmError(err: unknown): Promise<string> {
  const { describeLinodeError } = await import("@/lib/linode")
  return describeLinodeError(err)
}
