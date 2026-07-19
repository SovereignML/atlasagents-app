// Deployment regions. Edit this list to add/remove locations across the app.
// The seed script writes these into the Region table so FKs work,
// but the wizard reads directly from this typed array.
// providerRegion must match the active VM provider's region slugs.

export type RegionConfig = {
  slug: string
  name: string
  country: string
  flag: string
  available: boolean
  sortOrder: number
  providerRegion: string
}

export const REGIONS: readonly RegionConfig[] = [
  // SINGLE-LOCATION BASELINE: the warm pool warms exactly one location
  // (`linode | g6-standard-2 | eu-central`), so Frankfurt is the ONLY available
  // managed region — it must be the first available by sortOrder so it is picked
  // as the default region for every deploy (the wizard sends no regionSlug). The
  // other locations stay in the catalog (disabled) for FKs / future expansion.
  // To move the baseline elsewhere, enable a different region here AND repoint the
  // pool (POOL_REGION_CODE) to that region's Linode code, or claims will miss.
  {
    slug: "eu-central-1",
    name: "Frankfurt",
    country: "Germany",
    flag: "\u{1F1E9}\u{1F1EA}",
    available: true,
    sortOrder: 10,
    providerRegion: "fra1",
  },
  {
    slug: "us-east-1",
    name: "Newark",
    country: "United States (East)",
    flag: "\u{1F1FA}\u{1F1F8}",
    available: false,
    sortOrder: 20,
    providerRegion: "us-east",
  },
  {
    slug: "us-west-1",
    name: "Fremont",
    country: "United States (West)",
    flag: "\u{1F1FA}\u{1F1F8}",
    available: false,
    sortOrder: 30,
    providerRegion: "us-west",
  },
  {
    slug: "eu-west-1",
    name: "London",
    country: "United Kingdom",
    flag: "\u{1F1EC}\u{1F1E7}",
    available: false,
    sortOrder: 40,
    providerRegion: "eu-west",
  },
  {
    slug: "ap-south-1",
    name: "Singapore",
    country: "Singapore",
    flag: "\u{1F1F8}\u{1F1EC}",
    available: false,
    sortOrder: 50,
    providerRegion: "ap-south",
  },
  {
    slug: "ap-northeast-1",
    name: "Tokyo",
    country: "Japan",
    flag: "\u{1F1EF}\u{1F1F5}",
    available: false,
    sortOrder: 60,
    providerRegion: "ap-northeast",
  },
] as const
