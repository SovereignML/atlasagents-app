"use client";

import { useEffect, useRef, useCallback } from "react";
import { useReducedMotion } from "framer-motion";
import Link from "next/link";

/*
 * Exact Antimetal integration-wheel port.
 *
 * Mechanics (from integrations.js):
 *   - N icons placed on a 630 px-wide circle (radius = 315 px on desktop).
 *   - Each icon is positioned via  translate(-50%,-50%) rotate(angle)
 *     on an outer wrapper; the inner div has  top: -315px  and a counter-
 *     rotate so the logo stays upright.
 *   - Every 2 500 ms the JS adds  stepAngle = 360/N  to every item, so
 *     one new icon slides into the "active" 90° slot.
 *   - Active icon  = 116 px,  1-away = 96 px,  2+ away = 76 px.
 *   - A conic-gradient mask hides the bottom half of the arc.
 *   - Custom spring easing via CSS  transition-duration: 1s.
 *
 * We render third-party integration logos from the assets folder.
 */

const INTEGRATIONS = [
  { src: "github",       alt: "GitHub",       hasDark: true,  padding: "16px" },
  { src: "slack",        alt: "Slack",        hasDark: false, padding: "16px" },
  { src: "aws",          alt: "AWS",          hasDark: true,  padding: "12px" },
  { src: "vercel",       alt: "Vercel",       hasDark: true,  padding: "16px" },
  { src: "sentry",       alt: "Sentry",       hasDark: true,  padding: "12px" },
  { src: "linear",       alt: "Linear",       hasDark: true,  padding: "16px" },
  { src: "gcp",          alt: "Google Cloud", hasDark: false, padding: "12px" },
  { src: "cloudflare",   alt: "Cloudflare",   hasDark: false, padding: "12px" },
  { src: "pagerduty",    alt: "PagerDuty",    hasDark: false, padding: "12px" },
  { src: "prometheus",   alt: "Prometheus",   hasDark: false, padding: "12px" },
  { src: "azure",        alt: "Azure",        hasDark: false, padding: "12px" },
  { src: "planetscale",  alt: "PlanetScale",  hasDark: false, padding: "12px" },
  { src: "wiz",          alt: "Wiz",          hasDark: false, padding: "16px" },
  { src: "oracle",       alt: "Oracle Cloud", hasDark: false, padding: "12px" },
];

const N = INTEGRATIONS.length;
const STEP = 360 / N;

// The wheel advances one step every TICK_MS. The steady centre logo flashes a
// shine on each tick, in parallel with the new icon sliding into place.
const TICK_MS = 2500;

