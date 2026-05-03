export const DEPLOY_STATUSES = [
  "provisioning",
  "running",
  "stopped",
  "failed",
  "deleted",
] as const

export type DeployStatus = (typeof DEPLOY_STATUSES)[number]

export const SUBSCRIPTION_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "trialing",
] as const

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]
