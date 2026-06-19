# SovereignML UI Kit — conventions

A shadcn-style React kit (Base UI primitives + Tailwind v4 + class-variance-authority) for **SovereignML's operations console** — a surface for self-hosting AI/LLM instances. The signature look is the **console theme**: a near-black canvas (`#0a0a0b`), `#161618` cards, hairline white-alpha borders, and a **signal-lime** accent (`#a3e635`).

## Setup / wrapping
- Components are themed entirely through CSS-variable tokens carried by `styles.css`. The bundled default surface IS the console theme, so components render on-brand with no wrapper.
- For full fidelity — `dark:` utility variants and the console typography rhythm — wrap a screen's root in `.app-shell.console-dark`:
  ```jsx
  <div className="app-shell console-dark">
    {/* your screen */}
  </div>
  ```
  Without it, components still render with the lime/dark tokens; you only lose the `dark:`-gated polish (e.g. outline/ghost surfaces) and the `.app-shell h1/h2/h3` sizing.
- Fonts ship with the bundle: **ABC Diatype Plus** (sans, the default UI face) and **Ivar Text** (serif, used for display headings like the 404 title). Reference via `var(--font-sans)` / `var(--font-serif)`.

## Styling idiom — Tailwind v4 utilities keyed to tokens
Style with Tailwind utility classes that resolve to the design tokens. Never hard-code hex; use the token utilities so light/console themes both work. Real families present in the bundle:

| Utility | Resolves to | Use for |
|---|---|---|
| `bg-background` / `text-foreground` | canvas / primary ink | page + base text |
| `bg-card` / `text-card-foreground` | `#161618` surface | cards, panels, popovers |
| `bg-primary` / `text-primary-foreground` | signal-lime `#a3e635` / dark ink | primary CTAs, active accents |
| `bg-secondary` / `bg-muted` | `#1d1d20` | neutral fills |
| `text-muted-foreground` | `#a1a1aa` | secondary/meta text |
| `border-border` / `ring-ring` | white-alpha hairline / lime | borders, focus rings |
| `text-destructive` / `bg-destructive/10` | red | errors, destructive actions |
| `--chart-1..5` (`text-[--chart-1]`) | lime/green/cyan/amber/violet | data viz |

Radius scale: `rounded-lg`/`xl`/`2xl` (tokens `--radius-*`, base `--radius: 0.75rem`).

## Compose via component variants (props), not ad-hoc classes
Most visual variation comes from the component's own `variant`/`size` props (cva), not utility classes:
- `Button` — `variant`: `default`|`signal`|`gradient` (all the glossy lime pill), `contrast`, `outline`, `secondary`, `ghost`, `destructive`, `link`; `size`: `xs`|`sm`|`default`|`lg`|`pill`|`icon`(+`icon-xs/-sm/-lg`). The default IS the signature lime CTA.
- `Badge` / `Alert` — `variant`: `default`|`secondary`|`destructive`|`outline`… (`Alert` adds `success`|`warning`).
- Icons: use `lucide-react`; buttons/badges auto-size SVG children.

## Where the truth lives
- Tokens + every utility: the bound `styles.css` and its `@import` closure (`_ds_bundle.css`) — read it before inventing a class.
- Per-component API + usage: each component's `<Name>.d.ts` (props contract) and `<Name>.prompt.md`. Available components include Button, Card, Alert, Badge, Avatar, Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Select, Tooltip, Tabs, Table, Sidebar, Field/Input/InputGroup/Textarea/Label, Toggle/ToggleGroup, Breadcrumb, Progress, Skeleton, Separator, ScrollArea, Empty, ChartContainer, AgentPlan, FlowButton, NotFound, ThemeToggle, Toaster.

## Idiomatic example
```jsx
<div className="app-shell console-dark">
  <Card>
    <CardHeader>
      <CardTitle>prod-inference-01</CardTitle>
      <CardDescription>DigitalOcean · nyc3 · 8 vCPU / 32 GB</CardDescription>
      <CardAction><Button variant="ghost" size="icon-sm"><MoreHorizontal /></Button></CardAction>
    </CardHeader>
    <CardContent className="flex items-center gap-2">
      <Badge>Running</Badge>
      <span className="text-muted-foreground text-sm">Uptime 14d 6h</span>
    </CardContent>
    <CardFooter className="justify-end">
      <Button size="sm">Deploy</Button>
    </CardFooter>
  </Card>
</div>
```
