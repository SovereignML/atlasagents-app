import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { CLI_GATEWAY_SOURCE } from "./cli-gateway"

/**
 * The gateway's Gemini API → OpenRouter translation (Gemini CLI boxes), on the
 * exact source that ships, imported with ATLAS_GATEWAY_NO_LISTEN=1.
 */
type Json = Record<string, unknown>
type Gemini = {
  geminiSchema(s: unknown): unknown
  resolveGeminiModel(name: string, allowed: string[], fallback: string): string
  geminiToOpenAI(body: Json, model: string, stream: boolean): Json & { messages: Json[]; tools?: Json[] }
  openAIToGemini(resp: Json, model: string): { candidates: { content: { parts: Json[] }; finishReason: string }[]; usageMetadata?: Json }
  createGeminiStream(model: string): { push(d: Json): Json[]; end(): Json & { candidates: { content: { parts: Json[] }; finishReason: string }[]; usageMetadata?: Json } }
}

let gw: Gemini
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "atlas-gw-gemini-"))
  const file = join(dir, "gateway.mjs")
  writeFileSync(file, CLI_GATEWAY_SOURCE)
  process.env.ATLAS_GATEWAY_NO_LISTEN = "1"
  gw = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Gemini
})

afterAll(() => {
  delete process.env.ATLAS_GATEWAY_NO_LISTEN
  rmSync(dir, { recursive: true, force: true })
})

describe("resolveGeminiModel", () => {
  const allowed = ["google/gemini-3.8-flash", "google/gemini-4-argon"]
  it("maps a Gemini name to the agent's google/ slug", () => {
    expect(gw.resolveGeminiModel("gemini-4-argon", allowed, "google/gemini-3.8-flash")).toBe("google/gemini-4-argon")
    expect(gw.resolveGeminiModel("models/gemini-4-argon", allowed, "x")).toBe("google/gemini-4-argon")
  })
  it("runs any other model the CLI names on the agent's model", () => {
    expect(gw.resolveGeminiModel("gemini-2.5-flash-lite", allowed, "google/gemini-3.8-flash")).toBe("google/gemini-3.8-flash")
  })
})

describe("geminiSchema", () => {
  it("lowercases Gemini's type enums and drops propertyOrdering, recursively", () => {
    expect(
      gw.geminiSchema({
        type: "OBJECT",
        propertyOrdering: ["a"],
        properties: { a: { type: "STRING" }, b: { type: "ARRAY", items: { type: "INTEGER" } } },
        required: ["a"],
      }),
    ).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "array", items: { type: "integer" } } },
      required: ["a"],
    })
  })
})

