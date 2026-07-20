import { redirect } from "next/navigation"

// Branding now lives under the Team page as a tab (the canonical home).
// This route is kept as a redirect so existing links/bookmarks keep working.
export default function BrandingSettingsPage() {
  redirect("/dashboard/team?tab=branding")
}
