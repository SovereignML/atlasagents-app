import Link from "next/link"
import { Ban } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function BannedPage() {
  return (
    <Card className="w-full">
      <CardHeader className="items-center text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-destructive/20 bg-destructive/10">
          <Ban className="size-8 text-destructive" />
        </div>
        <CardTitle className="text-2xl font-bold">Account Suspended</CardTitle>
        <CardDescription className="text-balance">
          Your account has been suspended. If you believe this is a mistake, please contact our
          support team for assistance.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          <Button
            variant="gradient"
            size="pill"
            className="w-full"
            render={<Link href="/community" />}
          >
            Contact Support
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            render={<Link href="/" />}
          >
            Back to Home
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