describe("geminiToOpenAI", () => {
  it("translates system, turns, tool calls and tool results", () => {
    const out = gw.geminiToOpenAI(
      {
        systemInstruction: { parts: [{ text: "Be brief." }] },
        contents: [
          { role: "user", parts: [{ text: "List files" }] },
          { role: "model", parts: [{ text: "Sure.", thought: false }, { functionCall: { name: "ls", args: { dir: "." } } }] },
          { role: "user", parts: [{ functionResponse: { name: "ls", response: { output: "a.txt" } } }] },
          { role: "model", parts: [{ text: "thinking…", thought: true }, { text: "One file." }] },
        ],
        tools: [{ functionDeclarations: [{ name: "ls", description: "List", parametersJsonSchema: { type: "object", properties: { dir: { type: "string" } } } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 100, thinkingConfig: { thinkingBudget: 512 } },
      },
      "google/gemini-3.8-flash",
      true,
    )
    expect(out.model).toBe("google/gemini-3.8-flash")
    expect(out.stream).toBe(true)
    expect(out.stream_options).toEqual({ include_usage: true })
    expect(out.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "List files" },
      {
        role: "assistant",
        content: "Sure.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "ls", arguments: '{"dir":"."}' } }],
      },
      { role: "tool", tool_call_id: "call_1", content: '{"output":"a.txt"}' },
      { role: "assistant", content: "One file." },
    ])
    expect(out.tools).toEqual([
      { type: "function", function: { name: "ls", description: "List", parameters: { type: "object", properties: { dir: { type: "string" } } } } },
    ])
    expect(out).toMatchObject({ temperature: 0, max_tokens: 100, reasoning: { max_tokens: 512 } })
  })

  it("keeps the CLI's own call ids, and sends images as data URLs", () => {
    const out = gw.geminiToOpenAI(
      {
        contents: [
          { role: "model", parts: [{ functionCall: { id: "abc", name: "read", args: {} } }] },
          {
            role: "user",
            parts: [
              { functionResponse: { id: "abc", name: "read", response: {} } },
              { text: "and this" },
              { inlineData: { mimeType: "image/png", data: "AAAA" } },
            ],
          },
        ],
      },
      "m",
      false,
    )
    expect(out.messages[0]).toMatchObject({ tool_calls: [{ id: "abc" }] })
    expect(out.messages[1]).toEqual({ role: "tool", tool_call_id: "abc", content: "{}" })
    expect(out.messages[2]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "and this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    })
    expect(out.stream_options).toBeUndefined()
  })

  it("asks for JSON when the CLI wants structured output", () => {
    const schema = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } }
    expect(gw.geminiToOpenAI({ contents: [], generationConfig: { responseMimeType: "application/json" } }, "m", false).response_format).toEqual({ type: "json_object" })
    expect(gw.geminiToOpenAI({ contents: [], generationConfig: { responseJsonSchema: schema } }, "m", false).response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "response", schema: { type: "object", properties: { ok: { type: "boolean" } } } },
    })
  })

  it("maps the function-calling mode", () => {
    const tools = [{ functionDeclarations: [{ name: "a" }, { name: "b" }] }]
    expect(gw.geminiToOpenAI({ contents: [], tools, toolConfig: { functionCallingConfig: { mode: "NONE" } } }, "m", false).tool_choice).toBe("none")
    expect(gw.geminiToOpenAI({ contents: [], tools, toolConfig: { functionCallingConfig: { mode: "ANY" } } }, "m", false).tool_choice).toBe("required")
    expect(
      gw.geminiToOpenAI({ contents: [], tools, toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["b"] } } }, "m", false).tool_choice,
    ).toEqual({ type: "function", function: { name: "b" } })
  })
})

describe("openAIToGemini", () => {
  it("returns text, function calls, the finish reason and token counts", () => {
    const out = gw.openAIToGemini(
      {
        choices: [
          {
            message: { content: "Done.", tool_calls: [{ id: "c1", function: { name: "ls", arguments: '{"dir":"/"}' } }] },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, completion_tokens_details: { reasoning_tokens: 2 } },
      },
      "gemini-3.8-flash",
    )
    expect(out.candidates[0].content.parts).toEqual([{ text: "Done." }, { functionCall: { id: "c1", name: "ls", args: { dir: "/" } } }])
    expect(out.candidates[0].finishReason).toBe("STOP")
    expect(out.usageMetadata).toEqual({ promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15, thoughtsTokenCount: 2 })
  })

  it("reports a length cut as MAX_TOKENS", () => {
    expect(gw.openAIToGemini({ choices: [{ message: { content: "x" }, finish_reason: "length" }] }, "m").candidates[0].finishReason).toBe("MAX_TOKENS")
  })
})

describe("createGeminiStream", () => {
  it("streams text as it comes and sends a streamed tool call whole at the end", () => {
    const s = gw.createGeminiStream("gemini-3.8-flash")
    expect(s.push({ choices: [{ delta: { content: "Hel" } }] })).toHaveLength(1)
    expect(s.push({ choices: [{ delta: { content: "lo" } }] })[0]).toMatchObject({ candidates: [{ content: { parts: [{ text: "lo" }] } }] })
    expect(s.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "ls", arguments: '{"di' } }] } }] })).toEqual([])
    s.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'r":"."}' } }] }, finish_reason: "tool_calls" }] })
    s.push({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })
    const last = s.end()
    expect(last.candidates[0].content.parts).toEqual([{ functionCall: { id: "c1", name: "ls", args: { dir: "." } } }])
    expect(last.candidates[0].finishReason).toBe("STOP")
    expect(last.usageMetadata).toEqual({ promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 })
  })
})
