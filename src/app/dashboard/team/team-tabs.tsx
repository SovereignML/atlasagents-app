"use client"

import { useRouter } from "next/navigation"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { TeamRole } from "@/lib/team"
import { TeamClient } from "./team-client"
import {
  TeamBackupsTab,
  TeamIntegrationsTab,
  TeamSshTab,
  type DriveInfo,
  type CloudflareInfo,
  type TeamBackup,
  type TeamSshKey,
} from "./team-provider-tabs"
import { BrandingClient, type BrandingState } from "../settings/branding/branding-client"
import { TeamDangerTab, type TeamDangerInfo } from "./team-danger-tab"

type Member = { userId: string; role: TeamRole; name: string | null; email: string }
type Invite = { id: string; email: string; role: TeamRole; expiresAt: string }
type TeamInfo = { teamId: string; name: string; role: TeamRole }

export type TeamTabsProps = {
  active: string
  canManage: boolean
  team: { id: string; name: string; seatLimit: number; planLabel: string }
  myRole: TeamRole
  members: Member[]
  invites: Invite[]
  allTeams: TeamInfo[]
  activeTeamId: string
  drive: DriveInfo
  backups: TeamBackup[]
  cloudflare: CloudflareInfo
  sshKeys: TeamSshKey[]
  /** Branding tab data — null when the team isn't white-label entitled. */
  branding: BrandingState | null
  /** Danger Zone gating — non-null only for the team owner. */
  danger: TeamDangerInfo | null
}

const BASE_TABS = [
  { id: "members", label: "Members" },
  { id: "backups", label: "Backup Providers" },
  { id: "integrations", label: "Integrations" },
  { id: "ssh", label: "SSH Keys" },
] as const

export function TeamTabs(props: TeamTabsProps) {
  const router = useRouter()
  const tabs = [
    ...BASE_TABS,
    ...(props.branding ? [{ id: "branding", label: "Branding" }] : []),
    ...(props.danger ? [{ id: "danger", label: "Danger Zone" }] : []),
  ]
  const active = tabs.some((t) => t.id === props.active) ? props.active : "members"

  function goTab(id: string) {
    router.push(`/dashboard/team?tab=${id}`)
  }

  return (
    <Tabs value={active} onValueChange={goTab} className="space-y-8">
      <TabsList className="w-fit">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="members" className="mt-0">
        <TeamClient
          embedded
          team={props.team}
          myRole={props.myRole}
          members={props.members}
          invites={props.invites}
          allTeams={props.allTeams}
          activeTeamId={props.activeTeamId}
        />
      </TabsContent>

      <TabsContent value="backups" className="mt-0">
        <TeamBackupsTab drive={props.drive} backups={props.backups} canManage={props.canManage} />
      </TabsContent>

      <TabsContent value="integrations" className="mt-0">
        <TeamIntegrationsTab cloudflare={props.cloudflare} canManage={props.canManage} />
      </TabsContent>

      <TabsContent value="ssh" className="mt-0">
        <TeamSshTab keys={props.sshKeys} canManage={props.canManage} />
      </TabsContent>

      {props.branding && (
        <TabsContent value="branding" className="mt-0">
          <BrandingClient initial={props.branding} />
        </TabsContent>
      )}

      {props.danger && (
        <TabsContent value="danger" className="mt-0">
          <TeamDangerTab team={props.team} info={props.danger} />
        </TabsContent>
      )}
    </Tabs>
  )
}
