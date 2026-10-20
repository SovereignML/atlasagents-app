# Agent Runtimes — OpenClaw, Hermes, Claude Code, Codex, OpenCode, Pi, Gemini CLI & Grok

> The **runtime** is the agent engine installed on the box. Atlas Agents ships eight: **OpenClaw** (the default), **Hermes** (Nous Research Hermes, Python, with a chat page, AgentWebUI Lite), and — in beta — **Claude Code**, **Codex**, **OpenCode**, **Pi**, **Gemini CLI** and **Grok**, coding agents each with the same chat UI plus a browser terminal. The runtime is the first thing picked in the deploy wizard (Agent → Plan → Billing; a link can preselect it with `?runtime=<id>`) and is stored per instance. There is no name or use-case step: the server names the agent (`generateProjectName`), every agent starts from its engine's default template, and the name is changed later from the agent's page (`PATCH /api/instances/[id]`, display name only).

For connecting bots/scripts to a Hermes instance's API, see the companion doc **[HERMES-API-INTEGRATION.md](HERMES-API-INTEGRATION.md)**. Related: [BILLING.md](BILLING.md) (what the model calls cost), [BYOS.md](BYOS.md).

---

## Choosing a runtime (for users)

In the deploy wizard's first step, **Agent**, you pick an engine:

| Runtime | What it is | Notes |
|---------|------------|-------|
| **OpenClaw** | The default agent runtime. | Works on every plan, including the 1 GB tier. |
| **Hermes** | Nous Research Hermes (Python) with a chat page (**AgentWebUI Lite**), also shown inside the dashboard. | Requires a **≥2 GB RAM** plan — the wizard blocks it on `shared-1g` and reverts to OpenClaw if you downsize. |
| **Claude Code** *(beta)* | Anthropic's coding agent, with the same chat page and a browser terminal running the `claude` TUI. | ≥2 GB RAM, paid plans only, Claude models only. Hidden unless `CLI_RUNTIMES_ENABLED=true` (admins always see it). |
| **Codex** *(beta)* | OpenAI's coding agent, with the same chat page and a browser terminal running the `codex` TUI. | ≥2 GB RAM, paid plans only, OpenAI models only. Same flag. |
| **OpenCode** *(beta)* | The open-source coding agent (`opencode-ai`), with the same chat page and a browser terminal running the `opencode` TUI. | ≥2 GB RAM, paid plans only, any OpenRouter model. Same flag. |
| **Pi** *(beta)* | Earendil's minimal coding agent (`@earendil-works/pi-coding-agent`), with the same chat page and a browser terminal running the `pi` TUI. | ≥2 GB RAM, paid plans only, any OpenRouter model. Same flag. Its ACP adapter is a community one (`pi-acp`). |
| **Gemini CLI** *(beta)* | Google's coding agent (`@google/gemini-cli`), with the same chat page and a browser terminal running the `gemini` TUI. | ≥2 GB RAM, **Free and paid plans**, Google models only. Same flag. |
| **Grok** *(beta)* | xAI's coding agent, Grok Build (`@xai-official/grok`, a native binary), with the same chat page and a browser terminal running the `grok` TUI. | ≥2 GB RAM, **Free and paid plans**, xAI models only. Same flag. |

Every instance but OpenClaw exposes **two interfaces behind one public URL**: a browser chat UI at `/`, and an OpenAI-compatible API at `/v1/*` for bots. The coding agents add a **browser terminal at `/terminal/`**, behind the same login as the chat UI. OpenClaw exposes its own admin-login chat UI.

An agent's runtime is fixed at deploy time. (Earlier revisions of this doc said it could be switched from the agent's settings; `PATCH /api/instances/[id]/agent-type` keeps the existing runtime, so it cannot. Deploy a new agent instead.)

---

## How it works (for developers)

The `runtime` column on `instances` is one of `RUNTIME_IDS`: `"openclaw" | "hermes" | "claude-code" | "codex" | "opencode" | "pi"`. A runtime registry ([`src/lib/runtimes/index.ts`](../src/lib/runtimes/index.ts)) maps each id to a `RuntimeEngine` implementation; `getRuntime()` falls back to the default (`DEFAULT_RUNTIME_ID = "openclaw"`) for legacy rows that predate the column. Each engine implements the same surface — `buildEnv()`, `renderConfig()`, `renderCaddyfile()`, `renderInitScript()`, plus `paths`/`serviceName` — so the provisioner is runtime-agnostic.

