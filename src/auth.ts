import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import Twitter from "next-auth/providers/twitter"
import Apple from "next-auth/providers/apple"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import authConfig from "./auth.config"
import { db, users, accounts, sessions, verificationTokens, eq } from "@/db"
import { verifyPassword } from "@/lib/password"
import {
  isGoogleOAuthConfigured,
  isTwitterOAuthConfigured,
  isAppleOAuthConfigured,
} from "@/lib/oauth"
import { verifyTotpToken } from "@/lib/totp"
import { consumeBackupCode, decryptTotpSecret } from "@/lib/two-factor"
import { verifyTurnstileToken } from "@/lib/turnstile"
import { rateLimit } from "@/lib/rate-limit"

/**
 * `code` is overridden so the client can distinguish the 2FA challenge step
 * from a generic credentials failure (NextAuth surfaces this via `result.code`).
 */
class TwoFactorRequired extends CredentialsSignin {
  code = "TwoFactorRequired"
}

class TwoFactorInvalid extends CredentialsSignin {
  code = "TwoFactorInvalid"
}

class TurnstileFailed extends CredentialsSignin {
  code = "TurnstileFailed"
}

class RateLimited extends CredentialsSignin {
  code = "RateLimited"
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    ...(isGoogleOAuthConfigured()
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID ?? process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? process.env.AUTH_GOOGLE_SECRET!,
          }),
        ]
      : []),
    ...(isTwitterOAuthConfigured()
      ? [
          Twitter({
            clientId: process.env.TWITTER_CLIENT_ID ?? process.env.AUTH_TWITTER_ID!,
            clientSecret:
              process.env.TWITTER_CLIENT_SECRET ?? process.env.AUTH_TWITTER_SECRET!,
            // Twitter / X OAuth 2.0 does NOT return an email address unless
            // the app has elevated access. The DrizzleAdapter inserts the
            // returned profile directly into `User.email`, which is
            // NOT NULL — synthesize a stable placeholder so signup never
            // fails. Users can replace it from `/dashboard/account`.
            profile(profile) {
              const data = profile.data
              return {
                id: data.id,
                name: data.name,
                email: data.email ?? `${data.username}@x.placeholder.invalid`,
                image: data.profile_image_url,
              }
            },
          }),
        ]
      : []),
    ...(isAppleOAuthConfigured()
      ? [
          Apple({
            clientId: process.env.APPLE_CLIENT_ID ?? process.env.AUTH_APPLE_ID!,
            clientSecret:
              process.env.APPLE_CLIENT_SECRET ?? process.env.AUTH_APPLE_SECRET!,
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Optional second-factor code: TOTP or backup code.
        code: { label: "2FA code", type: "text" },
        // Cloudflare Turnstile token (only present/verified on the first step).
        turnstileToken: { label: "Turnstile", type: "text" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        // Brute-force guard: fixed-window limits per email and per IP. Counts
        // every attempt (incl. 2FA re-submits), so caps are generous — they
        // only bite on credential-stuffing patterns, not real users.
        const email = (credentials.email as string).toLowerCase().trim()
        const ip =
          request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown"
        const [emailOk, ipOk] = await Promise.all([
          rateLimit(`login:email:${email}`, 10, 15 * 60 * 1000),
          rateLimit(`login:ip:${ip}`, 30, 15 * 60 * 1000),
        ])
        if (!emailOk || !ipOk) throw new RateLimited()

        // Verify Turnstile only on the initial submit. CF tokens are single-use,
        // and the 2FA re-submit reuses the same email/password with a `code`, so
        // skip re-verification then. No-op when Turnstile isn't configured.
        if (!credentials?.code) {
          const ok = await verifyTurnstileToken(
            credentials?.turnstileToken as string | undefined,
          )
          if (!ok) throw new TurnstileFailed()
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        })

        if (!user || !user.hashedPassword) return null
        if (user.isBanned) return null

        const isValid = await verifyPassword(
          credentials.password as string,
          user.hashedPassword,
        )
        if (!isValid) return null

        if (user.twoFactorEnabled && user.twoFactorSecret) {
          const rawCode = (credentials.code as string | undefined)?.trim()
          if (!rawCode) {
            throw new TwoFactorRequired()
          }

          const digits = rawCode.replace(/\s+/g, "")
          let codeValid = false

          if (/^\d{6}$/.test(digits)) {
            try {
              const secret = decryptTotpSecret(user.twoFactorSecret)
              codeValid = verifyTotpToken(digits, secret)
            } catch {
              codeValid = false
            }
          }

          if (!codeValid) {
            const consumed = await consumeBackupCode(user.id, rawCode)
            codeValid = consumed
          }

          if (!codeValid) {
            throw new TwoFactorInvalid()
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // Reject banned users on OAuth sign-in. Credentials are already blocked
    // in `authorize()` above (line ~95). We can't reject from the `jwt`
    // callback by returning `token` — that returns a valid token! — so the
    // gate has to live here.
    //
    // Look up by email (not user.id): for first-time OAuth users the DB row
    // may not exist with a stable id yet across NextAuth versions; email is.
    async signIn({ user, account }) {
      if (account?.provider === "credentials") return true
      if (!user?.email) return true
      const dbUser = await db.query.users.findFirst({
        where: eq(users.email, user.email),
        columns: { isBanned: true, emailVerified: true },
      })
      if (dbUser?.isBanned) return false
      // OAuth providers attest the email — auto-verify so these users never see
      // the "verify your email" prompt. The DrizzleAdapter has already upserted
      // the row by the time this callback runs.
      if (dbUser && dbUser.emailVerified == null) {
        await db
          .update(users)
          .set({ emailVerified: new Date() })
          .where(eq(users.email, user.email))
      }
      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        const u = user as { id?: string; sub?: string }
        token.id = u.id ?? u.sub ?? (token.id as string | undefined) ?? token.sub
        token.role = (user as { role?: string }).role || "user"
      }
      if (account && user && account.provider !== "credentials") {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id as string),
          columns: { role: true },
        })
        token.role = dbUser?.role || "user"
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        ;(session.user as { role: string }).role = token.role as string
      }
      return session
    },
  },
})
