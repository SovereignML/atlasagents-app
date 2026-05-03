/** True when Google OAuth env vars are set (supports Auth.js `AUTH_GOOGLE_*` aliases). */
export function isGoogleOAuthConfigured(): boolean {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET
  return Boolean(id?.trim() && secret?.trim())
}