### Capabilities, not ids

The list of ids lives in one place, `RUNTIME_IDS` ([`src/lib/runtimes/ids.ts`](../src/lib/runtimes/ids.ts)). The `RuntimeId` type and the agent-config zod enum are both derived from it. What each engine *can do* lives in `RUNTIME_CAPS` ([`src/lib/runtimes/labels.ts`](../src/lib/runtimes/labels.ts)), which is client-safe and also exposed on each engine as `engine.caps`. Read it with `runtimeCaps(id)`, which falls back to OpenClaw for NULL or unknown ids, the same way `getRuntime()` does.

| Cap | OpenClaw | Hermes | Drives |
|-----|----------|--------|--------|
| `minRamGb` | 0 (no floor; the BYOS plan reports 0 GB) | 2 | wizard plan gate, `createInstanceFromAgentFields` |
| `exposesOpenAiApi` | no | yes | `/v1/models` deploy gate, "Gateway API Key" card ordering |
| `nativeAdminLogin` | yes | no | whether admin credentials are minted without a sidecar; `NO_ADMIN_FOR_HERMES` |
| `supportsCustomBaseUrl` | no | yes | which runtimes accept a non-OpenRouter BYO key |
| `hasSidecar` | no | yes | `webuiEnabled` on new rows, `-webui` footprint key |
| `minContext` | — | 64k | `selectableModelsForRuntime` |
| `modelSlugPrefixes` | — | — | the model picker and a provision-time guard (Claude Code `anthropic/`, Codex `openai/`) |
| `hasTerminal` | no | no | the `/terminal` route, the terminal unit, admin creds on reprovision |
| `allowedOnFree` | yes | yes | Free-plan gate (the CLI engines are paid-only) |
| `beta` | — | — | `CLI_RUNTIMES_ENABLED` gate — `src/lib/runtime-access.ts` |

Claude Code and Codex match Hermes' column except: `modelSlugPrefixes` set, `hasTerminal` yes, `allowedOnFree` no, `beta` yes, `minContext` unset.

Branch on a cap, not on `runtime === "hermes"`. The only remaining id checks are genuinely about one engine: `hermes doctor` diagnostics, the Linode golden image (OpenClaw), and the free tier's per-runtime slots. A runtime that pins its own per-tier model registers it in `RUNTIME_MODEL_LADDERS` ([`src/lib/model-router.ts`](../src/lib/model-router.ts)).

### OpenClaw ([`src/lib/runtimes/openclaw.ts`](../src/lib/runtimes/openclaw.ts))

- Service `openclaw`, system user `openclaw`.
- Install is config-only: it renders a `.env`/config file; no runtime CLI calls.
- Auth is an **admin email + password** (`openclawAdminEmail` / `openclawAdminPasswordEnc`).
- **Proxy trust:** `gateway.trustedProxies` is `["127.0.0.1", "::1"]`. Caddy proxies to `localhost:18789`, which Go dials as IPv6 `::1` first, and every openclaw release we install (2026.8.35 onwards) rejects forwarded headers from an untrusted peer with `proxy_attribution_required`. With only `127.0.0.1` listed, every browser request through the agent URL was a 403 while the loopback health check passed. `scripts/repair-agent-ingress.ts` fixes boxes provisioned before this (the gateway hot-applies it, no restart).

### Hermes ([`src/lib/runtimes/hermes.ts`](../src/lib/runtimes/hermes.ts))

