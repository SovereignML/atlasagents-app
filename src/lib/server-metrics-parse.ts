// Pure parsing for the server hardware probe — no DB, no SSH, no network. Kept
// separate from server-metrics.ts (which pulls in @/db and @/lib/ssh) so it can
// be unit-tested in isolation. See server-metrics.test.ts.

/**
 * Single-session bash probe. Emits one `key=value` line per metric so parsing
 * stays a pure string transform. Every command is guarded (`2>/dev/null`, `:-0`
 * defaults) so a missing tool yields an empty value rather than aborting the
 * script. Uses portable forms (/proc/meminfo, default `df -BG`) that work on any
 * modern Linux, root or not.
 */
export const PROBE_SCRIPT = `
echo "cpu_cores=$(nproc 2>/dev/null)"
echo "load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null)"
memtotal_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo 2>/dev/null)
memavail_kb=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo 2>/dev/null)
echo "mem_total_mb=$(( \${memtotal_kb:-0} / 1024 ))"
echo "mem_avail_mb=$(( \${memavail_kb:-0} / 1024 ))"
df_line=$(df -BG / 2>/dev/null | tail -1)
echo "disk_total_gb=$(echo "$df_line" | awk '{print $2}' | tr -dc '0-9')"
echo "disk_used_gb=$(echo "$df_line" | awk '{print $3}' | tr -dc '0-9')"
os_name=""; os_version=""
if [ -r /etc/os-release ]; then . /etc/os-release; os_name="$NAME"; os_version="$VERSION_ID"; fi
echo "os_name=$os_name"
echo "os_version=$os_version"
echo "kernel=$(uname -r 2>/dev/null)"
echo "uptime_sec=$(cut -d. -f1 /proc/uptime 2>/dev/null)"
`

export type ServerMetricSnapshot = {
  cpuCores: number | null
  cpuLoad1: number | null
  ramTotalMb: number | null
  ramUsedMb: number | null
  diskTotalGb: number | null
  diskUsedGb: number | null
  osName: string | null
  osVersion: string | null
  kernel: string | null
  uptimeSec: number | null
}

function toNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null
  const n = Number(v.trim())
  return Number.isFinite(n) ? n : null
}

function toStr(v: string | undefined): string | null {
  const s = v?.trim()
  return s ? s : null
}

/**
 * Parse the PROBE_SCRIPT stdout into a snapshot. Unknown/blank fields become
 * null; RAM used is derived as total − available (what /proc/meminfo gives us
 * directly).
 */
export function parseServerMetrics(stdout: string): ServerMetricSnapshot {
  const kv = new Map<string, string>()
  for (const line of stdout.split("\n")) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    kv.set(line.slice(0, eq).trim(), line.slice(eq + 1))
  }

  const ramTotalMb = toNum(kv.get("mem_total_mb"))
  const ramAvailMb = toNum(kv.get("mem_avail_mb"))
  const ramUsedMb =
    ramTotalMb != null && ramAvailMb != null ? Math.max(0, ramTotalMb - ramAvailMb) : null

  return {
    cpuCores: toNum(kv.get("cpu_cores")),
    cpuLoad1: toNum(kv.get("load1")),
    ramTotalMb,
    ramUsedMb,
    diskTotalGb: toNum(kv.get("disk_total_gb")),
    diskUsedGb: toNum(kv.get("disk_used_gb")),
    osName: toStr(kv.get("os_name")),
    osVersion: toStr(kv.get("os_version")),
    kernel: toStr(kv.get("kernel")),
    uptimeSec: toNum(kv.get("uptime_sec")),
  }
}
