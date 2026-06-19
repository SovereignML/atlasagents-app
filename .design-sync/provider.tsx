// design-sync: preview wrapper for every Design-pane card.
// The SovereignML console tokens + `dark:` utilities key off the
// `.app-shell.console-dark` class chain (see globals.css). Wrapping every
// preview in it gives each card the brand's near-black canvas, signal-lime
// accent, app-shell typography rhythm, and the dark-variant polish the
// components expect — without each authored preview repeating the wrapper.
import * as React from "react";
// Some components (e.g. NotFound) call next/navigation's useRouter(), which
// throws "invariant expected app router to be mounted" with no AppRouterContext.
// Provide a no-op router so those previews render. Same module path the bundle's
// useRouter reads, so the context instance matches.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const noop = () => {};
const mockRouter = {
  push: noop,
  replace: noop,
  back: noop,
  forward: noop,
  refresh: noop,
  prefetch: noop,
} as unknown as React.ContextType<typeof AppRouterContext>;

export function ConsoleShell({ children }: { children?: React.ReactNode }) {
  return (
    <AppRouterContext.Provider value={mockRouter}>
      <div
        className="app-shell console-dark"
        style={{
          padding: 24,
          background: "var(--background)",
          color: "var(--foreground)",
          minHeight: "100%",
        }}
      >
        {children}
      </div>
    </AppRouterContext.Provider>
  );
}
