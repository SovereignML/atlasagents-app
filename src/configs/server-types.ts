// Server type catalog. Display tiers mapped to provider plans for provisioning.
// Categories: Shared (shared vCPU), Dedicated (dedicated vCPU).
// Edit here to update pricing across the deploy wizard, landing page, and seed.

export type ServerCategory = "Shared" | "Dedicated"

export type ServerTypeConfig = {
  slug: string
  category: ServerCategory
  label: string
  vcpu: number
  ramGb: number
  storageGb: number
  priceMonthly: number
  priceYearly: number
  sortOrder: number
  isActive: boolean
  providerPlan: string
}

export const SERVER_CATEGORIES: ReadonlyArray<{
  category: ServerCategory
  title: string
  description: string
}> = [
  {
    category: "Shared",
    title: "Shared CPU",
    description: "Cost-effective shared vCPU instances for development, staging, and moderate workloads.",
  },
  {
    category: "Dedicated",
    title: "Dedicated CPU",
    description: "Dedicated vCPU cores with no resource contention for production-critical AI agents.",
  },
] as const

export const SERVER_TYPES: readonly ServerTypeConfig[] = [
  // Shared CPU (Linode Shared)
  { slug: "shared-1g",  category: "Shared",    label: "Nanode 1GB",  vcpu: 1, ramGb: 1,  storageGb: 25,  priceMonthly: 5,   priceYearly: 50,   sortOrder: 10, isActive: true, providerPlan: "g6-nanode-1" },
  { slug: "shared-2g",  category: "Shared",    label: "Linode 2GB",  vcpu: 1, ramGb: 2,  storageGb: 50,  priceMonthly: 12,  priceYearly: 120,  sortOrder: 20, isActive: true, providerPlan: "g6-standard-1" },
  { slug: "shared-4g",  category: "Shared",    label: "Linode 4GB",  vcpu: 2, ramGb: 4,  storageGb: 80,  priceMonthly: 24,  priceYearly: 240,  sortOrder: 30, isActive: true, providerPlan: "g6-standard-2" },
  { slug: "shared-8g",  category: "Shared",    label: "Linode 8GB",  vcpu: 4, ramGb: 8,  storageGb: 160, priceMonthly: 48,  priceYearly: 480,  sortOrder: 40, isActive: true, providerPlan: "g6-standard-4" },
  { slug: "shared-16g", category: "Shared",    label: "Linode 16GB", vcpu: 6, ramGb: 16, storageGb: 320, priceMonthly: 96,  priceYearly: 960,  sortOrder: 50, isActive: true, providerPlan: "g6-standard-6" },

  // Dedicated CPU
  { slug: "dedicated-4g",  category: "Dedicated", label: "Dedicated 4GB",  vcpu: 2,  ramGb: 4,  storageGb: 80,  priceMonthly: 36,  priceYearly: 360,  sortOrder: 10, isActive: true, providerPlan: "g6-dedicated-2" },
  { slug: "dedicated-8g",  category: "Dedicated", label: "Dedicated 8GB",  vcpu: 4,  ramGb: 8,  storageGb: 160, priceMonthly: 72,  priceYearly: 720,  sortOrder: 20, isActive: true, providerPlan: "g6-dedicated-4" },
  { slug: "dedicated-16g", category: "Dedicated", label: "Dedicated 16GB", vcpu: 8,  ramGb: 16, storageGb: 320, priceMonthly: 144, priceYearly: 1440, sortOrder: 30, isActive: true, providerPlan: "g6-dedicated-8" },
  { slug: "dedicated-32g", category: "Dedicated", label: "Dedicated 32GB", vcpu: 16, ramGb: 32, storageGb: 640, priceMonthly: 288, priceYearly: 2880, sortOrder: 40, isActive: true, providerPlan: "g6-dedicated-16" },
] as const

// Storage volume add-on, charged per-GB-month.
export const STORAGE_PRICE_PER_GB_MONTH = 0.05

// Yearly multiplier — applied to monthly base when billing yearly.
// Yearly already includes ~2 months free in priceYearly, so this is just a marker.
export const YEARLY_DISCOUNT_PERCENT = 17 // ~2 months free

// Storage slider bounds for the deploy wizard.
export const STORAGE_MIN_GB = 0
export const STORAGE_MAX_GB = 1000
export const STORAGE_STEP_GB = 50
