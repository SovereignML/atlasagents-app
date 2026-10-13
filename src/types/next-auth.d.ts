import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: string
    } & DefaultSession["user"]
    /** Set (with no `user`) when the account was banned after sign-in. See src/auth.ts. */
    banned?: true
  }

  interface User {
    role?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    role: string
    banned?: true
  }
}
