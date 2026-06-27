import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { getRuntimeKey, listRuntimeKeys } from "@/lib/openrouter-provisioning"

// OpenRouter's key API returns `name` as the human-readable name we set at mint
// and `label` as the MASKED KEY STRING (`sk-or-v1-...`). These tests pin that we
// expose the human name as our `label`, since the reconciler matches our keys by
// the `sovereign-` prefix on it.

const HUMAN_NAME = "Sovereign-OpenClaw-foo"
const MASKED_KEY = "sk-or-v1-abc...123"

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

describe("openrouter-provisioning — name/label read-back", () => {
  beforeEach(() => {
    process.env.OPENROUTER_PROVISIONING_KEY = "test-provisioning-key"
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.OPENROUTER_PROVISIONING_KEY
  })

  it("getRuntimeKey exposes the human name (not the masked key) as label", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        data: {
          hash: "hash-1",
          name: HUMAN_NAME,
          label: MASKED_KEY,
          usage: 1.5,
          limit: 10,
          disabled: false,
        },
      }),
    )

    const state = await getRuntimeKey("hash-1")
    expect(state.label).toBe(HUMAN_NAME)
    expect(state.label).not.toBe(MASKED_KEY)
  })

  it("listRuntimeKeys exposes the human name and matches the reconciler's sovereign- prefix", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        data: [
          {
            hash: "hash-1",
            name: HUMAN_NAME,
            label: MASKED_KEY,
            disabled: false,
            limit: 10,
            created_at: "2025-02-19T20:52:27.363244+00:00",
          },
        ],
      }),
    )

    const keys = await listRuntimeKeys()
    expect(keys).toHaveLength(1)
    expect(keys[0].label).toBe(HUMAN_NAME)
    // The reconciler gates orphan-revoke / cap-heal on this prefix match.
    expect(keys[0].label.toLowerCase().startsWith("sovereign-")).toBe(true)
  })

  it("falls back to the masked label only when name is absent (legacy keys)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        data: { hash: "hash-2", label: MASKED_KEY, usage: 0, limit: null, disabled: false },
      }),
    )

    const state = await getRuntimeKey("hash-2")
    expect(state.label).toBe(MASKED_KEY)
  })
})
