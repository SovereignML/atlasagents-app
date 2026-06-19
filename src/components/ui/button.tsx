"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The brand default IS the glossy primary pill — every implicit-default
        // button renders the signature CTA. Parameterized on --primary so it
        // adapts per surface: signal-lime inside the console (app-shell), and
        // the marketing primary (blue/amber) on the marketing site / shared
        // chrome like the consent banner. Authors pick outline/ghost/secondary
        // where a neutral action is intended.
        default:
          "rounded-[10px] border-none font-semibold text-primary-foreground bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_82%,white),var(--primary))] shadow-[0_6px_20px_color-mix(in_oklch,var(--primary)_38%,transparent),inset_0_1px_oklch(1_0_0/0.45)] hover:-translate-y-0.5 hover:shadow-[0_8px_26px_color-mix(in_oklch,var(--primary)_50%,transparent),inset_0_1px_oklch(1_0_0/0.45)] active:translate-y-0",
        // Brand signature: the glossy signal-lime pill with glow + inset
        // highlight. Built from Tailwind utilities (not the fixed-size
        // .btn-antimetal class) so it composes with every `size`. `signal`,
        // `gradient`, and `default` all share this treatment.
        signal:
          "rounded-[10px] border-none font-semibold text-primary-foreground bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_82%,white),var(--primary))] shadow-[0_6px_20px_color-mix(in_oklch,var(--primary)_38%,transparent),inset_0_1px_oklch(1_0_0/0.45)] hover:-translate-y-0.5 hover:shadow-[0_8px_26px_color-mix(in_oklch,var(--primary)_50%,transparent),inset_0_1px_oklch(1_0_0/0.45)] active:translate-y-0",
        gradient:
          "rounded-[10px] border-none font-semibold text-primary-foreground bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary)_82%,white),var(--primary))] shadow-[0_6px_20px_color-mix(in_oklch,var(--primary)_38%,transparent),inset_0_1px_oklch(1_0_0/0.45)] hover:-translate-y-0.5 hover:shadow-[0_8px_26px_color-mix(in_oklch,var(--primary)_50%,transparent),inset_0_1px_oklch(1_0_0/0.45)] active:translate-y-0",
        // Solid inline action ("Open", "Add rule") — high-contrast neutral.
        contrast:
          "rounded-[10px] bg-foreground text-background hover:bg-foreground/90",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-lg px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded-xl px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 rounded-xl px-6 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        pill: "h-12 gap-3 rounded-full px-9 text-base font-semibold",
        icon: "size-9 rounded-xl",
        "icon-xs": "size-6 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-xl",
        "icon-lg": "size-10 rounded-xl",
      },
    },
    // The glossy primary button keeps its dense 10px radius at every size. Size
    // variants set their own `rounded-*`, which tailwind-merge would otherwise
    // keep over the variant's radius; this compound re-asserts the shape last.
    compoundVariants: [
      {
        variant: ["default", "signal", "gradient"],
        size: ["xs", "sm", "lg", "pill"],
        className: "rounded-[10px]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // When the caller passes `render` (e.g. <Link/>, <a/>), Base UI renders that
  // element instead of <button>. Its default `nativeButton: true` then warns
  // because the rendered root is not a real <button>. Default to `false` in
  // that case so consumers can write `render={<Link/>}` without ceremony, but
  // still let callers override explicitly.
  const resolvedNativeButton =
    nativeButton ?? (render === undefined ? undefined : false)

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={render}
      nativeButton={resolvedNativeButton}
      {...props}
    />
  )
}

export { Button, buttonVariants }
