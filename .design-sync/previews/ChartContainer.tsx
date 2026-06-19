import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "sovereign";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

const REQUESTS = [
  { day: "Mon", requests: 8200 },
  { day: "Tue", requests: 9400 },
  { day: "Wed", requests: 11200 },
  { day: "Thu", requests: 10600 },
  { day: "Fri", requests: 13900 },
  { day: "Sat", requests: 7300 },
  { day: "Sun", requests: 6100 },
];

const SPEND = [
  { week: "W1", spend: 284 },
  { week: "W2", spend: 312 },
  { week: "W3", spend: 376 },
  { week: "W4", spend: 421 },
];

const LIME = "var(--chart-1)";
const GREEN = "var(--chart-2)";

export function RequestVolumeArea() {
  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>
        Inference requests · last 7 days
      </div>
      <ChartContainer
        config={{ requests: { label: "Requests", color: LIME } }}
        style={{ display: "block", width: 480, height: 220, aspectRatio: "auto" }}
      >
        <AreaChart width={480} height={220} data={REQUESTS} margin={{ left: 0, right: 8, top: 12 }}>
          <defs>
            <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LIME} stopOpacity={0.4} />
              <stop offset="100%" stopColor={LIME} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#27272a" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            className="font-mono text-[11px]"
          />
          <YAxis hide domain={[0, "dataMax + 1500"]} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums">
                    {Number(value).toLocaleString()} req
                  </span>
                )}
              />
            }
          />
          <Area
            dataKey="requests"
            type="monotone"
            stroke={LIME}
            strokeWidth={2}
            fill="url(#reqFill)"
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export function SpendBar() {
  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 4 }}>
        Monthly spend · by week
      </div>
      <ChartContainer
        config={{ spend: { label: "Spend", color: GREEN } }}
        style={{ display: "block", width: 440, height: 220, aspectRatio: "auto" }}
      >
        <BarChart width={440} height={220} data={SPEND} margin={{ left: 0, right: 8, top: 12 }}>
          <CartesianGrid vertical={false} stroke="#27272a" />
          <XAxis
            dataKey="week"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            className="font-mono text-[11px]"
          />
          <YAxis hide domain={[0, "dataMax + 80"]} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums">
                    ${Number(value).toLocaleString()}
                  </span>
                )}
              />
            }
          />
          <Bar dataKey="spend" fill={GREEN} radius={[6, 6, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
