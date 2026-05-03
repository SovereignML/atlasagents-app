import type { NextAuthConfig } from "next-auth"

// Edge-compatible config — NO bcrypt, NO Node.js modules
// This is used by proxy (middleware) and shared with auth.ts
export default {
  providers: [],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as { role: string }).role
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
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isAdmin = (auth?.user as { role?: string })?.role === "admin"
      const pathname = nextUrl.pathname

      if (pathname.startsWith("/admin")) {
        if (!isLoggedIn) return Response.redirect(new URL("/login", nextUrl))
        if (!isAdmin) return Response.redirect(new URL("/dashboard", nextUrl))
        return true
      }

      if (pathname.startsWith("/dashboard")) {
        if (!isLoggedIn) return Response.redirect(new URL("/login", nextUrl))
        return true
      }

      if (pathname === "/login" || pathname === "/register") {
        if (isLoggedIn) return Response.redirect(new URL("/dashboard", nextUrl))
      }

      return true
    },
  },
  session: {
    strategy: "jwt",
  },
} satisfies NextAuthConfig
