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

export type ProviderSlug = "linode" | "digitalocean"

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
   * DigitalOcean is the primary/active provider; Akamai (linode) stays enabled as
   * failover. NOTE: enabling Akamai requires LINODE_API_TOKEN to be set, or
   * provisioning to it will fail.
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
    // Akamai Connected Cloud (formerly Linode). The `linode` slug is the
    // provider adapter id and must stay "linode"; only the display name is Akamai.
    // PRIMARY provider: the warm pool is baked on Linode Frankfurt, so Linode is
    // ranked highest and every managed deploy claims a Linode pool VM.
    slug: "linode",
    name: "Akamai",
    credentialEnvKey: "LINODE_API_TOKEN",
    defaultPriority: 100,
    enabled: true,
    budget: { monthlyCreditsUsd: 5000, softLimitUsd: 4000, hardLimitUsd: 5000 },
  },
  {
    // Failover — ranked below Linode (100) so the router prefers Linode by
    // default. Kept enabled + pinned to Frankfurt so a cold fallback (pool dry
    // or Linode unhealthy) still lands in the same region.
    slug: "digitalocean",
    name: "DigitalOcean",
    credentialEnvKey: "DIGITALOCEAN_API_TOKEN",
    defaultPriority: 90,
    enabled: true,
    budget: { monthlyCreditsUsd: 3000, softLimitUsd: 2400, hardLimitUsd: 3000 },
  },
] as const

type PlanCode = { code: string; monthlyCostUsd: number }

export type ProviderPlanMapping = {
  /** Normalized tier — must match a serverConfigs.slug. */
  serverConfigSlug: string
  codes: Partial<Record<ProviderSlug, PlanCode>>
}

// Linode/DO use the provider plan `code` verbatim. monthlyCostUsd values are the
// provider's list prices (our cost), not the customer-facing price (that lives in
// src/configs/server-types.ts).
export const PROVIDER_PLAN_MAP: readonly ProviderPlanMapping[] = [
  // Shared CPU
  // SINGLE-SERVER BASELINE: every self-serve managed-VPS tier provisions the
  // SAME physical box — Linode g6-standard-2 (2 vCPU / 4GB) in Frankfurt — so the
  // warm pool (which warms exactly `linode | g6-standard-2 | eu-central`) serves
  // every deploy. The customer-facing tier specs in server-types.ts and the
  // credit allotment in plans.ts differ, but the ONLY runtime difference between
  // tiers is the OpenRouter key's spend cap (derived from the wallet balance).
  // Every shared tier therefore collapses to the same Linode code. Do NOT diverge
  // these Linode codes without also re-pointing the pool (POOL_PLAN_CODE) or
  // claims will miss and fall back to the cold path. DigitalOcean stays as a
  // Frankfurt failover, also collapsed to one box (s-2vcpu-4gb).
  {
    serverConfigSlug: "shared-1g",
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
    },
  },
  {
    serverConfigSlug: "shared-2g",
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
    },
  },
  {
    serverConfigSlug: "shared-4g", // baseline box for all self-serve plans
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
    },
  },
  {
    serverConfigSlug: "shared-8g",
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
    },
  },
  {
    serverConfigSlug: "shared-16g",
    codes: {
      linode: { code: "g6-standard-2", monthlyCostUsd: 24 },
      digitalocean: { code: "s-2vcpu-4gb", monthlyCostUsd: 24 },
    },
  },
  // Dedicated CPU
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
  {
    regionSlug: "us-east-1", // Newark
    codes: {
      linode: { code: "us-east" },
      digitalocean: { code: "nyc3" },
    },
  },
  {
    regionSlug: "us-west-1", // Fremont
    codes: {
      linode: { code: "us-west" },
      digitalocean: { code: "sfo3" },
    },
  },
  {
    regionSlug: "eu-central-1", // Frankfurt
    codes: {
      linode: { code: "eu-central" },
      digitalocean: { code: "fra1" },
    },
  },
  {
    regionSlug: "eu-west-1", // London
    codes: {
      linode: { code: "eu-west" },
      digitalocean: { code: "lon1" },
    },
  },
  {
    regionSlug: "ap-south-1", // Singapore
    codes: {
      linode: { code: "ap-south" },
      digitalocean: { code: "sgp1" },
    },
  },
  {
    regionSlug: "ap-northeast-1", // Tokyo — only Linode has a POP here.
    codes: {
      linode: { code: "ap-northeast" },
      digitalocean: { code: "sgp1", available: false },
    },
  },
] as const
