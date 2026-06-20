"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";

/*
 * Integration constellation.
 *
 * Two rows of dimmed, monochrome tool/model glyphs scrolling in opposite
 * directions, fading out at the left/right edges, with a dark glass "core"
 * orb pinned dead-centre — SovereignML sitting at the heart of your stack.
 *
 * The orb backdrop is the real /assets/integrations/logo-background asset
 * (dark in dark mode, light in light mode). The orange mascot on top is an
 * inline SVG reconstruction — {{TODO: if a final mascot artwork exists, drop
 * it at /public/assets/mascot.svg (or .png) and swap <Mascot/> for it.}}
 */

// `mono: true` marks glyphs drawn with `currentColor` (no inherent brand
// colour) — they render black as a raw <img>, so on hover we invert them to
// white in dark mode rather than revealing a (non-existent) colour.
type Integration = { file: string; name: string; mono?: boolean };

const ROW_ONE: Integration[] = [
  { file: "n8n-color.svg", name: "n8n" },
  { file: "Jira.svg", name: "Jira" },
  { file: "github.svg", name: "GitHub", mono: true },
  { file: "anthropic.svg", name: "Anthropic", mono: true },
  { file: "claude-color.svg", name: "Claude" },
  { file: "mistral-color.svg", name: "Mistral" },
  { file: "meta-color.svg", name: "Meta" },
  { file: "nvidia-color.svg", name: "NVIDIA" },
  { file: "cloudflare-color.svg", name: "Cloudflare" },
  { file: "googlecloud-color.svg", name: "Google Cloud" },
  { file: "microsoft-color.svg", name: "Microsoft" },
  { file: "azure-color.svg", name: "Azure" },
  { file: "vertexai-color.svg", name: "Vertex AI" },
  { file: "openrouter.svg", name: "OpenRouter", mono: true },
];

const ROW_TWO: Integration[] = [
  { file: "openwebui.svg", name: "Open WebUI", mono: true },
  { file: "ollama.svg", name: "Ollama", mono: true },
  { file: "bedrock-color.svg", name: "Bedrock" },
  { file: "moonshot.svg", name: "Moonshot", mono: true },
  { file: "openai.svg", name: "OpenAI", mono: true },
  { file: "gemini-color.svg", name: "Gemini" },
  { file: "qwen-color.svg", name: "Qwen" },
  { file: "deepseek-color.svg", name: "DeepSeek" },
  { file: "minimax-color.svg", name: "MiniMax" },
  { file: "gemma-color.svg", name: "Gemma" },
  { file: "nanobanana-color.svg", name: "Nano Banana" },
  { file: "aistudio.svg", name: "AI Studio", mono: true },
  { file: "elevenlabs.svg", name: "ElevenLabs", mono: true },
];

