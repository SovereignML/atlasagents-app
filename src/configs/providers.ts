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
  defaultPriority: number
  /** Seed values for provider_billing (USD). Internal-budget model. */
  budget: {
    monthlyCreditsUsd: number
    softLimitUsd: number
    hardLimitUsd: number
  }
}

export const PROVIDERS: readonly ProviderDef[] = [
  {
    slug: "linode",
    name: "Linode",
    credentialEnvKey: "LINODE_API_TOKEN",
    defaultPriority: 10,
    budget: { monthlyCreditsUsd: 5000, softLimitUsd: 4000, hardLimitUsd: 5000 },
  },
  {
    slug: "digitalocean",
    name: "DigitalOcean",
    credentialEnvKey: "DIGITALOCEAN_API_TOKEN",
    defaultPriority: 5,
    budget: { monthlyCreditsUsd: 3000, softLimitUsd: 2400, hardLimitUsd: 3000 },
  },
  {
    slug: "ovh",
    name: "OVHcloud",
    credentialEnvKey: "OVH_APP_KEY",
    defaultPriority: 0,
    budget: { monthlyCreditsUsd: 2000, softLimitUsd: 1600, hardLimitUsd: 2000 },
  },
] as const

type PlanCode = { code: string; monthlyCostUsd: number }

export type ProviderPlanMapping = {
  /** Normalized tier — must match a serverConfigs.slug. */
  serverConfigSlug: string
  codes: Partial<Record<ProviderSlug, PlanCode>>
}

// For OVH, `code` is the flavor NAME (e.g. "d2-4"); the adapter resolves it to a
// region-specific flavor id at create time. Linode/DO use the code verbatim.
export const PROVIDER_PLAN_MAP: readonly ProviderPlanMapping[] = [
  // Shared CPU
  {
    serverConfigSlug: "shared-1g",
    codes: {
      linode: { code: "g6-nanode-1", monthlyCostUsd: 5 },
      digitalocean: { code: "s-1vcpu-1gb", monthlyCostUsd: 6 },
      ovh: { code: "d2-2", monthlyCostUsd: 11 },
    },
  },
  {
    serverConfigSlug: "shared-2g",
    codes: {
      linode: { code: "g6-standard-1", monthlyCostUsd: 12 },
      digitalocean: { code: "s-1vcpu-2gb", monthlyCostUsd: 12 },
      ovh: { code: "d2-2", monthlyCostUsd: 11 },
    },
  },
  {
    serverConfigSlug: "shared-4g",
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
      ovh: { code: "d2-4", monthlyCostUsd: 22 },
    },
  },
  {
    serverConfigSlug: "shared-8g",
    codes: {
      linode: { code: "g6-standard-4", monthlyCostUsd: 48 },
      digitalocean: { code: "s-4vcpu-8gb", monthlyCostUsd: 48 },
      ovh: { code: "d2-8", monthlyCostUsd: 44 },
    },
  },
  {
    serverConfigSlug: "shared-16g",
    codes: {
      linode: { code: "g6-standard-6", monthlyCostUsd: 96 },
      digitalocean: { code: "s-8vcpu-16gb", monthlyCostUsd: 96 },
      ovh: { code: "b2-15", monthlyCostUsd: 66 },
    },
  },
  // Dedicated CPU
  {
    serverConfigSlug: "dedicated-4g",
    codes: {
      linode: { code: "g6-dedicated-2", monthlyCostUsd: 36 },
      digitalocean: { code: "c-2", monthlyCostUsd: 42 },
      ovh: { code: "c2-7", monthlyCostUsd: 55 },
    },
  },
  {
    serverConfigSlug: "dedicated-8g",
    codes: {
      linode: { code: "g6-dedicated-4", monthlyCostUsd: 72 },
      digitalocean: { code: "c-4", monthlyCostUsd: 84 },
      ovh: { code: "c2-15", monthlyCostUsd: 110 },
    },
  },
  {
    serverConfigSlug: "dedicated-16g",
    codes: {
      linode: { code: "g6-dedicated-8", monthlyCostUsd: 144 },
      digitalocean: { code: "c-8", monthlyCostUsd: 168 },
      ovh: { code: "c2-30", monthlyCostUsd: 220 },
    },
  },
  {
    serverConfigSlug: "dedicated-32g",
    codes: {
      linode: { code: "g6-dedicated-16", monthlyCostUsd: 288 },
      digitalocean: { code: "c-16", monthlyCostUsd: 336 },
      ovh: { code: "c2-60", monthlyCostUsd: 440 },
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
  {
    regionSlug: "us-east-1", // Newark
    codes: {
      linode: { code: "us-east" },
      digitalocean: { code: "nyc3" },
      ovh: { code: "US-EAST-VA-1" },
    },
  },
  {
    regionSlug: "us-west-1", // Fremont
    codes: {
      linode: { code: "us-west" },
      digitalocean: { code: "sfo3" },
      ovh: { code: "US-WEST-OR-1" },
    },
  },
  {
    regionSlug: "eu-central-1", // Frankfurt
    codes: {
      linode: { code: "eu-central" },
      digitalocean: { code: "fra1" },
      ovh: { code: "DE" },
    },
  },
  {
    regionSlug: "eu-west-1", // London
    codes: {
      linode: { code: "eu-west" },
      digitalocean: { code: "lon1" },
      ovh: { code: "UK" },
    },
  },
  {
    regionSlug: "ap-south-1", // Singapore
    codes: {
      linode: { code: "ap-south" },
      digitalocean: { code: "sgp1" },
      ovh: { code: "SGP" },
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
