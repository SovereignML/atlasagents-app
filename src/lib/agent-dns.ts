import crypto from "node:crypto"
import {
  upsertDnsRecord,
  deleteDnsRecord,
  findRecordByName,
  type CloudflareError,
} from "./cloudflare"
import { primaryAgentZone, zoneDnsEnabled, zoneForHostname } from "./agent-zones"

// The zone(s) agent hostnames live in — new agents in the primary zone,
// existing ones wherever their stored hostname says — are resolved by
// agent-zones.ts. See docs/REBRAND-LEGACY-IDENTIFIERS.md.

const ADJECTIVES = [
  "bold","brave","bright","calm","clear","cool","crisp","dark","deep","fair",
  "fast","firm","fond","free","glad","gold","good","grand","gray","keen",
  "kind","late","lean","long","loud","mild","neat","nice","pale","pure",
  "rare","rich","ripe","safe","sharp","slim","soft","sure","tall","tame",
  "tidy","tiny","true","vast","warm","wide","wild","wise","young","apt",
  "dry","fit","hot","new","odd","old","raw","red","shy","tan",
  "deft","epic","grim","hale","icy","jade","lush","mint","opal","plum",
  "ruby","sage","silk","teal","trim","twin","cozy","dawn","dusk","fawn",
  "flax","glen","haze","iris","lark","lime","luna","navy","onyx","pine",
  "reed","rose","rust","snow","star","vale","wave","wren","zinc","aqua",
] as const

const NOUNS = [
  "arch","bark","bell","bird","bolt","cape","cave","clay","cove","crag",
  "dawn","deer","dove","dune","dust","edge","elm","fawn","fern","fire",
  "flax","foam","ford","fox","gate","glen","gust","hare","hawk","haze",
  "hill","hive","isle","jade","kite","lake","lane","leaf","lime","loft",
  "lynx","mesa","mill","mint","mist","moon","moss","nest","opal","orca",
  "owl","palm","peak","pine","plum","pond","rail","rain","reef","rose",
  "sage","sand","seed","snow","star","stem","tide","vale","vine","wren",
  "arch","bass","beam","brim","brook","claw","cliff","coral","crane","creek",
  "drift","dusk","eagle","ember","field","flame","frost","grove","haven","heath",
  "ivory","jewel","knoll","lodge","maple","marsh","north","ocean","patch","petal",
] as const

function pick<T>(arr: readonly T[]): T {
  const idx = crypto.randomInt(arr.length)
  return arr[idx]
}

function slugify(input: string, maxLen = 20): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
}

export function generateReadableSubdomain(botName: string): string {
  const base = slugify(botName) || "agent"
  return `${base}-${pick(ADJECTIVES)}-${pick(NOUNS)}`
}

/** A hostname for a NEW agent: always in the primary agent zone. */
export const agentHostname = (subdomain: string): string =>
  `${subdomain}.${primaryAgentZone().domain}`

/**
 * Whether new agents can get a managed hostname at all: a Cloudflare token
 * plus a zone id for the primary agent zone.
 */
export function isAgentDnsEnabled(): boolean {
  return zoneDnsEnabled(primaryAgentZone())
}

/**
 * Whether the record behind an EXISTING hostname can be managed: a token plus
 * the zone id of the zone that hostname lives in (which, after a zone move,
 * may not be the primary one).
 */
export function isAgentDnsEnabledFor(hostname: string | null | undefined): boolean {
  return zoneDnsEnabled(hostname ? zoneForHostname(hostname) : primaryAgentZone())
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export type AgentDnsResult = { name: string; recordId: string }

export async function createAgentSubdomain(
  agentId: string,
  ip: string,
  botName?: string,
  opts: { proxied?: boolean } = {},
): Promise<AgentDnsResult> {
  const subdomain = botName
    ? generateReadableSubdomain(botName)
    : agentId
  const zone = primaryAgentZone()
  const name = `${subdomain}.${zone.domain}`
  const ctx = zone.zoneId ? { zoneId: zone.zoneId } : undefined
  const proxied = opts.proxied ?? true
  const max = 6
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      const rec = await upsertDnsRecord({ name, ip, proxied }, ctx)
      return { name, recordId: rec.id }
    } catch (e) {
      lastErr = e
      const cfErr = e as CloudflareError
      if (cfErr.status === 401 || cfErr.status === 403) throw e
      const wait = cfErr.retryAfter
        ? cfErr.retryAfter * 1000
        : Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250
      if (attempt === max - 1) break
      await sleep(wait)
    }
  }
  throw lastErr ?? new Error("createAgentSubdomain: exhausted retries")
}

/**
 * Delete an agent's managed record. `hostname` (the stored managedSubdomain)
 * picks the zone: a record id only means something inside the zone that
 * issued it, and after a zone move an existing agent's record is still in the
 * old one. Without a hostname this falls back to the primary zone, which is
 * what it did before zones existed.
 */
export async function deleteAgentSubdomain(
  agentId: string,
  recordId?: string | null,
  hostname?: string | null,
): Promise<void> {
  const zone = hostname ? zoneForHostname(hostname) : primaryAgentZone()
  if (!zone) {
    throw new Error(
      `${hostname} is not in any configured agent zone; its DNS record was left in place.`,
    )
  }
  const ctx = zone.zoneId ? { zoneId: zone.zoneId } : undefined
  if (recordId) {
    try {
      await deleteDnsRecord(recordId, ctx)
      return
    } catch (e) {
      const cfErr = e as CloudflareError
      if (cfErr.status !== 404) throw e
    }
  }
  const rec = await findRecordByName(hostname || `${agentId}.${zone.domain}`, ctx)
  if (rec) await deleteDnsRecord(rec.id, ctx)
}
