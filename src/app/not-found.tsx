import { auth } from "@/auth"
import { NotFound } from "@/components/ui/ghost-404-page"

export default async function NotFoundPage() {
  const session = await auth()
  return <NotFound isLoggedIn={Boolean(session?.user?.id)} />
}
