// Shared constants/helpers for uploaded white-label image assets.

export const ASSET_KINDS = ["logo", "logoMark", "favicon"] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export function isAssetKind(v: string): v is AssetKind {
  return (ASSET_KINDS as readonly string[]).includes(v)
}

// SVG is allowed but the serving route sandboxes it (CSP) so embedded scripts
// can't run even on direct navigation. Raster types are inert.
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])

/** Max upload size. Logos/favicons are small; this is generous but bounded. */
export const MAX_ASSET_BYTES = 512 * 1024 // 512 KB

/** The teamBranding URL-field value pointing at the served asset (cache-busted). */
export function assetUrl(teamId: string, kind: AssetKind, version: number): string {
  return `/api/branding-asset/${teamId}/${kind}?v=${version}`
}

/** Which teamBranding column a given asset kind populates. */
export const KIND_TO_FIELD: Record<AssetKind, "logoUrl" | "logoMarkUrl" | "faviconUrl"> = {
  logo: "logoUrl",
  logoMark: "logoMarkUrl",
  favicon: "faviconUrl",
}
