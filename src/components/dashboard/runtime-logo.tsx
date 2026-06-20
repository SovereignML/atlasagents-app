import { cn } from "@/lib/utils"

// Some runtime marks are a single monochrome glyph (Hermes is a detailed
// near-white portrait) rather than a self-contained colored logo (OpenClaw's
// gradient). The glyph is drawn as dark ink: it reads crisply when inverted to
// dark-on-light, but filling it light-on-dark collapses the facial detail into
// a featureless white blob. So we always invert it to dark ink and, in dark
// mode, sit it on a light plaque so it keeps its (correct) light-mode look.
// Colored marks must never be inverted, so they opt out of this entirely.
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
  const isMonochrome = MONOCHROME_RUNTIMES.has(runtimeId)

  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/runtimes/${runtimeId}.svg`}
      alt={alt}
      width={size}
      height={size}
      className={cn("object-contain", isMonochrome && "invert", className)}
    />
  )

  if (!isMonochrome) return img

  // The plaque only renders in dark mode (transparent in light, so the glyph
  // sits on the surrounding surface exactly as before). The `invert` filter
  // lives on the inner <img> — putting the light background on the same element
  // would get inverted to dark along with the glyph.
  return (
    <span className="inline-grid place-items-center rounded-[22%] dark:bg-zinc-200">
      {img}
    </span>
  )
}
