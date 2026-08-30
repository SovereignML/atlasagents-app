import { Resend } from "resend"
import { BRANDING } from "@/configs/branding"

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const fromEmail = process.env.RESEND_FROM_EMAIL || BRANDING.noreplyEmail
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"

// ── Shared dark-mode email shell ──────────────────────────────────────
// Matches the dashboard zinc-dark theme (src/app/globals.css .dark .app-shell):
// bg #09090b · card #18181b · border #27272a · text #fafafa / #a1a1aa ·
// accent #a3e635. Table-based with bgcolor attributes so Gmail/Outlook render
// the dark background correctly; all styles inline (email clients strip
// <style> and don't support CSS vars or custom fonts).

const MONO_STACK = `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace`
const SANS_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const DEFAULT_FOOTER = `You're receiving this because you have a ${BRANDING.name} account. Manage notifications in your <a href="${appUrl}/dashboard/account" style="color:#a1a1aa;text-decoration:underline;">account settings</a>.`

function renderEmailLayout(args: {
  bodyHtml: string
  ctaUrl?: string
  ctaLabel?: string
  footerHtml?: string
  maxWidth?: number
}): string {
  const maxWidth = args.maxWidth ?? 480

  const cta =
    args.ctaUrl && args.ctaLabel
      ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
              <tr>
                <td bgcolor="#a3e635" style="background-color:#a3e635;border-radius:8px;">
                  <a href="${args.ctaUrl}" style="display:inline-block;padding:12px 24px;background-color:#a3e635;color:#09090b;text-decoration:none;font-weight:700;border-radius:8px;font-family:${MONO_STACK};text-transform:uppercase;letter-spacing:0.05em;font-size:14px;">${args.ctaLabel}</a>
                </td>
              </tr>
            </table>`
      : ""

  return `<body style="margin:0;padding:0;background-color:#09090b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#09090b" style="background-color:#09090b;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${maxWidth}px;width:100%;">
          <tr>
            <td align="center" style="padding:0 0 24px;">
              <span style="font-family:${MONO_STACK};font-size:18px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#a3e635;">${BRANDING.name}</span>
            </td>
          </tr>
          <tr>
            <td bgcolor="#18181b" style="background-color:#18181b;border:1px solid #27272a;border-radius:12px;padding:32px;">
              <div style="font-family:${SANS_STACK};color:#fafafa;font-size:15px;line-height:1.6;">
                ${args.bodyHtml}
              </div>${cta}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 8px 0;">
              <div style="font-family:${SANS_STACK};color:#71717a;font-size:12px;line-height:1.5;">
                ${args.footerHtml ?? DEFAULT_FOOTER}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`
}

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
      subject: `${args.inviterName} invited you to ${args.teamName} on ${BRANDING.name}`,
      html: renderEmailLayout({
        bodyHtml: `<p style="margin:0;"><strong>${esc(args.inviterName)}</strong> invited you to join <strong>${esc(args.teamName)}</strong> as <strong>${esc(args.role)}</strong>.</p>`,
        ctaUrl: acceptUrl,
        ctaLabel: "Accept Invite",
        footerHtml: "This link expires in 7 days. If you weren't expecting this invite, ignore this email.",
      }),
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
      subject: `Reset your ${BRANDING.name} password`,
      html: renderEmailLayout({
        bodyHtml: `<p style="margin:0;">You requested a password reset. Click the button below to set a new password.</p>`,
        ctaUrl: resetUrl,
        ctaLabel: "Reset Password",
        footerHtml: "This link expires in 1 hour. If you didn't request this, ignore this email.",
      }),
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send password reset email:", error)
    return { success: false, error }
  }
}

export async function sendVerificationEmail(email: string, token: string) {
  const verifyUrl = `${appUrl}/verify-email?token=${token}&email=${encodeURIComponent(email)}`

  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping verification email")
    return { success: false, error: "Email not configured" }
  }

  try {
    await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: `Verify your ${BRANDING.name} email`,
      html: renderEmailLayout({
        bodyHtml: `<p style="margin:0;">Welcome to ${BRANDING.name}. Confirm your email address to finish setting up your account.</p>`,
        ctaUrl: verifyUrl,
        ctaLabel: "Verify Email",
        footerHtml: "This link expires in 24 hours. If you didn't create an account, ignore this email.",
      }),
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send verification email:", error)
    return { success: false, error }
  }
}

/**
 * Generic transactional notification email. Used by the multi-channel
 * notification dispatcher (src/lib/notifications) for the "email" channel.
 * Shares the Atlas Agents dark shell with the other templates here.
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

  try {
    await resend.emails.send({
      from: fromEmail,
      to: args.to,
      subject: args.title,
      html: renderEmailLayout({
        bodyHtml: `
                <p style="font-weight:700;font-size:16px;color:#fafafa;margin:0 0 8px;">${esc(args.title)}</p>
                <p style="white-space:pre-wrap;color:#a1a1aa;margin:0;">${esc(args.message)}</p>`,
        ctaUrl: args.url,
        ctaLabel: args.url ? "View Details" : undefined,
      }),
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

  try {
    await resend.emails.send({
      from: fromEmail,
      to: BRANDING.supportEmail,
      replyTo: args.fromEmail,
      subject: `[Support · ${args.priority}] ${args.subject}`,
      html: renderEmailLayout({
        maxWidth: 560,
        bodyHtml: `
                <p style="color:#a1a1aa;font-size:13px;margin:0 0 4px;">New support ticket</p>
                <p style="margin:0 0 16px;"><strong>${esc(args.fromName)}</strong> &lt;${esc(args.fromEmail)}&gt; · ${esc(args.category)} · ${esc(args.priority)}</p>
                <p style="margin:0 0 4px;font-weight:700;">${esc(args.subject)}</p>
                <p style="white-space:pre-wrap;line-height:1.5;color:#a1a1aa;margin:0;">${esc(args.message)}</p>`,
        footerHtml: "Reply to this email to respond to the customer.",
      }),
    })
    return { success: true }
  } catch (error) {
    console.error("Failed to send support ticket email:", error)
    return { success: false, error }
  }
}
