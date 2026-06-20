import { PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Logo = {
  src: string;
  alt: string;
  /**
   * Optional dark-mode source. When provided, `src` is shown in light mode and
   * `darkSrc` in dark mode, and the brightness/invert filter is skipped (use
   * this for logos that ship pre-rendered light/dark variants, e.g. badges).
   */
  darkSrc?: string;
  /**
   * Render the logo large enough to fill the card (used for badge-style marks
   * like the NVIDIA Inception lockup, which look lost at wordmark height).
   */
  fill?: boolean;
  /**
   * Keep the card cell (border/background) in the grid but make the logo image
   * itself invisible — use to temporarily drop a logo without changing layout.
   */
  hidden?: boolean;
  width?: number;
  height?: number;
};

type LogoCloudProps = React.ComponentProps<"div">;

export function LogoCloud({ className, ...props }: LogoCloudProps) {
  return (
    <div
      className={cn(
        "relative grid grid-cols-3 border-x",
        className
      )}
      {...props}
    >
      <div className="-translate-x-1/2 -top-px pointer-events-none absolute left-1/2 w-screen border-t" />

      {/* ── Row 1 ── */}
      <LogoCard
        className="relative border-r border-b bg-secondary p-2 md:p-2 dark:bg-secondary/30"
        logo={{
          src: "/assets/Programs/Nvidia_Inception_Light.png",
          darkSrc: "/assets/Programs/Nvidia_Inception_Dark.png",
          alt: "NVIDIA Inception Program",
          fill: true,
        }}
      >
        <PlusIcon
          className="-right-[12.5px] -bottom-[12.5px] absolute z-10 size-6"
          strokeWidth={1}
        />
      </LogoCard>

      <LogoCard
        className="relative border-r border-b p-4 md:p-4"
        logo={{
          src: "/assets/Programs/Digital_Ocean_Light.png",
          darkSrc: "/assets/Programs/Digital_Ocean_Dark.png",
          alt: "DigitalOcean",
          fill: true,
        }}
      >
        <PlusIcon
          className="-right-[12.5px] -bottom-[12.5px] absolute z-10 size-6"
          strokeWidth={1}
        />
      </LogoCard>

      <LogoCard
        className="border-b bg-secondary p-4 md:p-4 dark:bg-secondary/30"
        logo={{
          src: "/assets/Programs/Microsoft_Light.png",
          darkSrc: "/assets/Programs/Microsoft_Dark.png",
          alt: "Microsoft",
          fill: true,
        }}
      />

      {/* ── Row 2 ── */}
      <LogoCard
        className="border-r bg-background p-4 md:p-4"
        logo={{
          src: "/assets/Programs/OVH_cloud_Light.png",
          darkSrc: "/assets/Programs/OVH_cloud_Dark.png",
          alt: "OVHcloud",
          fill: true,
        }}
      />

      <LogoCard
        className="border-r bg-secondary p-4 md:p-4 dark:bg-secondary/30"
        logo={{
          src: "/assets/Programs/Cloudflare_lIght.png",
          darkSrc: "/assets/Programs/Cloudflare_Dark.png",
          alt: "Cloudflare",
          fill: true,
        }}
      />

      <LogoCard
        className="p-4 md:p-4"
        logo={{
          src: "/assets/Programs/Akamai_Light.png",
          darkSrc: "/assets/Programs/Akamai_Dark.png",
          alt: "Akamai",
          fill: true,
        }}
      />

      <div className="-translate-x-1/2 -bottom-px pointer-events-none absolute left-1/2 w-screen border-b" />
    </div>
  );
}

type LogoCardProps = React.ComponentProps<"div"> & {
  logo: Logo;
};

function LogoCard({ logo, className, children, ...props }: LogoCardProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-background px-4 py-8 md:p-8",
        className
      )}
      {...props}
    >
      {logo.darkSrc ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={logo.alt}
            className={cn(
              "pointer-events-none select-none dark:hidden",
              logo.fill
                ? "h-full max-h-24 w-full object-contain"
                : "h-4 md:h-5",
              logo.hidden && "invisible"
            )}
            height={logo.height || "auto"}
            src={logo.src}
            width={logo.width || "auto"}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={logo.alt}
            className={cn(
              "pointer-events-none hidden select-none dark:block",
              logo.fill
                ? "h-full max-h-24 w-full object-contain"
                : "h-4 md:h-5",
              logo.hidden && "invisible"
            )}
            height={logo.height || "auto"}
            src={logo.darkSrc}
            width={logo.width || "auto"}
          />
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={logo.alt}
          className={cn(
            "pointer-events-none h-4 select-none md:h-5 dark:brightness-0 dark:invert",
            logo.hidden && "invisible"
          )}
          height={logo.height || "auto"}
          src={logo.src}
          width={logo.width || "auto"}
        />
      )}
      {children}
    </div>
  );
}