- **CLI-driven install** (unlike OpenClaw): the init script runs `hermes setup` then `hermes config set` as the hermes system user. Requires Node ≥ `24.16.0` (`HERMES_VPS_MIN_NODE`). Hermes itself is Python; the floor exists for the Node tooling it spawns — `agent-browser`, installed globally for the browser tool, declares `engines.node: >=24.0.0` in every published version. It is deliberately equal to `OPENCLAW_VPS_MIN_NODE` so one Node major serves both engines and a box is never dragged between them.
- **Gateway** binds loopback `127.0.0.1:8642` (`HERMES_GATEWAY_PORT`). Its `.env` uses an `API_SERVER_*` convention (no prefix): `API_SERVER_ENABLED`, `API_SERVER_KEY` (the bearer/gateway token), `API_SERVER_HOST`, `API_SERVER_PORT`, `API_SERVER_CORS_ORIGINS`.
- **Chat UI sidecar** (AgentWebUI Lite, service `agentwebui-lite` on `127.0.0.1:8080`) chats with Hermes over ACP (`hermes acp`), which is why Hermes is installed as `hermes-agent[acp,messaging]`: `acp` for that, and `messaging` for `aiohttp`, without which the gateway runs but never starts its API server ("API Server: aiohttp not installed", nothing on :8642). aiohttp is not a core dependency of hermes-agent 0.19.0; the bootstrap checks for it (`verify_hermes_api_server_deps`). See *AgentWebUI Lite* below. Caddy **dual-routes** on the public host: `/v1/*` → Hermes gateway (bearer-token, CORS-enabled), everything else → the chat UI. The `webuiEnabled` column flags this; legacy `webuiEnabled=false` instances serve Hermes directly at every path (single-upstream).
- The version is pinned in code (`HERMES_PINNED_VERSION`) and env-overridable (`HERMES_VERSION`). See *Version pinning* below.

### Claude Code, Codex, OpenCode, Pi, Gemini CLI & Grok ([`cli-runtime.ts`](../src/lib/runtimes/cli-runtime.ts), [`claude-code.ts`](../src/lib/runtimes/claude-code.ts), [`codex.ts`](../src/lib/runtimes/codex.ts), [`opencode.ts`](../src/lib/runtimes/opencode.ts), [`pi.ts`](../src/lib/runtimes/pi.ts), [`gemini-cli.ts`](../src/lib/runtimes/gemini-cli.ts), [`grok.ts`](../src/lib/runtimes/grok.ts))

All six are CLIs with no server of their own, so one factory (`createCliRuntime`) gives each box three systemd units:

| Unit | What | Port |
|------|------|------|
| `<id>-gateway` | The **Atlas CLI gateway** ([`cli-gateway.ts`](../src/lib/runtimes/cli-gateway.ts)): a dependency-free Node server exposing `/v1/chat/completions` + `/v1/models` behind the gateway token, driving the CLI through its SDK (`@anthropic-ai/claude-agent-sdk` `query()`, `@openai/codex-sdk` threads) or, for OpenCode, Pi, Gemini CLI and Grok, over ACP (`opencode acp`, `gemini --acp`, `grok agent stdio`; Pi through `pi-acp`, installed next to the gateway), one agent process per turn. On a Gemini CLI box it also serves the Gemini API on loopback (see below). | Claude Code 8650, Codex 8651, OpenCode 8652, Pi 8653, Gemini CLI 8654, Grok 8655 |
| `agentwebui-lite` | The chat UI Hermes uses ([`agentwebui-lite.ts`](../src/lib/runtimes/agentwebui-lite.ts)). It drives the CLI over ACP (`claude-agent-acp`, `codex-acp`, `opencode acp`, `pi-acp`, `gemini --acp`, `grok agent stdio`), not through the gateway, so chats get real sessions, permission prompts, tool calls and diffs. | 8080 |
| `<id>-terminal` | `ttyd` + `tmux` serving the CLI's own TUI at `/terminal/`, one shared session reattached on every visit. Started best-effort after the gateway is healthy; a box without ttyd still deploys. | 7681 |

