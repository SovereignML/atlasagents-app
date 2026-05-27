// Backwards-compatible re-export. New code should import from `@/lib/oauth`.
export {
  isGoogleOAuthConfigured,
  isTwitterOAuthConfigured,
  isAppleOAuthConfigured,
  getConfiguredOAuthProviders,
} from "./oauth"
