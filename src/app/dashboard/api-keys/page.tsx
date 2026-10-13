import { notFound } from "next/navigation"

/**
 * Hidden until real API tokens exist. The page used to list hardcoded keys and
 * "create" new ones in the browser with Math.random: they looked like live
 * `sk_live_` secrets and authenticated nothing. Hashed, per-user API tokens are
 * the same work as the mobile app's bearer-token API; build the page on that.
 */
export default function ApiKeysPage() {
  notFound()
}