function IconCell({ item }: { item: Integration }) {
  // Spacing lives on each cell as horizontal margin (not flex `gap`) so two
  // copies of the row tile seamlessly when the marquee wraps at -50%.
  return (
    <li className="group relative mx-2 shrink-0 md:mx-3">
      <span
        role="img"
        aria-label={item.name}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl
                   border border-transparent transition-colors duration-300
                   group-hover:border-white/[0.06] group-hover:bg-white/[0.03] md:h-12 md:w-12"
      >
        {/* Resting state: the SVG is used as a MASK over a top-lit gradient, so
            each glyph is filled with a metallic light-from-above sheen (bright
            top → dim bottom) instead of a flat fill. Fades out on hover. */}
        <span
          aria-hidden
          style={{
            WebkitMaskImage: `url(/assets/icons/${item.file})`,
            maskImage: `url(/assets/icons/${item.file})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
          className="h-6 w-6 md:h-7 md:w-7
                     opacity-50 transition-opacity duration-300 group-hover:opacity-0
                     [background:linear-gradient(180deg,#586079_0%,#2b3149_100%)]
                     dark:[background:linear-gradient(180deg,#fff8ee_0%,#d7cdbd_42%,#8a8073_100%)]
                     [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.4))]
                     dark:[filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.55))_drop-shadow(0_0_5px_rgba(255,228,196,0.12))]"
        />
        {/* Hover state: the real, full-colour brand logo crossfades in on top.
            Mono (currentColor) marks are inverted to white in dark mode so they
            stay visible; colour marks reveal their true brand colours. */}
        <img
          src={`/assets/icons/${item.file}`}
          alt=""
          aria-hidden
          loading="lazy"
          draggable={false}
          className={`absolute h-6 w-6 select-none object-contain opacity-0 transition-opacity duration-300 group-hover:opacity-100 md:h-7 md:w-7 ${
            item.mono ? "dark:[filter:invert(1)]" : ""
          }`}
        />
      </span>
    </li>
  );
}

/*
 * Seamless infinite marquee. The icon set renders twice and the track
 * translates by exactly one copy width (-50%); `direction` flips the keyframes
 * so the two rows scroll against each other.
 */
function Marquee({
  items,
  direction,
  reduce,
}: {
  items: Integration[];
  direction: "left" | "right";
  reduce: boolean | null;
}) {
  if (reduce) {
    return (
      <ul className="flex items-center justify-center">
        {items.map((item) => (
          <IconCell key={item.file} item={item} />
        ))}
      </ul>
    );
  }

  const keyframes = direction === "left" ? ["0%", "-50%"] : ["-50%", "0%"];

  return (
    <div className="flex w-full overflow-hidden">
      <motion.ul
        className="flex w-max flex-none items-center"
        animate={{ x: keyframes }}
        transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
      >
        {[...items, ...items].map((item, i) => (
          <IconCell key={`${item.file}-${i}`} item={item} />
        ))}
      </motion.ul>
    </div>
  );
}

export function IntegrationConstellation() {
  const reduce = useReducedMotion();

  return (
    <section
      aria-label="Integrations"
      className="relative isolate overflow-hidden py-20 md:py-28"
    >
      <div className="relative mx-auto w-full max-w-6xl px-2 sm:px-4">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
            maskImage:
              "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
          }}
        >
          {/* Icon rows */}
          <div className="flex flex-col items-center gap-2 md:gap-3">
            <Marquee items={ROW_ONE} direction="left" reduce={reduce} />
            <Marquee items={ROW_TWO} direction="right" reduce={reduce} />
          </div>

          {/* Center pocket — fades icons out behind the orb in the page's own
              background colour, so it works in both themes. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-72 -translate-x-1/2 -translate-y-1/2"
            style={{
              background:
                "radial-gradient(closest-side, var(--background) 30%, color-mix(in srgb, var(--background) 70%, transparent) 55%, transparent 75%)",
            }}
          />

          {/* Center hub orb */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, amount: 0.5 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              className="relative grid h-[108px] w-[108px] place-items-center md:h-[124px] md:w-[124px]"
            >
              {/* Light mode keeps the white glass orb behind the navy mark.
                  Dark mode has NO orb disc — it read as a shadow blob; the mark
                  floats over the neutral centre pocket instead. */}
              <Image
                src="/assets/integrations/logo-background.avif"
                alt=""
                aria-hidden
                width={248}
                height={248}
                className="absolute inset-0 block h-full w-full rounded-full object-cover dark:hidden"
              />

              {/* Brand mark — light monochrome on the dark orb, full-colour
                  navy on the light orb. Sized to leave a rim of orb around it. */}
              <Image
                src="/assets/icons/Light-Monochrome-SovereignML.png"
                alt=""
                aria-hidden
                width={180}
                height={194}
                className="relative hidden h-[84px] w-auto object-contain md:h-[96px] dark:block"
                style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.45))" }}
              />
              <Image
                src="/assets/icons/Blue-Navy-SovereignML.png"
                alt=""
                aria-hidden
                width={180}
                height={194}
                className="relative block h-[84px] w-auto object-contain md:h-[96px] dark:hidden"
              />
              <span className="sr-only">SovereignML</span>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
