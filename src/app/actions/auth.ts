"use server"

import { signIn, signOut } from "@/auth"

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/dashboard" })
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
