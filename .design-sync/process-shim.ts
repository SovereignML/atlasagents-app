// design-sync: browser shim for `process`.
// The UI kit transitively pulls modules that read `process.env.X` at runtime
// (Next.js router helpers, etc.). In the Design pane there is no Node `process`,
// so those bare lookups throw "process is not defined" and crash the render.
// Defining an empty env makes every non-NODE_ENV lookup resolve to undefined.
// Imported FIRST in entry.ts so it runs before any component module evaluates.
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
if (typeof g.process === "undefined") {
  g.process = { env: {} };
} else if (typeof g.process.env === "undefined") {
  g.process.env = {};
}
export {};
