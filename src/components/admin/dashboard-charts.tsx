"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

/**
 * Charts for the admin overview.
 *
 * Colour rules in force here, so later edits don't quietly break them:
 *
 *  - Single-series plots carry NO legend — the card title names the series.
 *    They use the brand fill (--brand-bar), which resolves per console theme.
 *  - The agent-status donut uses the RESERVED status palette (green/amber/
 *    gray/red). Status colour is never the only encoding: every slice is also
 *    named in the legend beneath, and the tooltip states the label.
 *  - The one genuinely CATEGORICAL plot (runtime split) uses --chart-cat-1/2,
 *    a pair validated for colourblind separation in both themes. See the note
 *    in globals.css before changing it.
 *
 * Every plot ships a hover tooltip; none uses a second y-axis.
 */

// ── shared axis formatters ───────────────────────────────────────────────────

/** "Jun 3" from a YYYY-MM-DD bucket, in UTC so the label can't drift a day. */
function formatDayTick(value: string): string {
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return value
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** "Jun 25" from a YYYY-MM bucket. */
function formatMonthTick(value: string): string {
  const [y, m] = value.split("-").map(Number)
  if (!y || !m) return value
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  })
}

const BAR = "var(--brand-bar)"
const BAR_PEAK = "var(--brand-bar-peak)"

// ── signups ──────────────────────────────────────────────────────────────────

/**
 * Daily signups, 30 days. Bars (not a line): each day is a discrete count, and
 * a line would imply interpolation between days that doesn't exist. The peak
 * day gets the brighter fill so the best day reads without hunting.
 */
