"use server"

import { signIn, signOut } from "@/auth"

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/dashboard" })
}

/**
 * Link Google to the currently signed-in account. Same OAuth flow as
 * `signInWithGoogle`, but returns to the account page so the Connected
 * Accounts card reflects the new link.
 */
export async function linkGoogle() {
  await signIn("google", { redirectTo: "/dashboard/account?linked=google" })
}

export async function signInWithTwitter() {
  await signIn("twitter", { redirectTo: "/dashboard" })
}

export async function signInWithApple() {
  await signIn("apple", { redirectTo: "/dashboard" })
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" })
}
