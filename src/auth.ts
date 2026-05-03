import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import authConfig from "./auth.config"
import { db, users, accounts, sessions, verificationTokens, eq } from "@/db"
import { verifyPassword } from "@/lib/password"
import { isGoogleOAuthConfigured } from "@/lib/google-oauth"

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
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        })

        if (!user || !user.hashedPassword) return null
        if (user.isBanned) return null

        const isValid = await verifyPassword(
          credentials.password as string,
          user.hashedPassword
        )

        if (!isValid) return null

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
    async jwt({ token, user, account }) {
      if (user) {
        const u = user as { id?: string; sub?: string }
        token.id = u.id ?? u.sub ?? (token.id as string | undefined) ?? token.sub
        token.role = (user as { role?: string }).role || "user"
      }
      if (account?.provider === "google" && user) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.id, user.id as string),
          columns: { role: true, isBanned: true },
        })
        if (dbUser?.isBanned) return token
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
