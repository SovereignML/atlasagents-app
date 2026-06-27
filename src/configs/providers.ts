// Multi-provider catalog — static source of truth for SEEDING the
// `providers`, `provider_plans`, `provider_regions`, and `provider_billing`
// tables (see src/db/seed.ts). At runtime the router reads the DB, not this
// file, so admins can override mappings/budgets without a redeploy.
//
// Plan codes + monthly costs below are realistic public values but SHOULD be
// verified against each provider's live catalog before production — provider
// plan codes and pricing drift over time. Normalized tiers (the `serverConfigs`
// slugs from src/configs/server-types.ts) are matched primarily on
// category + RAM; vCPU may differ slightly where a provider has no exact match.

export type ProviderSlug = "linode" | "digitalocean" | "ovh"

export type ProviderDef = {
  slug: ProviderSlug
  name: string
  /** Env var that holds this provider's API token. Secrets never live in the DB. */
  credentialEnvKey: string
  /** Higher wins routing. DO is primary today. */
  defaultPriority: number
  /**
   * Seed value for providers.enabled on FIRST insert only. Re-seed never
   * clobbers this (admin overrides win) — flip enablement later via /admin/providers.
   * Akamai (linode) and DigitalOcean are active; Akamai is ranked highest so the
   * router prefers it by default. OVH stays seeded-but-disabled until we have
   * credit, so it can be enabled later without a redeploy. NOTE: enabling Akamai
   * requires LINODE_API_TOKEN to be set, or provisioning to it will fail.
   */
  enabled: boolean
  /** Seed values for provider_billing (USD). Internal-budget model. */
  budget: {
    monthlyCreditsUsd: number
    softLimitUsd: number
    hardLimitUsd: number
  }
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    slug: "digitalocean",
    name: "DigitalOcean",
    credentialEnvKey: "DIGITALOCEAN_API_TOKEN",
    defaultPriority: 100,
    enabled: true,
    budget: { monthlyCreditsUsd: 3000, softLimitUsd: 2400, hardLimitUsd: 3000 },
  },
  {
    slug: "ovh",
    name: "OVHcloud",
    credentialEnvKey: "OVH_APP_KEY",
    // Primary provider — ranked above Akamai (110) and DigitalOcean (100) so the
    // router prefers OVH US VPS by default. Akamai/DO stay enabled as failover.
    // Requires OVH_APP_KEY/SECRET/CONSUMER_KEY (endpoint ovh-us) + a default
    // payment method on the OVH account for VPS ordering to succeed.
    defaultPriority: 120,
    enabled: true,
    budget: { monthlyCreditsUsd: 2000, softLimitUsd: 1600, hardLimitUsd: 2000 },
  },
  {
    // Akamai Connected Cloud (formerly Linode). The `linode` slug is the
    // provider adapter id and must stay "linode"; only the display name is Akamai.
    slug: "linode",
    name: "Akamai",
    credentialEnvKey: "LINODE_API_TOKEN",
    // Ranked above DigitalOcean (100) so the router prefers Akamai by default.
    defaultPriority: 110,
    enabled: true,
    budget: { monthlyCreditsUsd: 5000, softLimitUsd: 4000, hardLimitUsd: 5000 },
  },
] as const

type PlanCode = { code: string; monthlyCostUsd: number }

export type ProviderPlanMapping = {
  /** Normalized tier — must match a serverConfigs.slug. */
  serverConfigSlug: string
  codes: Partial<Record<ProviderSlug, PlanCode>>
}