export function AgentWheel() {
  const reduceMotion = useReducedMotion();
  const circleRef = useRef<HTMLDivElement>(null);
  const popupTextRef = useRef<HTMLSpanElement>(null);
  const popupImgLightRef = useRef<HTMLImageElement>(null);
  const popupImgDarkRef = useRef<HTMLImageElement>(null);
  const shineRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef<
    {
      wrapper: HTMLDivElement;
      inner: HTMLDivElement;
      images: HTMLImageElement[];
      currentAngle: number;
    }[]
  >([]);

  /* ── Initialise refs after mount ─────────────────────────────── */
  const initRefs = useCallback((container: HTMLDivElement | null) => {
    if (!container) return;
    circleRef.current = container;

    const wrappers = container.querySelectorAll<HTMLDivElement>(
      ".int-circle-transition-outer"
    );

    itemsRef.current = Array.from(wrappers).map((w, i) => {
      const initialAngle = i * STEP + 90;
      const inner = w.querySelector<HTMLDivElement>(".int-circle-transition-inner")!;
      const images = Array.from(w.querySelectorAll<HTMLImageElement>("img.int-circle-logo"));

      w.style.transform = `translate(-50%, -50%) rotate(${initialAngle}deg)`;
      inner.style.transform = `rotate(${-initialAngle}deg)`;

      return { wrapper: w, inner, images, currentAngle: initialAngle };
    });
  }, []);

  /* ── Tick loop (identical to integrations.js) ─────────────────── */
  useEffect(() => {
    const items = itemsRef.current;
    if (!items.length) return;

    function updateSizes() {
      let activeItem: (typeof items)[0] | null = null;
      let minDiff = Infinity;

      items.forEach((item) => {
        let norm = item.currentAngle % 360;
        if (norm < 0) norm += 360;
        let diff = Math.abs(norm - 90);
        if (diff > 180) diff = 360 - diff;
        (item as { _diff?: number })._diff = diff;
        if (diff < minDiff) {
          minDiff = diff;
          activeItem = item;
        }
      });

      const isDesktop = window.innerWidth >= 1024;
      const maxSize = isDesktop ? 116 : 90;
      const step1Size = isDesktop ? 96 : 90 * (96 / 116);
      const step2Size = isDesktop ? 76 : 90 * (76 / 116);
      const minSize = step2Size;

      items.forEach((item) => {
        const stepsAway = Math.round(((item as { _diff?: number })._diff ?? 0) / STEP);
        let size: number;
        if (stepsAway === 0) size = maxSize;
        else if (stepsAway === 1) size = step1Size;
        else if (stepsAway === 2) size = step2Size;
        else size = minSize;

        item.wrapper.style.width = `${size}px`;
        item.wrapper.style.height = `${size}px`;

        item.images.forEach((img) => {
          img.style.padding = "10%";
        });
      });

      // Update popup
      if (activeItem && popupTextRef.current && popupImgLightRef.current && popupImgDarkRef.current) {
        const ai = activeItem as (typeof items)[0];
        const lightImg = ai.images[0];
        const darkImg = ai.images.length >= 2 ? ai.images[1] : ai.images[0];
        if (lightImg?.alt) popupTextRef.current.textContent = lightImg.alt;
        if (lightImg?.src) popupImgLightRef.current.src = lightImg.src;
        if (darkImg?.src) popupImgDarkRef.current.src = darkImg.src;
      }
    }

    updateSizes();

    // Respect "Reduce Motion": size the icons once, but don't auto-rotate.
    if (reduceMotion) return;

    const interval = setInterval(() => {
      items.forEach((item) => {
        item.currentAngle += STEP;
        item.wrapper.style.transform = `translate(-50%, -50%) rotate(${item.currentAngle}deg)`;
        item.inner.style.transform = `rotate(${-item.currentAngle}deg)`;
      });

      // Flash the hub shine in parallel with the incoming icon. Re-add the
      // class after a forced reflow so the keyframes restart every tick.
      const shine = shineRef.current;
      if (shine) {
        shine.classList.remove("is-shining");
        void shine.offsetWidth;
        shine.classList.add("is-shining");
      }

      setTimeout(updateSizes, 50);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [reduceMotion]);

  return (
    <section className="relative overflow-hidden" id="agents">
      {/* ── Container matching Antimetal layout ── */}
      <div className="relative mx-auto max-w-[976px] pt-[433px] pb-[50px] max-lg:px-[31px] lg:pt-[321px] lg:pb-[369px]">
        {/* ── Text block (left on desktop, centred on mobile) ── */}
        <div className="relative z-10 max-w-[484px] max-lg:mx-auto max-lg:text-center">
          <div className="mb-4 flex items-center gap-3 max-lg:justify-center lg:mb-6 lg:gap-3">
            <svg fill="none" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg">
              <circle cx="6.75" cy="17.25" fill="var(--color-text-loud, #e8e6e3)" r="3.75" />
              <circle cx="17.25" cy="6" fill="var(--color-text-loud, #e8e6e3)" r="3" />
              <path d="M10.57 13.16L13.92 9.57" opacity="0.32" stroke="var(--color-text-loud, #e8e6e3)" strokeLinecap="round" strokeWidth="1.5" />
              <circle cx="18.75" cy="16.5" fill="var(--color-text-muted, #666)" opacity="0.32" r="2.25" />
              <circle cx="6" cy="6" fill="var(--color-text-muted, #666)" opacity="0.32" r="2.25" />
            </svg>
            <div className="text-[15px] font-medium text-text-loud lg:text-[17px]">
              Integrations
            </div>
          </div>

          <h2 className="mb-4 text-text-loud text-[clamp(2rem,4vw,48px)] font-bold tracking-[-1.5px] lg:mb-5">
          Works with your stack, not against it.
          </h2>

          <p className="mb-6 text-base text-text-secondary max-lg:mx-auto max-lg:max-w-[280px] lg:mb-8 lg:text-text-default">
            <span className="text-text-secondary">Monitoring, code, observability, cloud, </span>
            CI/CD systems, messaging, and even homegrown tooling.
          </p>

          <Link
            href="/login?deploy=true"
            className="btn-integration-get-started max-lg:mx-auto"
          >
            Connect your stack
          </Link>

          {/* ── Popup pill (desktop only) ── */}
          <div className="absolute top-[calc(100%+59px)] left-0 max-lg:hidden">
            <div className="relative rounded-full" style={{ border: "1px solid var(--color-border-faint)" }}>
              <div className="relative overflow-clip" style={{ width: "auto" }}>
                <div className="w-max whitespace-nowrap">
                  <div className="flex gap-1.5 p-1.5 pr-4 items-center">
                    <div className="will-change-transform" style={{ opacity: 1, transform: "none" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={popupImgLightRef}
                        decoding="async"
                        alt="GitHub"
                        className="w-6 h-6 dark:hidden"
                        loading="lazy"
                        src="/assets/integrations/github.avif"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        ref={popupImgDarkRef}
                        decoding="async"
                        alt="GitHub"
                        className="w-6 h-6 hidden dark:block"
                        loading="lazy"
                        src="/assets/integrations/github-dark.avif"
                      />
                    </div>
                    <span ref={popupTextRef} className="text-text-loud text-sm font-medium">
                      GitHub
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Horizontal line across centre (desktop) ── */}
        <div
          className="absolute left-[calc(50%+4px)] w-[720px] opacity-[0.04] max-lg:hidden"
          style={{
            height: 1,
            top: "50%",
            background: "linear-gradient(270deg, var(--color-background-plain) 0%, var(--color-text-loud, #e8e6e3) 50%, var(--color-text-loud, #e8e6e3) 80%, var(--color-background-plain) 100%)",
          }}
        />

        {/* ── Centre hub (logo pill) ── */}
        <div
          className="int-center-hub absolute rounded-full p-4 lg:p-5"
          style={{ border: "1px solid var(--color-border-faint)" }}
        >
          <div className="relative w-[117px] h-[117px] lg:w-[156px] lg:h-[156px] mx-auto flex items-center justify-center rounded-full shadow-lg"
            style={{ background: "var(--card-bg, rgba(255,255,255,0.06))" }}
          >
            {/* Same soft halo the orbiting icon nodes use, so the hub reads as
                one of them — just held steady at the centre. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              decoding="async"
              alt=""
              aria-hidden
              className="pointer-events-none absolute -left-full -top-full max-w-none dark:hidden"
              style={{ width: "300%", height: "300%" }}
              src="/assets/integrations/logo-background.avif"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              decoding="async"
              alt=""
              aria-hidden
              className="pointer-events-none absolute -left-full -top-full hidden max-w-none dark:block"
              style={{ width: "300%", height: "300%" }}
              src="/assets/integrations/logo-background-dark.avif"
            />

            {/* SovereignML brand mark — navy on light, white on dark */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/icons/Blue-Navy-SovereignML.png"
              alt="SovereignML"
              draggable={false}
              className="relative z-10 block w-[61px] h-auto select-none object-contain lg:w-[79px] dark:hidden"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/icons/SovereignML-logo-white.svg"
              alt=""
              aria-hidden
              draggable={false}
              className="relative z-10 hidden w-[61px] h-auto select-none object-contain lg:w-[79px] dark:block"
            />

            {/* Shine — a light sweep across the hub, retriggered from the wheel
                tick loop each time a new icon slides in. Clipped to the circle;
                no shine under reduced motion (the tick loop doesn't run). */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-full"
            >
              <span ref={shineRef} className="int-hub-shine absolute inset-0" />
            </span>
          </div>
        </div>

        {/* ── The orbital circle ── */}
        <div className="int-circle-outer absolute pointer-events-none int-circle-wrapper">
          {/* Inner 630px ring with border */}
          <div
            ref={initRefs}
            className="int-circle-ring absolute"
          >
            {/* Orbital ring border */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                border: "1px solid var(--color-border-faint)",
                mask: "linear-gradient(to left, rgba(0,0,0,0.06) 0%, transparent 100%)",
                WebkitMask: "linear-gradient(to left, rgba(0,0,0,0.06) 0%, transparent 100%)",
              }}
            />

            {/* ── All integration icon nodes ── */}
            {INTEGRATIONS.map((item, i) => {
              const initialAngle = i * STEP + 90;
              return (
                <div
                  key={item.src}
                  className="int-circle-transition-outer absolute top-1/2 left-1/2"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${initialAngle}deg)`,
                    width: 80,
                    height: 80,
                    transition: "transform 1s, width 1s, height 1s",
                    transitionTimingFunction: "linear(0, 0.026 1.8%, 0.108 3.9%, 0.59 12.2%, 0.792 16.5%, 0.931 21%, 0.978 23.4%, 1.01 25.9%, 1.033 29.3%, 1.04 33.3%, 1.001 56.9%, 1)",
                  }}
                >
                  <div
                    className="int-circle-transition-inner absolute left-0 w-full h-full rounded-full"
                    style={{
                      top: -315,
                      transform: `rotate(${-initialAngle}deg)`,
                      transition: "transform 1s",
                      transitionTimingFunction: "linear(0, 0.026 1.8%, 0.108 3.9%, 0.59 12.2%, 0.792 16.5%, 0.931 21%, 0.978 23.4%, 1.01 25.9%, 1.033 29.3%, 1.04 33.3%, 1.001 56.9%, 1)",
                    }}
                  >
                    {/* Logo background glow */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      decoding="async"
                      alt="logo background"
                      className="absolute -left-full -top-full max-w-none dark:hidden"
                      style={{ width: "300%", height: "300%" }}
                      loading="lazy"
                      src="/assets/integrations/logo-background.avif"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      decoding="async"
                      alt="logo background"
                      className="absolute -left-full -top-full max-w-none hidden dark:block"
                      style={{ width: "300%", height: "300%" }}
                      loading="lazy"
                      src="/assets/integrations/logo-background-dark.avif"
                    />

                    {/* The icon itself */}
                    {item.hasDark ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          decoding="async"
                          alt={item.alt}
                          className="int-circle-logo relative h-full w-full rounded-full dark:hidden"
                          style={{
                            padding: item.padding,
                            transition: "filter 450ms cubic-bezier(0.16,1,0.3,1), padding 450ms cubic-bezier(0.16,1,0.3,1)",
                          }}
                          loading="lazy"
                          src={`/assets/integrations/${item.src}.avif`}
                        />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          decoding="async"
                          alt={item.alt}
                          className="int-circle-logo relative h-full w-full rounded-full hidden dark:block"
                          style={{
                            padding: item.padding,
                            transition: "filter 450ms cubic-bezier(0.16,1,0.3,1), padding 450ms cubic-bezier(0.16,1,0.3,1)",
                          }}
                          loading="lazy"
                          src={`/assets/integrations/${item.src}-dark.avif`}
                        />
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        decoding="async"
                        alt={item.alt}
                        className="int-circle-logo relative h-full w-full rounded-full"
                        style={{
                          padding: item.padding,
                          transition: "filter 450ms cubic-bezier(0.16,1,0.3,1), padding 450ms cubic-bezier(0.16,1,0.3,1)",
                        }}
                        loading="lazy"
                        src={`/assets/integrations/${item.src}.avif`}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* ── Bottom separator ── */}
      <div className="px-[31px]">
        <div className="mx-auto h-px max-w-[976px]" style={{
          background: "linear-gradient(to right, rgba(0,0,0,0) 0%, var(--color-border-faint) 35%, var(--color-border-faint) 65%, rgba(0,0,0,0) 100%)",
        }} />
      </div>
    </section>
  );
}
