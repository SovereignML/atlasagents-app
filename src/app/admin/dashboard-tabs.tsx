"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Client tab shell for the admin dashboard. The two panels are server-rendered
 * and passed in as nodes so all data-fetching stays on the server — this
 * component only owns the active-tab state.
 */
export function DashboardTabs({
  fleet,
  accounts,
}: {
  fleet: React.ReactNode
  accounts: React.ReactNode
}) {
  return (
    <Tabs defaultValue="fleet" className="w-full">
      <TabsList variant="line">
        <TabsTrigger value="fleet">Fleet &amp; Ops</TabsTrigger>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
      </TabsList>
      <TabsContent value="fleet" className="space-y-6 pt-5">
        {fleet}
      </TabsContent>
      <TabsContent value="accounts" className="space-y-6 pt-5">
        {accounts}
      </TabsContent>
    </Tabs>
  )
}
