import { Resend } from "resend"
import { BRANDING } from "@/configs/branding"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@sovereignml.com"
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

export async function sendTeamInviteEmail(args: {
  email: string
  token: string
  teamName: string
  inviterName: string
  role: string
}) {
  const acceptUrl = `${appUrl}/team/accept?token=${args.token}`

  if (!resend) {
    console.warn("RESEND_API_KEY not set — invite email not sent for:", args.email)
    return { success: false, error: "Email not configured", acceptUrl }
  }

  try {
    await resend.emails.send({
      from: fromEmail,
      to: args.email,
      subject: `${args.inviterName} invited you to ${args.teamName} on SovereignML`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #CCFF00; background: #030303; padding: 20px; text-align: center; font-family: monospace; letter-spacing: 0.05em;">SOVEREIGNML</h2>
          <p>${args.inviterName} invited you to join <strong>${args.teamName}</strong> as <strong>${args.role}</strong>.</p>
          <a href="${acceptUrl}" style="display: inline-block; background: #CCFF00; color: #000; padding: 12px 24px; text-decoration: none; font-weight: 700; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em;">Accept Invite</a>
          <p style="color: #666; font-size: 13px; margin-top: 16px;">This link expires in 7 days. If you weren't expecting this invite, ignore this email.</p>
        </div>
      `,
    })
    return { success: true, acceptUrl }
  } catch (error) {
    console.error("Failed to send invite email:", error)
    return { success: false, error, acceptUrl }
  }
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = `${appUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`

  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping email send")
    return { success: false, error: "Email not configured" }
  }

  try {
    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Reset your SovereignML password",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #CCFF00; background: #030303; padding: 20px; text-align: center; font-family: monospace; letter-spacing: 0.05em;">SOVEREIGNML</h2>
          <p>You requested a password reset. Click the button below to set a new password:</p>
          <a href="${resetUrl}" style="display: inline-block; background: #CCFF00; color: #000; padding: 12px 24px; text-decoration: none; font-weight: 700; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em;">Reset Password</a>
          <p style="color: #666; font-size: 13px; margin-top: 16px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      `,
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send password reset email:", error)
    return { success: false, error }
  }
}

/**
 * Generic transactional notification email. Used by the multi-channel
 * notification dispatcher (src/lib/notifications) for the "email" channel.
 * Shares the SovereignML branded style of the other templates here.
 */
export async function sendNotificationEmail(args: {
  to: string
  title: string
  message: string
  url?: string
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — notification email not sent:", args.title)
    return { success: false, error: "Email not configured" }
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  const button = args.url
    ? `<a href="${args.url}" style="display: inline-block; background: #CCFF00; color: #000; padding: 12px 24px; text-decoration: none; font-weight: 700; font-family: monospace; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 8px;">View Details</a>`
    : ""

  try {
    await resend.emails.send({
      from: fromEmail,
      to: args.to,
      subject: args.title,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #CCFF00; background: #030303; padding: 20px; text-align: center; font-family: monospace; letter-spacing: 0.05em;">SOVEREIGNML</h2>
          <p style="font-weight: 700; font-size: 16px; margin: 0 0 8px;">${esc(args.title)}</p>
          <p style="white-space: pre-wrap; line-height: 1.5; color: #333;">${esc(args.message)}</p>
          ${button}
          <p style="color: #666; font-size: 13px; margin-top: 24px;">You can change which notifications reach your inbox in your <a href="${appUrl}/dashboard/account">account settings</a>.</p>
        </div>
      `,
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send notification email:", error)
    return { success: false, error }
  }
}

/**
 * Fallback delivery for a support ticket — used only when the Chatwoot API is
 * unconfigured or its call fails, so a request is never silently dropped. Sends
 * to BRANDING.supportEmail with reply-to set to the requesting user.
 */
export async function sendSupportTicketEmail(args: {
  fromName: string
  fromEmail: string
  subject: string
  message: string
  category: string
  priority: string
}) {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — support ticket email not sent:", args.subject)
    return { success: false, error: "Email not configured" }
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

  try {
    await resend.emails.send({
      from: fromEmail,
      to: BRANDING.supportEmail,
      replyTo: args.fromEmail,
      subject: `[Support · ${args.priority}] ${args.subject}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #CCFF00; background: #030303; padding: 20px; text-align: center; font-family: monospace; letter-spacing: 0.05em;">SOVEREIGNML</h2>
          <p style="color: #666; font-size: 13px; margin: 0 0 4px;">New support ticket</p>
          <p style="margin: 0 0 16px;"><strong>${esc(args.fromName)}</strong> &lt;${esc(args.fromEmail)}&gt; · ${esc(args.category)} · ${esc(args.priority)}</p>
          <p style="margin: 0 0 4px; font-weight: 700;">${esc(args.subject)}</p>
          <p style="white-space: pre-wrap; line-height: 1.5;">${esc(args.message)}</p>
        </div>
      `,
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send support ticket email:", error)
    return { success: false, error }
  }
}
