"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
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

// Status hues read clearly on both the light (blue) and dark (black) shells and
// carry intuitive meaning (green = healthy, amber = in-flight, red = failed).
const STATUS_META: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "#10b981" },
  provisioning: { label: "Provisioning", color: "#f59e0b" },
  stopped: { label: "Stopped", color: "#a1a1aa" },
  failed: { label: "Failed", color: "#ef4444" },
}

export function AgentsStatusChart({
  data,
}: {
  data: { status: string; count: number }[]
}) {
  const slices = data.filter((d) => d.count > 0)
  const total = slices.reduce((sum, d) => sum + d.count, 0)

  const config: ChartConfig = Object.fromEntries(
    Object.entries(STATUS_META).map(([key, meta]) => [
      key,
      { label: meta.label, color: meta.color },
    ])
  )

  const chartData = slices.map((d) => ({
    status: d.status,
    count: d.count,
    fill: STATUS_META[d.status]?.color ?? "#a1a1aa",
  }))

  return (
    <ChartContainer
      config={config}
      className="mx-auto aspect-square max-h-[220px]"
    >
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent nameKey="status" hideLabel />}
        />
        <Pie
          data={chartData}
          dataKey="count"
          nameKey="status"
          innerRadius={58}
          strokeWidth={4}
        >
          <Label
            content={({ viewBox }) => {
              if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                return (
                  <text
                    x={viewBox.cx}
                    y={viewBox.cy}
                    textAnchor="middle"
                    dominantBaseline="middle"
                  >
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
  )
}

// Compact "Jun 3" style day label from a YYYY-MM-DD bucket (UTC, no TZ drift).
function formatDayTick(value: string): string {
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return value
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

// "HH:00" hour label from a YYYY-MM-DDTHH:00 bucket.
function formatHourTick(value: string): string {
  const time = value.split("T")[1]
  return time ?? value
}

// Agent activity — REAL runs/day (run.finished AgentEvents). The bar color is
// the brand series, resolved per console theme: blue on light, lime on dark
// (--brand-bar / --brand-bar-peak in globals.css). The peak day is a touch
// brighter so the busiest day reads at a glance.
const BAR = "var(--brand-bar)"
const BAR_PEAK = "var(--brand-bar-peak)"

export function ActivityChart({
  data,
}: {
  data: { day: string; runs: number }[]
}) {
  const config: ChartConfig = {
    runs: { label: "Runs", color: BAR },
  }

  const peak = data.reduce((max, d) => Math.max(max, d.runs), 0)

  return (
    <ChartContainer config={config} className="aspect-[16/7] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 20 }}>
        <CartesianGrid vertical={false} stroke="#27272a" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          className="font-mono text-[11px]"
          tickFormatter={formatDayTick}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatDayTick(String(payload?.[0]?.payload?.day ?? ""))}
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value)} run{Number(value) === 1 ? "" : "s"}
                </span>
              )}
            />
          }
        />
        <Bar dataKey="runs" radius={[6, 6, 0, 0]} maxBarSize={36}>
          {data.map((d, i) => (
            <Cell key={i} fill={peak > 0 && d.runs === peak ? BAR_PEAK : BAR} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// Daily spend — REAL per-day daily_compute debits, amber bars with value labels.
const AMBER = "#f59e0b"

export function SpendChart({
  data,
}: {
  data: { day: string; credits: number }[]
}) {
  const config: ChartConfig = {
    credits: { label: "Credits", color: AMBER },
  }

  return (
    <ChartContainer config={config} className="aspect-[16/7] w-full">
      <BarChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 20 }}>
        <CartesianGrid vertical={false} stroke="#27272a" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
          className="font-mono text-[11px]"
          tickFormatter={formatDayTick}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatDayTick(String(payload?.[0]?.payload?.day ?? ""))}
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value).toLocaleString()} cr
                </span>
              )}
            />
          }
        />
        <Bar dataKey="credits" fill={AMBER} radius={[6, 6, 0, 0]} maxBarSize={56}>
          <LabelList
            dataKey="credits"
            position="top"
            className="fill-muted-foreground font-mono text-[11px] tabular-nums"
            formatter={(value) => Number(value).toLocaleString()}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

// Average latency (24h) — REAL hourly mean responseTimeMs from uptime samples,
// cyan area with a gradient fill fading to transparent.
const CYAN = "#22d3ee"

export function LatencyChart({
  data,
}: {
  data: { t: string; ms: number }[]
}) {
  const config: ChartConfig = {
    ms: { label: "Latency", color: CYAN },
  }

  return (
    <ChartContainer config={config} className="aspect-[16/7] w-full">
      <AreaChart accessibilityLayer data={data} margin={{ left: 0, right: 0, top: 12 }}>
        <defs>
          <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity={0.35} />
            <stop offset="100%" stopColor={CYAN} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#27272a" />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          className="font-mono text-[11px]"
          tickFormatter={formatHourTick}
        />
        <YAxis hide domain={[0, "dataMax + 50"]} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatHourTick(String(payload?.[0]?.payload?.t ?? ""))}
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {Number(value).toLocaleString()} ms
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="ms"
          type="monotone"
          stroke={CYAN}
          strokeWidth={2}
          fill="url(#latencyFill)"
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
