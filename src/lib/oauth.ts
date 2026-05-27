/**
 * Detect which OAuth providers have credentials configured via env.
 * Supports both the local `<PROVIDER>_CLIENT_ID/SECRET` form and Auth.js's
 * canonical `AUTH_<PROVIDER>_ID/SECRET` aliases so deployments can use either.
 */

function isProviderConfigured(idKeys: string[], secretKeys: string[]): boolean {
  const id = idKeys.map((k) => process.env[k]).find((v) => v?.trim())
  const secret = secretKeys.map((k) => process.env[k]).find((v) => v?.trim())
  return Boolean(id && secret)
}

export function isGoogleOAuthConfigured(): boolean {
  return isProviderConfigured(
    ["GOOGLE_CLIENT_ID", "AUTH_GOOGLE_ID"],
    ["GOOGLE_CLIENT_SECRET", "AUTH_GOOGLE_SECRET"],
  )
}

export function isTwitterOAuthConfigured(): boolean {
  return isProviderConfigured(
    ["TWITTER_CLIENT_ID", "AUTH_TWITTER_ID"],
    ["TWITTER_CLIENT_SECRET", "AUTH_TWITTER_SECRET"],
  )
}

export function isAppleOAuthConfigured(): boolean {
  return isProviderConfigured(
    ["APPLE_CLIENT_ID", "AUTH_APPLE_ID"],
    ["APPLE_CLIENT_SECRET", "AUTH_APPLE_SECRET"],
  )
}

export interface OAuthProviderFlags {
  google: boolean
  twitter: boolean
  apple: boolean
}

export function getConfiguredOAuthProviders(): OAuthProviderFlags {
  return {
    google: isGoogleOAuthConfigured(),
    twitter: isTwitterOAuthConfigured(),
    apple: isAppleOAuthConfigured(),
  }
}