// For OVH, `code` is the VPS product planCode (e.g. "vps-2025-model1"); the
// adapter resolves it against the live order catalog at create time and tolerates
// OVH's yearly range renames (vps-YYYY-modelN). OVH only sells the 3 VPS tiers
// below, so it is intentionally absent from every other server config — the
// router falls back to DigitalOcean/Akamai for those. Linode/DO use the code
// verbatim. OVH monthlyCostUsd values are OVH's US VPS list prices (our cost),
// not the customer-facing price (that lives in src/configs/server-types.ts).
export const PROVIDER_PLAN_MAP: readonly ProviderPlanMapping[] = [
  // Shared CPU
  // NOTE: DigitalOcean codes below are wired to the 4 plan tiers (free/builder/
  // operator/scale → shared-1g/4g/8g/16g) using Regular SSD "Shared Basic" sizes
  // available on the current DO account (size/droplet-capped). They intentionally
  // run smaller than the serverConfig's advertised RAM; revisit after a DO limit
  // increase. Prices are DO's actual monthly cost.
  {
    serverConfigSlug: "shared-1g", // plan: free
    codes: {
      linode: { code: "g6-nanode-1", monthlyCostUsd: 5 },
      digitalocean: { code: "s-1vcpu-2gb", monthlyCostUsd: 12 },
    },
  },
  {
    serverConfigSlug: "shared-2g",
    codes: {
      linode: { code: "g6-standard-1", monthlyCostUsd: 12 },
      digitalocean: { code: "s-1vcpu-2gb", monthlyCostUsd: 12 },
    },
  },
  {
    serverConfigSlug: "shared-4g", // plan: builder
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-2gb", monthlyCostUsd: 18 },
      // OVH VPS-1: 2 vCore / 4 GB / 40 GB SSD.
      ovh: { code: "vps-2025-model1", monthlyCostUsd: 4.54 },
    },
  },
  {
    serverConfigSlug: "shared-8g", // plan: operator
    codes: {
      linode: { code: "g6-standard-4", monthlyCostUsd: 48 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
      // OVH VPS-2: 4 vCore / 8 GB / 75 GB SSD NVMe.
      ovh: { code: "vps-2025-model2", monthlyCostUsd: 8.5 },
    },
  },
  {
    serverConfigSlug: "shared-16g", // plan: scale
    codes: {
      linode: { code: "g6-standard-6", monthlyCostUsd: 96 },
      digitalocean: { code: "s-4vcpu-8gb", monthlyCostUsd: 48 },
      // OVH VPS-3: 6 vCore / 12 GB / 100 GB SSD NVMe. NOTE: OVH delivers 12 GB
      // vs this tier's advertised 16 GB (vCPU matches at 6) — closest VPS tier.
      ovh: { code: "vps-2025-model3", monthlyCostUsd: 12.32 },
    },
  },
  // Dedicated CPU — OVH VPS is shared-CPU only, so no OVH mapping here.
  {
    serverConfigSlug: "dedicated-4g",
    codes: {
      linode: { code: "g6-dedicated-2", monthlyCostUsd: 36 },
      digitalocean: { code: "c-2", monthlyCostUsd: 42 },
    },
  },
  {
    serverConfigSlug: "dedicated-8g",
    codes: {
      linode: { code: "g6-dedicated-4", monthlyCostUsd: 72 },
      digitalocean: { code: "c-4", monthlyCostUsd: 84 },
    },
  },
  {
    serverConfigSlug: "dedicated-16g",
    codes: {
      linode: { code: "g6-dedicated-8", monthlyCostUsd: 144 },
      digitalocean: { code: "c-8", monthlyCostUsd: 168 },
    },
  },
  {
    serverConfigSlug: "dedicated-32g",
    codes: {
      linode: { code: "g6-dedicated-16", monthlyCostUsd: 288 },
      digitalocean: { code: "c-16", monthlyCostUsd: 336 },
    },
  },
] as const

type RegionCode = { code: string; available?: boolean }

export type ProviderRegionMapping = {
  /** Normalized region — must match a regions.slug. */
  regionSlug: string
  codes: Partial<Record<ProviderSlug, RegionCode>>
}

export const PROVIDER_REGION_MAP: readonly ProviderRegionMapping[] = [
  // OVH codes are VPS datacenter values (vps_datacenter), NOT Public Cloud region
  // ids. US datacenters (US-EAST-VA, US-WEST-OR) are the focus; other regions are
  // marked unavailable for OVH since OVH-US is the primary deployment target.
  {
    regionSlug: "us-east-1", // Newark
    codes: {
      linode: { code: "us-east" },
      digitalocean: { code: "nyc3" },
      ovh: { code: "US-EAST-VA" },
    },
  },
  {
    regionSlug: "us-west-1", // Fremont
    codes: {
      linode: { code: "us-west" },
      digitalocean: { code: "sfo3" },
      ovh: { code: "US-WEST-OR" },
    },
  },
  {
    regionSlug: "eu-central-1", // Frankfurt
    codes: {
      linode: { code: "eu-central" },
      digitalocean: { code: "fra1" },
      ovh: { code: "DE", available: false },
    },
  },
  {
    regionSlug: "eu-west-1", // London
    codes: {
      linode: { code: "eu-west" },
      digitalocean: { code: "lon1" },
      ovh: { code: "UK", available: false },
    },
  },
  {
    regionSlug: "ap-south-1", // Singapore
    codes: {
      linode: { code: "ap-south" },
      digitalocean: { code: "sgp1" },
      ovh: { code: "SGP", available: false },
    },
  },
  {
    regionSlug: "ap-northeast-1", // Tokyo — only Linode has a POP here.
    codes: {
      linode: { code: "ap-northeast" },
      digitalocean: { code: "sgp1", available: false },
      ovh: { code: "SGP", available: false },
    },
  },
] as const
