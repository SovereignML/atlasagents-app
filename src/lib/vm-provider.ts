export type CreateVmOpts = {
  label: string
  plan: string
  region: string
  rootPassword: string
  authorizedKeys?: string[]
  tags?: string[]
  image?: string
  /** Cloud-init user-data script. Provider-agnostic: Linode, DO, OVH all support this. */
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

/** Lifecycle surface — create/read/delete a VM. Every provider implements this. */
export interface VmProvider {
  readonly name: string
  createVM(opts: CreateVmOpts): Promise<VmInfo>
  deleteVM(id: string): Promise<boolean>
  getVM(id: string): Promise<VmInfo>
  getVMOrNull(id: string): Promise<VmInfo | null>
  listVMs(filter?: { tag?: string }): Promise<VmInfo[]>
}

// ──────────────────────────────────────────────────────────────────────
// Multi-provider capability surface (VpsProvider)
// ──────────────────────────────────────────────────────────────────────

export type NormalizedCategory = "SHARED_CPU" | "DEDICATED_CPU"

/** A provider's plan, normalized to our shape. Returned by listPlans() and used
 *  for admin catalog sync + tests — NOT on the provisioning hot path, which
 *  reads the pre-mapped `provider_plans` table. */
export type NormalizedPlan = {
  providerPlanCode: string
  category: NormalizedCategory
  vcpu: number
  ramGb: number
  diskGb: number
  monthlyCostUsd: number
}

export type ProviderRegionInfo = {
  code: string
  name: string
}

export type ProviderHealthStatus = "up" | "degraded" | "down"

export type ProviderHealth = {
  status: ProviderHealthStatus
  latencyMs: number | null
  detail?: Record<string, unknown>
}

/**
 * Full provider surface used by the router: lifecycle (VmProvider) + capability
 * metadata. `createServer` / `deleteServer` from the spec map to the existing
 * `createVM` / `deleteVM` (no rename — avoids churn across the provisioner).
 */
export interface VpsProvider extends VmProvider {
  listPlans(): Promise<NormalizedPlan[]>
  getRegions(): Promise<ProviderRegionInfo[]>
  healthCheck(): Promise<ProviderHealth>
  /**
   * Internal-budget model: remaining USD for this provider's current cycle,
   * read from `provider_billing` (monthlyCreditsUsd − currentUsageUsd). Never
   * calls a provider account API. Returns null when no budget row is configured.
   */
  getRemainingCredit(): Promise<number | null>
}

/**
 * Legacy env-driven factory (`VM_PROVIDER`, default "linode"). Retained for the
 * shared-cluster / non-routed paths. The VPS path uses the router + the
 * slug/id factories in src/lib/providers.
 */
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
