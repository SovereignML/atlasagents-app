import { sendNotificationEmail } from "@/lib/email"

// Email channel: thin wrapper over the shared Resend client in src/lib/email.ts.
export async function deliverEmail(params: {
  to: string
  title: string
  message: string
  url?: string
}) {
  await sendNotificationEmail(params)
}
