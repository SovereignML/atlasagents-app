import { and, eq, notInArray, instances } from "@/db"

/** User-facing lists and lookups: never surface soft-deleted rows */
export function whereUserInstancesVisible(userId: string) {
  return and(eq(instances.userId, userId), notInArray(instances.status, ["deleted"]))
}

export function whereUserInstanceVisible(userId: string, instanceId: string) {
  return and(
    eq(instances.id, instanceId),
    eq(instances.userId, userId),
    notInArray(instances.status, ["deleted"]),
  )
}
