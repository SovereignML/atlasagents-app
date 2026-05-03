import { differenceInDays, isPast, addDays } from "date-fns"

export function isSubscriptionActive(endDate: Date | null): boolean {
  if (!endDate) return false
  return !isPast(endDate)
}

export function daysRemaining(endDate: Date | null): number {
  if (!endDate) return 0
  const days = differenceInDays(endDate, new Date())
  return Math.max(0, days)
}

export function calculateEndDate(startDate: Date, days: number): Date {
  return addDays(startDate, days)
}

export function shouldExpire(endDate: Date | null): boolean {
  if (!endDate) return false
  return isPast(endDate)
}
