// Provider factory + registry for the multi-provider VPS router.
//
// The legacy env-driven getVmProvider() (src/lib/vm-provider.ts) is retained for
// shared-cluster paths. The VPS path resolves a concrete provider by slug (from
// a routing decision) or by id (the owning provider stored on an instance).

import { db, providers, eq } from "@/db"
import type { VpsProvider } from "@/lib/vm-provider"
import { LinodeProvider } from "@/lib/linode"
import { DigitalOceanProvider, describeDoError } from "@/lib/providers/digitalocean"

export type ProviderSlug = "linode" | "digitalocean"

/** Construct an adapter from a slug. Throws on unknown slug. */
export function instantiateProvider(slug: string): VpsProvider {
  switch (slug) {
    case "linode":
      return new LinodeProvider()
    case "digitalocean":
      return new DigitalOceanProvider()
    default:
      throw new Error(`Unknown provider slug: ${slug}`)
  }
}

export async function getVmProviderBySlug(slug: string): Promise<VpsProvider> {
  return instantiateProvider(slug)
}

/** The env-default provider used when an instance has no owning provider row. */
function defaultProvider(): VpsProvider {
  return instantiateProvider(process.env.VM_PROVIDER ?? "digitalocean")
}

/**
 * Resolve the provider that owns an instance's VM. Falls back to the env-default
 * provider (VM_PROVIDER, DigitalOcean by default) when `providerId` is null
 * (legacy/shared/byos rows predating multi-provider) or the row can't be found.
 * Real multi-provider instances always carry a non-null providerId, so they
 * resolve to their actual owner regardless of the default.
 */
export async function getVmProviderById(providerId: string | null | undefined): Promise<VpsProvider> {
  if (!providerId) return defaultProvider()
  const row = await db.query.providers.findFirst({
    where: eq(providers.id, providerId),
    columns: { slug: true },
  })
  if (!row) {
    console.warn(`[providers] providerId ${providerId} not found — falling back to default provider`)
    return defaultProvider()
  }
  return instantiateProvider(row.slug)
}

export type EnabledProvider = {
  providerId: string
  slug: string
  name: string
  provider: VpsProvider
}

/** All enabled providers, instantiated. Used by the health sweep + reconciler orphan pass. */
export async function getAllEnabledProviders(): Promise<EnabledProvider[]> {
  const rows = await db.query.providers.findMany({
    where: eq(providers.enabled, true),
  })
  return rows.map((r) => ({
    providerId: r.id,
    slug: r.slug,
    name: r.name,
    provider: instantiateProvider(r.slug),
  }))
}

/** Provider-aware error sanitizer — strips tokens/signatures from log lines. */
export async function describeProviderError(slug: string, err: unknown): Promise<string> {
  switch (slug) {
    case "digitalocean":
      return describeDoError(err)
    case "linode":
    default: {
      const { describeLinodeError } = await import("@/lib/linode")
      return describeLinodeError(err)
    }
  }
}
