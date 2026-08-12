"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Client tab shell for the admin dashboard. Every panel is server-rendered and
 * passed in as a node so all data-fetching stays on the server — this component
 * only owns the active-tab state.
 *
 * Overview leads because it answers "is the business growing, and is the fleet
 * alive"; the other three are drill-downs from it.
 */
export function DashboardTabs({
  overview,
  fleet,
  accounts,
  security,
}: {
  overview: React.ReactNode
  fleet: React.ReactNode
  accounts: React.ReactNode
  security: React.ReactNode
}) {
  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="fleet">Fleet &amp; Ops</TabsTrigger>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="space-y-6 pt-5">
        {overview}
      </TabsContent>
      <TabsContent value="fleet" className="space-y-6 pt-5">
        {fleet}
      </TabsContent>
      <TabsContent value="accounts" className="space-y-6 pt-5">
        {accounts}
      </TabsContent>
      <TabsContent value="security" className="space-y-6 pt-5">
        {security}
      </TabsContent>
    </Tabs>
  )
}
