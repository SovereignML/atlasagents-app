import { redirect } from "next/navigation"

// White-label branding now lives in the Reseller Admin Panel
// (/tenant-admin/settings, the canonical home). This route is kept as a
// redirect so existing links/bookmarks keep working.
export default function BrandingSettingsPage() {
  redirect("/tenant-admin/settings")
}
