import { cn } from "@/lib/utils"

// Some runtime marks are a single monochrome glyph (Hermes is a near-white icon)
// rather than a self-contained colored logo (OpenClaw's gradient). A monochrome
// near-white glyph is invisible on the light console, so invert it in light mode
// to read as dark ink and leave it untouched in dark mode. Colored marks must
// never be inverted, so they opt out of the filter entirely.
const MONOCHROME_RUNTIMES = new Set(["hermes"])

export function RuntimeLogo({
  runtime,
  size,
  alt = "",
  className,
}: {
  runtime: string | null | undefined
  size: number
  alt?: string
  className?: string
}) {
  const runtimeId = runtime ?? "openclaw"
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/runtimes/${runtimeId}.svg`}
      alt={alt}
      width={size}
      height={size}
      className={cn(
        "object-contain",
        MONOCHROME_RUNTIMES.has(runtimeId) && "invert dark:invert-0",
        className,
      )}
    />
  )
}
