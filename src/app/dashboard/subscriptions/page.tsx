import { redirect } from "next/navigation"

// Subscriptions are now part of the unified credit-oriented billing page.
// Keep this route alive to avoid breaking bookmarks and old links.
export default function SubscriptionsLegacyRedirect() {
  redirect("/dashboard/billing")
}
