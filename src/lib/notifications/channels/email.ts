import { sendNotificationEmail } from "@/lib/email"

// Email channel: thin wrapper over the shared Resend client in src/lib/email.ts.
// Throws when the email wasn't sent, so the dispatcher counts it as failed.
export async function deliverEmail(params: {
  to: string
  title: string
  message: string
  url?: string
}) {
  const result = await sendNotificationEmail(params)
  if (!result.success) {
    throw result.error instanceof Error ? result.error : new Error(String(result.error))
  }
}
