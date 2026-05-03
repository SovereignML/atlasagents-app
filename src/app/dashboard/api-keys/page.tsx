import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { ApiKeysClient } from "./api-keys-client"

export default async function ApiKeysPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const keys = [
    {
      id: "ak_1",
      name: "Production",
      prefix: "sk_live_a1b2",
      created: "2026-03-12",
      lastUsed: "3 min ago",
      scopes: ["agents:read", "agents:write", "usage:read"],
    },
    {
      id: "ak_2",
      name: "CI / Staging",
      prefix: "sk_test_9f8e",
      created: "2026-02-28",
      lastUsed: "2 days ago",
      scopes: ["agents:read"],
    },
  ]

  return <ApiKeysClient initial={keys} />
}
