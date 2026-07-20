import { db, regions, routingLogs, asc, desc } from "@/db"
import { getProvidersOverview } from "@/lib/provider-admin"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import { ProvidersClient } from "./providers-client"

export const dynamic = "force-dynamic"

export default async function AdminProvidersPage() {
  const [overview, regionRows, logs] = await Promise.all([
    getProvidersOverview(),
    db.query.regions.findMany({ orderBy: [asc(regions.sortOrder)] }),
    db.select().from(routingLogs).orderBy(desc(routingLogs.createdAt)).limit(50),
  ])

  const regionOptions = regionRows
    .filter((r) => r.slug !== "self-hosted")
    .map((r) => ({ id: r.id, label: `${r.flag} ${r.name}`, slug: r.slug }))

  const providerNames = Object.fromEntries(overview.map((p) => [p.id, p.name]))

  return (
    <PageContainer>
      <PageHeader
        title="Admin · Providers"
        description="Multi-provider VPS router. Toggle providers, set internal budgets, pin regions, and review routing decisions. Provider selection is automatic. These controls override it."
      />
      <ProvidersClient
        providers={overview}
        regions={regionOptions}
        logs={logs}
        providerNames={providerNames}
      />
    </PageContainer>
  )
}
