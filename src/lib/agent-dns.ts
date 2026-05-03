import crypto from "node:crypto"
import {
  upsertDnsRecord,
  deleteDnsRecord,
  findRecordByName,
  type CloudflareError,
} from "./cloudflare"

const BASE = process.env.CLOUDFLARE_BASE_DOMAIN ?? "sovereignclaw.xyz"

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

export const agentHostname = (subdomain: string): string => `${subdomain}.${BASE}`

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
  const name = agentHostname(subdomain)
  const proxied = opts.proxied ?? true
  const max = 6
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      const rec = await upsertDnsRecord({ name, ip, proxied })
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

export async function deleteAgentSubdomain(
  agentId: string,
  recordId?: string | null,
): Promise<void> {
  if (recordId) {
    try {
      await deleteDnsRecord(recordId)
      return
    } catch (e) {
      const cfErr = e as CloudflareError
      if (cfErr.status !== 404) throw e
    }
  }
  const rec = await findRecordByName(agentHostname(agentId))
  if (rec) await deleteDnsRecord(rec.id)
}
