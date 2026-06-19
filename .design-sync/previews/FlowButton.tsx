import { FlowButton } from "sovereign";

// FlowButton ships with its own light-surface styling (dark text + hairline
// border, lime/black fill on hover). Place it on a light panel so its intended
// contrast reads — wrapper is layout/surface glue only; the button is untouched.
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        padding: 32,
        borderRadius: 16,
        background: "#f5f5f4",
        border: "1px solid var(--border)",
      }}
    >
      {children}
    </div>
  );
}

export function Default() {
  return (
    <Panel>
      <FlowButton />
    </Panel>
  );
}

export function CallToAction() {
  return (
    <Panel>
      <FlowButton text="Get started" />
      <FlowButton text="Deploy instance" />
      <FlowButton text="View pricing" />
    </Panel>
  );
}
