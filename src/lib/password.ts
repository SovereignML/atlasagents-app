import { hash, compare } from "bcryptjs"

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 10)
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return compare(password, stored)
}
