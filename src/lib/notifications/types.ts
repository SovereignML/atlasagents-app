// Shared, dependency-free notification vocabulary. Safe to import from both
// server (dispatch, channels) and client (preferences UI).

export type NotificationCategory = "billing" | "provisioning" | "security"
export type NotificationChannel = "inApp" | "email" | "telegram" | "discord" | "slack"

export const CATEGORIES: NotificationCategory[] = ["billing", "provisioning", "security"]
export const CHANNELS: NotificationChannel[] = ["inApp", "email", "telegram", "discord", "slack"]

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  billing: "Billing",
  provisioning: "Provisioning",
  security: "Security",
}

export const CATEGORY_DESCRIPTIONS: Record<NotificationCategory, string> = {
  billing: "Payments, credits, and subscription changes",
  provisioning: "Agent deployments — success and failure",
  security: "Password and two-factor changes",
}

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inApp: "In-App",
  email: "Email",
  telegram: "Telegram",
  discord: "Discord",
  slack: "Slack",
}

export type NotificationMatrix = Record<NotificationCategory, Record<NotificationChannel, boolean>>

// Applied when a user has no preferences row yet. In-app is on everywhere;
// email is on for the channels users most expect a paper trail on.
export const DEFAULT_MATRIX: NotificationMatrix = {
  billing: { inApp: true, email: true, telegram: false, discord: false, slack: false },
  provisioning: { inApp: true, email: false, telegram: false, discord: false, slack: false },
  security: { inApp: true, email: true, telegram: false, discord: false, slack: false },
}

// Merge a stored (possibly partial / legacy) matrix over the defaults so a
// missing category or channel always resolves to a sane boolean.
export function resolveMatrix(
  stored?: Record<string, Record<string, boolean>> | null,
): NotificationMatrix {
  const out: NotificationMatrix = {
    billing: { ...DEFAULT_MATRIX.billing },
    provisioning: { ...DEFAULT_MATRIX.provisioning },
    security: { ...DEFAULT_MATRIX.security },
  }
  if (!stored) return out
  for (const cat of CATEGORIES) {
    const row = stored[cat]
    if (!row) continue
    for (const ch of CHANNELS) {
      if (typeof row[ch] === "boolean") out[cat][ch] = row[ch]
    }
  }
  return out
}
