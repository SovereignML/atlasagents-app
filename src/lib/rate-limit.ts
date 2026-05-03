const requests = new Map<string, number[]>()

export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = requests.get(key) || []
  const filtered = timestamps.filter((t) => now - t < windowMs)

  if (filtered.length >= maxRequests) {
    requests.set(key, filtered)
    return false
  }

  filtered.push(now)
  requests.set(key, filtered)

  if (requests.size > 10_000) {
    for (const [k, v] of requests) {
      if (v.every((t) => now - t >= windowMs)) requests.delete(k)
    }
  }

  return true
}
