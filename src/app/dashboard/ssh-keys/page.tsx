import { redirect } from "next/navigation"
import { KeyRound } from "lucide-react"

import { auth } from "@/auth"
import { db, eq, desc, sshKeys } from "@/db"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { PageContainer, PageHeader } from "@/components/layout/page-container"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export default async function SshKeysPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const keys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, session.user.id),
    orderBy: desc(sshKeys.createdAt),
  })

  return (
    <PageContainer>
      <PageHeader
        title="SSH Keys"
        description="Manage SSH keys for your deployments"
      />

      {keys.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRound />
                </EmptyMedia>
                <EmptyTitle>No SSH keys yet</EmptyTitle>
                <EmptyDescription>
                  Keys are automatically added when you deploy with an SSH key.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {key.fingerprint}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {key.createdAt.toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageContainer>
  )
}
