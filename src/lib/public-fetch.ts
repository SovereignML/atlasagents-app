import http from "node:http"
import https from "node:https"
import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import { isIP, type LookupFunction } from "node:net"

import { BlockedHostError, privateIpReason } from "@/lib/net-guard"

/**
 * HTTP(S) to a user-supplied URL, refusing any non-public address at connect
 * time. For server-side requests to URLs a customer or tenant controls: a
 * knowledge source, a tenant's Chatwoot.
 *
 * Checking the host first and then calling fetch() leaves a gap: fetch looks
 * the name up again, and a DNS server can answer the check with a public IP
 * and the connection with a private one (DNS rebinding). Here the check runs
 * inside the socket's own `lookup`, on the addresses it is about to connect
 * to, so there is no second resolution. Redirects are followed by hand, each
 * hop checked the same way.
 *
 * Hosts in BYOS_HOST_ALLOWLIST bypass the check, as in assertPublicHost().
 */

export type PublicFetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Whole-request timeout, redirects included. Default 15s. */
  timeoutMs?: number
  /** Response bodies past this are cut off. Default 5 MB. */
  maxBytes?: number
  /** Default 3. 0 returns the redirect response itself. */
  maxRedirects?: number
}

export type PublicFetchResponse = {
  status: number
  ok: boolean
  url: string
  headers: http.IncomingHttpHeaders
  text: string
  json<T = unknown>(): T
}

function allowlisted(host: string): boolean {
  return (process.env.BYOS_HOST_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(host.toLowerCase())
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0)
    const list = addresses as unknown as LookupAddress[]
    if (list.length === 0) return callback(new BlockedHostError(hostname, "no DNS records"), "", 0)
    for (const { address } of list) {
      const reason = privateIpReason(address)
      if (reason) {
        return callback(new BlockedHostError(hostname, `resolves to ${address} — ${reason}`), "", 0)
      }
    }
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

/** Throws BlockedHostError for a non-http(s) URL or a private literal IP. */
function checkUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedHostError(url.href, `unsupported protocol ${url.protocol}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host)) {
    const reason = privateIpReason(host)
    if (reason && !allowlisted(host)) throw new BlockedHostError(host, reason)
  }
}

function requestOnce(
  url: URL,
  init: PublicFetchInit,
  deadline: number,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  checkUrl(url)
  const mod = url.protocol === "https:" ? https : http
  const maxBytes = init.maxBytes ?? 5_000_000
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        lookup: allowlisted(url.hostname) ? undefined : guardedLookup,
        timeout: Math.max(1, deadline - Date.now()),
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on("data", (chunk: Buffer) => {
          if (size >= maxBytes) return
          chunks.push(chunk)
          size += chunk.length
          if (size >= maxBytes) res.destroy()
        })
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8"),
          })
        res.on("end", done)
        res.on("close", done)
        res.on("error", reject)
      },
    )
    req.on("timeout", () => req.destroy(new Error(`Request to ${url.host} timed out`)))
    req.on("error", reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

export async function publicFetch(
  input: string,
  init: PublicFetchInit = {},
): Promise<PublicFetchResponse> {
  const deadline = Date.now() + (init.timeoutMs ?? 15_000)
  const maxRedirects = init.maxRedirects ?? 3
  let url = new URL(input)
  let method = init.method
  let body = init.body
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, { ...init, method, body }, deadline)
    const location = res.headers.location
    if (res.status >= 300 && res.status < 400 && location && hop < maxRedirects) {
      url = new URL(location, url)
      // 303, and 301/302 on POST, become GET without a body, as browsers do.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method && method !== "GET")) {
        method = "GET"
        body = undefined
      }
      continue
    }
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      url: url.href,
      headers: res.headers,
      text: res.text,
      json: <T>() => JSON.parse(res.text) as T,
    }
  }
}