export function DailySignupsChart({ data }: { data: { day: string; count: number }[] }) {
  const config: ChartConfig = { count: { label: "Signups", color: BAR } }
  const peak = data.reduce((max, d) => Math.max(max, d.count), 0)

  return (
    <ChartContainer config={config} className="aspect-[16/6] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 16 }}>
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={20}
          className="font-mono text-[11px]"
          tickFormatter={formatDayTick}
        />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatDayTick(String(payload?.[0]?.payload?.day ?? ""))
              }
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value)} signup{Number(value) === 1 ? "" : "s"}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={28}>
          {data.map((d, i) => (
            <Cell key={i} fill={peak > 0 && d.count === peak ? BAR_PEAK : BAR} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Monthly signups, 12 months. Same reasoning as the daily chart. */
export function MonthlySignupsChart({
  data,
}: {
  data: { month: string; count: number }[]
}) {
  const config: ChartConfig = { count: { label: "Signups", color: BAR } }
  const peak = data.reduce((max, d) => Math.max(max, d.count), 0)

  return (
    <ChartContainer config={config} className="aspect-[16/6] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 16 }}>
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          className="font-mono text-[11px]"
          tickFormatter={formatMonthTick}
        />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatMonthTick(String(payload?.[0]?.payload?.month ?? ""))
              }
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value)} signup{Number(value) === 1 ? "" : "s"}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {data.map((d, i) => (
            <Cell key={i} fill={peak > 0 && d.count === peak ? BAR_PEAK : BAR} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Agents created per day, 30 days — same form as signups so the two read together. */
export function AgentsCreatedChart({ data }: { data: { day: string; count: number }[] }) {
  const config: ChartConfig = { count: { label: "Agents", color: BAR } }

  return (
    <ChartContainer config={config} className="aspect-[16/6] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 16 }}>
        <CartesianGrid vertical={false} className="stroke-border" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={20}
          className="font-mono text-[11px]"
          tickFormatter={formatDayTick}
        />
        <YAxis hide domain={[0, "dataMax + 1"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatDayTick(String(payload?.[0]?.payload?.day ?? ""))
              }
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value)} agent{Number(value) === 1 ? "" : "s"}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="count" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  )
}

// ── agent status ─────────────────────────────────────────────────────────────

// Reserved status palette. Gray for "stopped" is deliberate — an inactive state
// should read as neutral, not compete with the live ones for attention.
const STATUS_META: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "#10b981" },
  provisioning: { label: "Provisioning", color: "#f59e0b" },
  pending: { label: "Pending", color: "#f59e0b" },
  stopped: { label: "Stopped", color: "#a1a1aa" },
  failed_provisioning: { label: "Failed", color: "#ef4444" },
  deleting: { label: "Deleting", color: "#a1a1aa" },
}

export function AgentStatusDonut({ data }: { data: { key: string; count: number }[] }) {
  const slices = data.filter((d) => d.count > 0)
  const total = slices.reduce((sum, d) => sum + d.count, 0)

  const config: ChartConfig = Object.fromEntries(
    Object.entries(STATUS_META).map(([k, m]) => [k, { label: m.label, color: m.color }]),
  )

  const chartData = slices.map((d) => ({
    status: d.key,
    count: d.count,
    fill: STATUS_META[d.key]?.color ?? "#a1a1aa",
  }))

  if (total === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No agents yet
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[200px]">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent nameKey="status" hideLabel />}
          />
          {/* strokeWidth is the 2px-surface-gap rule: adjacent slices never touch. */}
          <Pie data={chartData} dataKey="count" nameKey="status" innerRadius={54} strokeWidth={4}>
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-3xl font-bold"
                      >
                        {total}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy ?? 0) + 22}
                        className="fill-muted-foreground text-xs"
                      >
                        {total === 1 ? "agent" : "agents"}
                      </tspan>
                    </text>
                  )
                }
                return null
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>

      {/* Legend carries the identity so colour is never the sole encoding. */}
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {chartData.map((d) => (
          <li key={d.status} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: d.fill }}
            />
            <span className="text-muted-foreground">
              {STATUS_META[d.status]?.label ?? d.status}
            </span>
            <span className="font-mono font-medium tabular-nums text-foreground">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── runtime split (categorical) ──────────────────────────────────────────────

const CAT = ["var(--chart-cat-1)", "var(--chart-cat-2)"]

/**
 * Agents by runtime. The only categorical plot on the page: the two runtimes
 * are identities, not states, so they take the validated categorical pair
 * rather than status colours. Direct value labels double as the secondary
 * encoding alongside hue.
 */
export function RuntimeSplitChart({ data }: { data: { key: string; count: number }[] }) {
  const rows = data.filter((d) => d.count > 0)
  const total = rows.reduce((s, d) => s + d.count, 0)
  if (total === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">
        No agents yet
      </div>
    )
  }

  return (
    <ul className="space-y-3">
      {rows.map((d, i) => {
        const pct = Math.round((d.count / total) * 100)
        return (
          <li key={d.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: CAT[i % CAT.length] }}
                />
                <span className="capitalize text-foreground">{d.key}</span>
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                <span className="font-medium text-foreground">{d.count}</span> · {pct}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: CAT[i % CAT.length] }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ── activation funnel ────────────────────────────────────────────────────────

/**
 * Signup → paying, as proportional bars against the widest stage.
 *
 * A horizontal bar list rather than a tapered funnel graphic: funnel shapes
 * encode magnitude in AREA, which people read badly, and they imply a strict
 * subset relationship these stages don't have (see getActivationFunnel).
 * Step-over-step conversion is printed on each row — that's the number staff
 * actually act on.
 */
export function ActivationFunnel({
  stages,
}: {
  stages: { label: string; count: number; hint: string }[]
}) {
  const top = stages[0]?.count ?? 0

  return (
    <ol className="space-y-3">
      {stages.map((s, i) => {
        const widthPct = top > 0 ? Math.max((s.count / top) * 100, 1.5) : 0
        const prev = i > 0 ? stages[i - 1].count : null
        const stepPct = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null

        return (
          <li key={s.label} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground" title={s.hint}>
                {s.label}
              </span>
              <span className="flex items-baseline gap-2 font-mono text-sm tabular-nums">
                <span className="font-medium text-foreground">{s.count.toLocaleString()}</span>
                {stepPct !== null && (
                  <span
                    className={
                      stepPct < 50 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                    }
                  >
                    {stepPct}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${widthPct}%`, backgroundColor: BAR }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── 2FA coverage ─────────────────────────────────────────────────────────────

/**
 * 2FA coverage across password holders, as a single hero proportion.
 *
 * A stat tile with one meter, not a pie: there are exactly two parts and the
 * question is "how far to 100%", which a proportion bar answers directly.
 * Tone is status-coded AND stated in words, so the judgement never rests on
 * colour alone.
 */
export function TwoFactorCoverage({
  covered,
  total,
  pct,
}: {
  covered: number
  total: number
  pct: number
}) {
  const tone =
    pct >= 80
      ? { bar: "#10b981", text: "text-emerald-600 dark:text-emerald-400", word: "Good" }
      : pct >= 50
        ? { bar: "#f59e0b", text: "text-amber-600 dark:text-amber-400", word: "Needs work" }
        : { bar: "#ef4444", text: "text-destructive", word: "Critical" }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-4xl font-bold tabular-nums ${tone.text}`}>{pct}%</span>
        <span className={`text-sm font-medium ${tone.text}`}>{tone.word}</span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${pct}% of password accounts have two-factor authentication enabled`}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: tone.bar }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono font-medium tabular-nums text-foreground">{covered}</span> of{" "}
        <span className="font-mono font-medium tabular-nums text-foreground">{total}</span> password
        accounts have TOTP enrolled. OAuth-only accounts are excluded — their second factor is
        enforced by the identity provider.
      </p>
    </div>
  )
}
