import { describe, expect, it } from "vitest"
import {
  EMPTY_CHAT_WINDOWS,
  MAX_CHAT_WINDOWS,
  addressLabel,
  chatAgentFor,
  hasDashboardChat,
  closeChatWindow,
  minimizeChatWindow,
  openChatWindow,
  resizeChatWindow,
  restoreChatWindows,
  type ChatAgent,
} from "./chat-windows"

const agent = (id: string): ChatAgent => ({
  id,
  name: `Agent ${id}`,
  runtime: "hermes",
  publicUrl: `https://${id}.atlasdeploy.xyz`,
  ipUrl: "http://192.0.2.1",
})

describe("the dashboard's chat windows", () => {
  it("shows the chat it opens and minimizes the one that was showing", () => {
    let s = openChatWindow(EMPTY_CHAT_WINDOWS, agent("a"), 1)
    expect(s.activeId).toBe("a")
    s = openChatWindow(s, agent("b"), 2)
    expect(s.activeId).toBe("b")
    expect(s.windows.map((w) => w.agent.id)).toEqual(["a", "b"])
  })

  it("brings back an open chat instead of opening it twice", () => {
    let s = openChatWindow(EMPTY_CHAT_WINDOWS, agent("a"), 1)
    s = openChatWindow(s, agent("b"), 2)
    s = openChatWindow(s, agent("a"), 3)
    expect(s.windows).toHaveLength(2)
    expect(s.activeId).toBe("a")
  })

  it("closes the least recently opened chat past the cap, never the one being opened", () => {
    let s = EMPTY_CHAT_WINDOWS
    for (let i = 0; i < MAX_CHAT_WINDOWS; i++) s = openChatWindow(s, agent(`a${i}`), i)
    s = openChatWindow(s, agent("a0"), 10) // a0 is now the most recent
    s = openChatWindow(s, agent("new"), 11)
    expect(s.windows).toHaveLength(MAX_CHAT_WINDOWS)
    expect(s.windows.map((w) => w.agent.id)).not.toContain("a1")
    expect(s.windows.map((w) => w.agent.id)).toContain("a0")
    expect(s.activeId).toBe("new")
  })

  it("keeps a minimized chat open, and forgets a closed one", () => {
    let s = openChatWindow(EMPTY_CHAT_WINDOWS, agent("a"), 1)
    s = minimizeChatWindow(s)
    expect(s.activeId).toBeNull()
    expect(s.windows).toHaveLength(1)
    s = closeChatWindow(openChatWindow(s, agent("a"), 2), "a")
    expect(s).toMatchObject({ windows: [], activeId: null })
  })

  it("remembers the size, unless an open asks for one", () => {
    let s = resizeChatWindow(EMPTY_CHAT_WINDOWS, "panel")
    s = openChatWindow(s, agent("a"), 1)
    expect(s.size).toBe("panel")
    expect(openChatWindow(s, agent("b"), 2, "full").size).toBe("full")
  })

  it("restores saved chats minimized, and ignores anything malformed", () => {
    const saved = JSON.parse(JSON.stringify(openChatWindow(EMPTY_CHAT_WINDOWS, agent("a"), 1)))
    saved.windows.push({ agent: { id: 3 }, openedAt: 2 }, null)
    const s = restoreChatWindows(saved)
    expect(s.windows.map((w) => w.agent.id)).toEqual(["a"])
    expect(s.activeId).toBeNull()
    expect(restoreChatWindows("nope")).toEqual(EMPTY_CHAT_WINDOWS)
    expect(restoreChatWindows({ size: "huge" }).size).toBe("full")
  })

  it("labels an address by its host", () => {
    expect(addressLabel("https://a.atlasdeploy.xyz/")).toBe("a.atlasdeploy.xyz")
    expect(addressLabel("http://192.0.2.1")).toBe("192.0.2.1")
    expect(addressLabel(null)).toBeNull()
  })
})

describe("which agents chat in the dashboard", () => {
  it("is an agent whose chat page is AgentWebUI Lite", () => {
    expect(hasDashboardChat({ runtime: "hermes", webuiEnabled: true, chatUi: "agentwebui-lite" })).toBe(true)
    expect(hasDashboardChat({ runtime: "hermes", webuiEnabled: true, chatUi: null })).toBe(false) // Open WebUI
    expect(hasDashboardChat({ runtime: "hermes", webuiEnabled: false, chatUi: "agentwebui-lite" })).toBe(false)
    expect(hasDashboardChat({ runtime: "openclaw", webuiEnabled: true, chatUi: "agentwebui-lite" })).toBe(false)
  })

  it("offers the agent's hostname and its IP as separate addresses", () => {
    const row = { id: "i", name: "Bot", runtime: "hermes", domain: null, tlsStatus: null }
    expect(chatAgentFor({ ...row, managedSubdomain: "b.atlasdeploy.xyz", ipAddress: "192.0.2.1" })).toMatchObject({
      publicUrl: "https://b.atlasdeploy.xyz",
      ipUrl: "http://192.0.2.1",
    })
    expect(chatAgentFor({ ...row, managedSubdomain: null, ipAddress: "192.0.2.1" })).toMatchObject({
      publicUrl: null,
      ipUrl: "http://192.0.2.1",
    })
  })
})