- **Layout** (HOME = `/opt/claude-code` or `/opt/codex`): `gateway/` is root-owned (gateway code, terminal launcher, the pinned SDK); `.atlas/` holds `.env`, `model.env`, `workspace/` and `sessions.json`. The init script rewrites `gateway.mjs` on every (re)provision, so gateway fixes ship by reprovisioning. Claude Code's workspace `CLAUDE.md` imports the shared `AGENTS.md`/`IDENTITY.md`; Codex reads `AGENTS.md` natively.
- **Auth.** `/v1/*` takes the gateway token as a bearer (`API_SERVER_KEY` — Hermes' name, so the provisioner's `/v1/models` check is unchanged). `/terminal*` goes through Caddy `forward_auth` to the gateway's `/_atlas/terminal-auth`, which checks HTTP Basic against the chat UI admin login (only a sha256 of the random password is on the box). `forward_auth`, not `basic_auth`, because the latter's name and hash format changed between Caddy 2.6.2 (the distro fallback) and 2.11; the rendered Caddyfiles are validated against both.
- **The agent's fence is its Unix user.** Both harnesses run with their own permission prompts off (Claude Code `bypassPermissions`, Codex `danger-full-access` + `approval_policy = "never"`) because nobody is there to answer them — the same posture as Hermes' `terminal.backend local`. The system user has no sudo.
- **Sessions (API clients).** An OpenAI-style client resends the whole history every turn. After each turn the gateway maps sha256(history + its reply) to the harness session id and resumes that session on the next request — tool results included — instead of replaying. An unknown history (an API client, or a lost map) starts a fresh session with earlier turns replayed as context; a resume that fails before any output falls back the same way.
- **Models** go through OpenRouter on the per-instance key, so metering is unchanged: Claude Code via the Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN`), Codex as a custom `model_providers.openrouter` in `$CODEX_HOME/config.toml` (`CODEX_WIRE_API` flips `responses` ↔ `chat`). Tier ladders: Claude Code Haiku / Sonnet / Opus 5.5; Codex GPT-6 Luna / GPT-6.1 Sol / GPT-6 Astra; Gemini CLI Gemini 3.5 Flash Lite / 3.8 Flash / 4 Argon; Grok Grok Build 0.1 / Grok 4.7 / Grok 4.7 (`CLAUDE_CODE_MODELS`, `CODEX_MODELS`, `GEMINI_CLI_MODELS`, `GROK_MODELS` in [`model-router.ts`](../src/lib/model-router.ts); `GEMINI_CLI_MODEL` / `GROK_MODEL` env override every tier). Mid and high tiers cost several times the Hermes ladder — check plan margins before turning the flag on. **The production allowlist lives in the DB**: `/admin/models` → **Use recommended models** replaces it with `ALLOWED_OPENROUTER_MODELS` (the code constant otherwise only seeds an empty table).
- **Fatal provider errors fail fast.** Both harnesses retry 401/402/403 with backoff for minutes; the gateway stops at the first one and tells the user why (a rejected key, or exhausted credits).
- **Known noise.** Codex logs "Model metadata … not found" for OpenRouter slugs (it ships no metadata for them) and Claude Code logs `unrecognized_model`; both still send the request, and the gateway keeps these out of the reply.
- **OpenCode and Pi** use any OpenRouter model on the Hermes ladder by default. OpenCode's `opencode.json` enables only the `openrouter` provider; Pi's `settings.json` sets `quietStartup` (else `pi-acp` sends Pi's version banner as reply text) and the gateway env sets `npm_config_offline` (else `pi-acp` adds an "update available" line). With an invalid key `pi-acp` ends the turn with an empty reply rather than an error.
- **Gemini CLI** speaks only Gemini's own REST API, which OpenRouter does not serve (no `generateContent` route). So `GOOGLE_GEMINI_BASE_URL` points at the gateway on loopback, `GEMINI_API_KEY` is the gateway token, and the gateway (`handleGemini`) translates `generateContent` / `streamGenerateContent` to OpenRouter chat completions on the per-instance key: system instruction, turns, function calls and results, images, JSON output and the function-calling mode, streamed back as Gemini chunks (tool calls whole, once complete). A model the CLI names is `google/<name>` when that is one of the agent's models (`.atlas/gemini-models`); anything else (the CLI's own helper calls) runs on the agent's model. Caddy routes only `/v1/*`, never `/v1beta`, so the translation is loopback-only. `~/.gemini/settings.json` selects API-key auth, turns off auto-update, usage statistics, telemetry and folder trust, and reads `AGENTS.md`/`IDENTITY.md` as context. Checked end to end with Gemini CLI 0.63.0 (headless and over ACP) against a stubbed OpenRouter: a streamed reply, a tool call, its result and the final answer.
- **Grok** (Grok Build) speaks ACP itself (`grok agent stdio`) and takes custom OpenAI-compatible models. `~/.grok/config.toml` overrides each of the agent's xAI models under its own name (`[model."grok-4.7"]`, `model = "x-ai/grok-4.7"`) with OpenRouter's `base_url` and `env_key = "OPENROUTER_API_KEY"`, limits the picker with `allowed_models`, pins Grok's helper models (`session_summary`, `web_search`, `image_description`, `prompt_suggestion`) to the agent's model (they default to built-in xAI names OpenRouter does not know), and turns off auto-update and telemetry (also `GROK_DISABLE_AUTOUPDATER`, `GROK_TELEMETRY_ENABLED=false`). No xAI login is needed. npm's postinstall unpacks the ~190 MB native binary next to the package. Checked end to end with Grok 1.0.61 over ACP against a stub: every call, titles included, went out as `x-ai/grok-4.7`.
- **Warm pool:** served by the universal image (see *Warm pool* below).
- **Free plan:** Gemini CLI and Grok are offered on Free (`allowedOnFree`), one live free agent per engine like OpenClaw and Hermes; the other CLI engines are paid-only.
- **Not yet:** BYOS prebake, catalog tools (browser etc. are unsupported on these engines — they bring their own built-in tools), BYO non-OpenRouter keys.

### Version pinning ([`src/lib/runtime-versions.ts`](../src/lib/runtime-versions.ts))

**Every box installs versions pinned in code, not `latest`:**

| Package | Pin (constant) | Policy |
|---------|----------------|--------|
| openclaw | `OPENCLAW_PINNED_VERSION` (`openclaw.ts`) | One release behind npm `latest`. |
| hermes-agent | `HERMES_PINNED_VERSION` (`hermes.ts`) | Newest release that has soaked (0.19.0 has been latest since 2026-07-20). |
| agentwebui-lite | `LITE_PINNED_VERSION` (`agentwebui-lite.ts`) | A PyPI release of our own `SovereignML/AgentWebUI-Lite` (published by a `v*` tag). Override: `AGENTWEBUI_LITE_PIP_SPEC`. |
| ACP adapters | `ACP_ADAPTERS` (`agentwebui-lite.ts`) | `claude-agent-acp`, `codex-acp`: one behind npm latest. |
| @anthropic-ai/claude-code + claude-agent-sdk | `CLAUDE_CODE_PINNED_VERSION`, `CLAUDE_AGENT_SDK_PINNED_VERSION` (`claude-code.ts`) | One behind npm latest; bump together. Override: `ATLAS_CLAUDE_CODE_VERSION` / `ATLAS_CLAUDE_AGENT_SDK_VERSION` — **not** `CLAUDE_CODE_VERSION`, which Claude Code exports to every process it spawns. |
| @openai/codex + codex-sdk | `CODEX_PINNED_VERSION`, `CODEX_SDK_PINNED_VERSION` (`codex.ts`) | One behind npm latest; bump together. Override: `CODEX_VERSION` / `CODEX_SDK_VERSION`. |
| @google/gemini-cli | `GEMINI_CLI_PINNED_VERSION` (`gemini-cli.ts`) | One behind npm latest (0.63.0 while 0.64.0 is latest). Override: `ATLAS_GEMINI_CLI_VERSION`. |
| @xai-official/grok | `GROK_PINNED_VERSION` (`grok.ts`) | One behind npm's `latest` tag (1.0.61 while 1.0.62 is latest; newer builds ship on `alpha` almost daily). Override: `ATLAS_GROK_VERSION`. |
| Caddy | `CADDY_DEFAULT_VERSION` (`bootstrap.ts`) | Installed from the GitHub release `.deb`, SHA-512 pinned. Not 2.11.6 (HTTP/2 proxy crash, SSE cut at 60s). |

Bumping one is a deliberate change: update the constant (and, for Caddy, the
hash), deploy one agent of each runtime on a test box, then merge. The pins
are part of the warm pool's key (`warm-pool-key.ts`), so a bump retires the
pool's old VMs automatically. `OPENCLAW_VERSION` / `HERMES_VERSION` /
`AGENTWEBUI_LITE_PIP_SPEC` / `CADDY_VERSION` override a pin without a code deploy —
a version to roll back to, or `latest` to track upstream again.

Why pin at all: on 2026-10-09 Caddy's Cloudsmith apt repository started
answering `402 Payment Required` and every bootstrap failed, because the box
pulled whatever the upstream served at that moment. Pinned artifacts from a
release page don't move under us.

Before the pins, every runtime installed `latest` at bootstrap. That is fine for a
cold install and fatal for a prefetch: the BYOS prebake downloads packages when
a server is **connected** and installs them when an agent is later **deployed**,
so re-resolving `latest` at deploy would miss the warm cache and re-download
everything. `resolveNpmLatest()` / `resolvePypiLatest()` turn `latest` into a
concrete version, which is persisted per server and baked into the bootstrap as
a literal.

An operator-set env pin still wins over the registry — that is how a bad
upstream release gets rolled back without a deploy. An unresolved pin degrades
to `latest`, i.e. exactly the old behaviour, never to a failure.

`instances.runtimeVersion` / `sidecarVersion` record what a box was actually
provisioned with. Both are NULL for anything provisioned before pinning
existed: those installed whatever `latest` was that day, and there is no
upgrade path, so the only way to recover it is to ask the box.

### Python bounds

`hermes-agent` is `>=3.11,<3.14`; AgentWebUI Lite is `>=3.11`. The
bootstrap checks both ends. It used to check only the floor, which is harmless
on a managed VPS (Ubuntu 24.04 ships 3.12) but not on BYOS, where the preflight
admits any amd64 Ubuntu or Debian — and Debian 13 / Ubuntu 25.x ship Python
3.13. Those boxes passed the check and then died minutes later mid-install.

### Models

Model routing is split because the two engines have different constraints:

- **`routeModel(tier)`** ([`src/lib/model-router.ts`](../src/lib/model-router.ts)) feeds OpenClaw (and shared paths): a primary OpenRouter model (`minimax/minimax-m3`) with a same-provider fallback (`z-ai/glm-5.3`). The dormant NVIDIA route (`LLM_DEFAULT_PROVIDER=nvidia`) uses `z-ai/glm-5.3` and `nvidia/nemotron-3.5-super-vl-120b-a12b` (`NVIDIA_FALLBACK_MODELS`; NVIDIA's catalog dropped the earlier Mistral Medium 3.5 and GLM 5.1 by 2026-10-20).
- **`hermesModel(tier)`** is kept **separate** because **Hermes rejects any model with <64k context at startup** — the small `:free` slugs are unusable. Slugs must be live OpenRouter `<author>/<slug>` with ≥64k context; `HERMES_MODEL` env overrides per deploy. The per-tier defaults are a cost-efficient ladder of real slugs — `low` `minimax/minimax-m3`, `mid` `deepseek/deepseek-v4-pro-0813`, `high` `moonshotai/kimi-k3` (all 1M ctx) — each also present in `ALLOWED_OPENROUTER_MODELS`, since the account-level allowlist rejects anything else at request time. A malformed/missing slug fails the provision *before* `systemctl start` (`isValidOpenRouterSlug`) rather than crash-looping the gateway.

Budget tiers are `low | mid | high`.

**The catalog** (`ALLOWED_OPENROUTER_MODELS`, verified against OpenRouter's live catalog on 2026-10-20) keeps only the newest generation from each provider: Claude Fable 5.1 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5; GPT-6 Astra / 6.1 Sol / 6 Luna; Gemini 4 Argon / 3.8 Flash / 3.5 Flash Lite, Gemma 4 31B (free); Grok 4.7, Grok Build 0.1; DeepSeek V4 Pro (0813) and V4.1 Flash (1017); Kimi K3; GLM 5.3; Qwen3.8 Max Prime and Flash; MiniMax M3 and M3.1 Flash (free); Mistral Large 4 and Small 4; Nemotron 3.5 Super VL and Lightning (free); plus Nano Banana 2.1 and GPT-5.4 Image 2 (image) and Nemotron 3.5 Content Safety (moderation). `/admin/models` → **Use recommended models** (`POST /api/admin/models {action:"reset"}`) deletes every other row, adds these, refreshes context windows and reports how many live agents still pin a removed model. The OpenRouter account's own allowlist is separate: change it to match.

### Models on Hermes' `/v1/models`

Unconfigured, Hermes advertises a single id, `hermes-agent`, on `GET /v1/models`.
`renderInitScript` therefore writes `platforms.api_server.extra` into `config.yaml` (with the
venv's PyYAML, because `hermes config set` splits keys on dots and slugs contain them):

- `model_name` = the default slug, so `/v1/models` lists it under its real name;
- `model_routes` = one alias per other slug from `selectableModelsForRuntime` (the same list as
  the dashboard picker), so an API client can pick a model per request. A request whose `model`
  matches a route runs on that model; anything else falls back to `model.default`.

Routes are written only for the `openrouter` provider (the slugs are OpenRouter's), and the list
is refreshed on every provision/reprovision. The step is best-effort.

### AgentWebUI Lite ([`agentwebui-lite.ts`](../src/lib/runtimes/agentwebui-lite.ts))

The chat UI of every agent but OpenClaw. It replaced Open WebUI to make installs fast: Open WebUI was a 146 MB wheel with ~116 dependencies and torch, the largest step of a cold install, sized at 3 GB of RAM per agent. Lite is one dependency and starts in about a second.

- **What runs.** One small Python app (`aiohttp` only) in `/opt/agentwebui-lite`, as the **runtime's own user** with the runtime's env files in its environment (the agents it starts inherit them), on loopback `:8080`. It talks to the engine over ACP: `hermes acp`, or the pinned ACP adapter for Claude Code / Codex (installed under `/opt/agentwebui-lite/acp`). OpenClaw keeps its own UI.
- **Its own settings stay in its `.env`** (`agentwebui-lite.env`, read through `AWL_ENV_FILE`), never in the unit's environment, so the agent processes never see Lite's password or embed secret. Lite lets the environment win over its `.env`, so a runtime env file must not set a key Lite reads (`LITE_SETTING_KEYS`, enforced by a test).
- **Sign-in.** Lite asks for the agent's generated admin email and password (`LOGIN_EMAIL` + `PASSWORD`, Lite 0.2.0+), the same pair Open WebUI's admin had; the dashboard shows them under **Access → Chat Login**. Customers open the chat at the agent's own URL (or its IP). There is no embedded chat in the dashboard any more, and so no embed secret or framing origins. Nothing is seeded after boot.
- **The models an admin enabled.** `AGENT_<ID>_MODELS` (Lite 0.2.0+) lists the admin-enabled models for the engine (`/admin/models`, `selectableModelsForRuntime`), the default first; Lite's model menu offers exactly those, and the Controls tab no longer has a Model card. Only for the `openrouter` provider: any other (BYOS own key, NVIDIA) keeps its configured model, with `LOCK_MODEL` on. Each engine's ACP server must accept the ids, which were checked against each pinned release:

  | Engine | Id Lite sends | What makes the engine accept it |
  |---|---|---|
  | Hermes | `openrouter:<slug>` | A pinned patch to `acp_adapter/server.py` ([`hermes-acp-patch.ts`](../src/lib/runtimes/hermes-acp-patch.ts)): Hermes 0.19.0 re-detects the provider on a switch and moves slugs that another provider's static catalog lists (e.g. `anthropic/claude-sonnet-4.6` → GMI). The patch skips that when the id names the current provider. Idempotent; warns (does not fail) when a Hermes release no longer has the line. |
  | Claude Code | `<slug>` | `availableModels` in `~/.claude/settings.json` (else the adapter accepts only its aliases and `ANTHROPIC_MODEL`). |
  | Codex | `<slug>` | `model_catalog_json` → `$CODEX_HOME/atlas-models.json`, built at provision from the installed Codex's own catalog (`codex debug models`), one entry per slug (else only OpenAI's presets). |
  | OpenCode | `openrouter/<slug>` | `provider.openrouter.whitelist` in `opencode.json`. |
  | Pi | `openrouter/<slug>` | Nothing: Pi accepts any OpenRouter model, and Lite's list trims its menu. |
  | Gemini CLI | `<name>` (slug without `google/`) | The gateway's Gemini API translation maps it back to `google/<name>`. |
  | Grok | `<name>` (slug without `x-ai/`) | A `[model."<name>"]` entry per model in `~/.grok/config.toml`, plus `allowed_models`. |

  A change in `/admin/models` reaches a box on its next reprovision, which rewrites Lite's whole env and restarts Lite when a key moved.
- **No `AGENT_IDLE_MINUTES`.** Lite 0.1.0 read it as an agent named "idle" and exited at start, which failed every deploy; 0.2.0 fixes the parser, and we still leave Lite's default (10 minutes).
- **Install source.** PyPI: `agentwebui-lite==LITE_PINNED_VERSION`, published from `SovereignML/AgentWebUI-Lite` when a `v*` tag is pushed (trusted publishing, no stored token). A prebuilt wheel, so no clone and no `git` on the box. The package is public on PyPI but proprietary (its LICENSE grants no use). `AGENTWEBUI_LITE_PIP_SPEC` overrides the requirement.

**Boxes on an older Lite** (`Instance.sidecarVersion` is not the pin; every box on 0.1.0 is crash-looping) are reinstalled by the same path on their next reprovision, with a fresh env, and `chat-ui:migrate` selects them too. A warm-pool claim records the baked versions, so a claimed agent is not reinstalled.

**Agents made before Lite** (`Instance.chatUi` NULL) still run Open WebUI. Their next reprovision moves them (`migrateChatUiToLite`): it installs Lite, then stops and deletes Open WebUI (unit, venv, env, user, **and its chat history**) and starts Lite on the same port. Lite is installed before Open WebUI is touched, so a failed install leaves the old chat working and the next reprovision retries. To move them all at once: `npm run chat-ui:migrate` (dry run), then `npm run chat-ui:migrate -- --apply`. Every provision also removes Open WebUI from its box (`buildOpenWebuiRemovalSteps`: the unit, `/opt/open-webui`, its env file and user), which covers a re-provisioned old box and a BYOS server prebaked with it, unless another agent on the same BYOS server still uses Open WebUI.

### Warm pool: the universal image ([`universal.ts`](../src/lib/runtimes/universal.ts))

Every engine the chat UI fronts shares one warm pool. A **universal** pool VM bakes every engine but OpenClaw (Hermes, Claude Code, Codex, OpenCode, Pi, Gemini CLI and Grok), each at its pin, plus Lite and every engine's ACP side, inside one bootstrap framing (`buildPrereqScript`, every engine's system account; about 38 KB of user-data: under DigitalOcean's 64 KB cap, but over **Linode's 16 KB** ("decoded user_data must not exceed 16384 bytes"), so on Linode a script over 16 KB is sent gzip-compressed (`linodeUserData` in [`linode-user-data.ts`](../src/lib/linode-user-data.ts); about 7.4 KB) and cloud-init decompresses it. Before that, every universal create on Linode was refused with a 400, and the breaker paused the pool). Its finalize runs only Hermes' `setup --quick` / `doctor --fix` warm-up and enables no unit. A deploy of any of the seven (with its chat UI) claims a universal VM (`poolRuntimeFor` in [`warm-pool-key.ts`](../src/lib/warm-pool-key.ts)); the claim writes and starts only the chosen engine's env, config and units (Phase A / B), so the other engines stay installed with no units, env or keys. The pool key folds in every engine's version and Lite's, so a bump to any pin retires the pool. OpenClaw keeps its own pool. Sizes: `POOL_SIZE_UNIVERSAL` (default 2; `POOL_SIZE_HERMES` still read), `POOL_SIZE_OPENCLAW`.

The deploy's completion log says how long it took and whether it came from the pool (`Deployment complete in 38s (warm pool)`); a warm claim is what keeps a deploy under a minute, and a cold install cannot. The start phase fails a service that crashes at start at once, with its journal, instead of retrying it.

### Credentials & switching

- **`GET /api/instances/[instanceId]/credentials`** returns the admin login for OpenClaw, and for Hermes **only when the chat UI sidecar is enabled** (then `openclawAdmin*` hold the chat page's password). A Hermes instance **without** the sidecar has no admin login at all — the route returns `409 NO_ADMIN_FOR_HERMES` and the dashboard hides the card; bots authenticate with the **gateway token** (`API_SERVER_KEY`) instead. The OpenClaw/WebUI login and the gateway token are independent — rotating one doesn't rotate the other.
- **`PATCH /api/instances/[instanceId]/agent-type`** switches an instance's runtime (and agent config), then re-provisions the box.
