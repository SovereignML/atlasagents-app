import { redirect } from "next/navigation"

// SSH keys are now team-shared and managed under the Team page's SSH Keys tab.
// This route redirects so existing links/bookmarks keep working.
export default function SshKeysPage() {
  redirect("/dashboard/team?tab=ssh")
}
