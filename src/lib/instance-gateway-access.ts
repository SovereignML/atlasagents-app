/**
 * Public gateway URL and OpenClaw CORS origins for VPS instances
 * (custom domain, Cloudflare managed hostname, or raw IP).
 */

export type PublicGatewayInput = {
  domain?: string | null
  managedSubdomain?: string | null
  tlsStatus?: string | null
  ipAddress?: string | null
}

export function buildPublicGatewayUrl(i: PublicGatewayInput): {
  url: string
  scheme: "https" | "http"
} | null {
  const domain = i.domain?.trim()
  if (domain) {
    const scheme = i.tlsStatus === "issued" ? "https" : "http"
    return { url: `${scheme}://${domain}`, scheme }
  }
  const managed = i.managedSubdomain?.trim()
  if (managed) {
    return { url: `https://${managed}`, scheme: "https" }
  }
  const ip = i.ipAddress?.trim()
  if (ip) {
    return { url: `http://${ip}`, scheme: "http" }
  }
  return null
}

export type AllowedOriginsInput = {
  domain?: string | null
  managedSubdomain?: string | null
  ipAddress?: string | null
  /** When set with domain, http://domain is included until LE issues. */
  tlsStatus?: string | null
}

export function buildGatewayAllowedOrigins(i: AllowedOriginsInput): string[] {
  const ip = i.ipAddress?.trim()
  const domain = i.domain?.trim()
  const managed = i.managedSubdomain?.trim()
  const out: string[] = []
  if (ip) out.push(`http://${ip}`)
  if (managed) {
    out.push(`https://${managed}`)
    out.push(`http://${managed}`)
  }
  if (domain) {
    out.push(`https://${domain}`)
    if (i.tlsStatus !== "issued") {
      out.push(`http://${domain}`)
    }
  }
  return [...new Set(out)]
}
