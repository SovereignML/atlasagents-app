import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { db, eq, desc, wallets, walletTransactions } from "@/db"

/**
 * GET /api/billing/statement
 *
 * Downloads the signed-in user's full credit ledger as CSV — a plain-text
 * statement they can keep or hand to accounting. Stripe receipts for the
 * underlying payments live in the billing portal; this is the credit side.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const wallet = await db.query.wallets.findFirst({
    where: eq(wallets.userId, session.user.id),
    columns: { id: true },
  })
  if (!wallet) {
    // No wallet yet → an empty statement (header only), not an error.
    return csv("date,type,description,instance,credits,balance_after\n")
  }

  const rows = await db.query.walletTransactions.findMany({
    where: eq(walletTransactions.walletId, wallet.id),
    orderBy: desc(walletTransactions.createdAt),
    with: { instance: { columns: { name: true } } },
  })

  const header = "date,type,description,instance,credits,balance_after"
  const lines = rows.map((tx) =>
    [
      tx.createdAt.toISOString(),
      tx.type,
      csvCell(tx.description ?? ""),
      csvCell(tx.instance?.name ?? ""),
      Math.round(tx.amount),
      Math.round(tx.balanceAfter),
    ].join(","),
  )
  return csv([header, ...lines].join("\n") + "\n")
}

/** Quote a CSV cell if it contains a comma, quote, or newline (RFC 4180). */
function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csv(body: string): NextResponse {
  const filename = `credit-statement-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
