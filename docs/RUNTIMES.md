# Agent Runtimes — OpenClaw, Hermes, Claude Code & Codex

> The **runtime** is the agent engine installed on the box. Atlas Agents ships four: **OpenClaw** (the default), **Hermes** (Nous Research Hermes, Python, with a bundled Open WebUI chat interface), and — in beta — **Claude Code** and **Codex**, the Anthropic and OpenAI coding agents, each with the same chat UI plus a browser terminal. The runtime is chosen in the deploy wizard and stored per instance.

For connecting bots/scripts to a Hermes instance's API, see the companion doc **[HERMES-API-INTEGRATION.md](HERMES-API-INTEGRATION.md)**. Related: [BILLING.md](BILLING.md) (what the model calls cost), [BYOS.md](BYOS.md).

---

## Choosing a runtime (for users)

In the deploy wizard's **Interface** step you pick an engine:

| Runtime | What it is | Notes |
|---------|------------|-------|
| **OpenClaw** | The default agent runtime. | Works on every plan, including the 1 GB tier. |
| **Hermes** | Nous Research Hermes (Python) with a bundled **Open WebUI** chat UI. | Requires a **≥2 GB RAM** plan — the wizard blocks it on `shared-1g` and reverts to OpenClaw if you downsize. |
| **Claude Code** *(beta)* | Anthropic's coding agent, with Open WebUI and a browser terminal running the `claude` TUI. | ≥2 GB RAM, paid plans only, Claude models only. Hidden unless `CLI_RUNTIMES_ENABLED=true` (admins always see it). |
| **Codex** *(beta)* | OpenAI's coding agent, with Open WebUI and a browser terminal running the `codex` TUI. | ≥2 GB RAM, paid plans only, OpenAI models only. Same flag. |

A Hermes, Claude Code or Codex instance exposes **two interfaces behind one public URL**: a browser chat UI at `/`, and an OpenAI-compatible API at `/v1/*` for bots. Claude Code and Codex add a **browser terminal at `/terminal/`**, behind the same login as the chat UI. OpenClaw exposes its own admin-login chat UI.

An agent's runtime is fixed at deploy time. (Earlier revisions of this doc said it could be switched from the agent's settings; `PATCH /api/instances/[id]/agent-type` keeps the existing runtime, so it cannot. Deploy a new agent instead.)

---

## How it works (for developers)

The `runtime` column on `instances` is one of `RUNTIME_IDS`: `"openclaw" | "hermes" | "claude-code" | "codex"`. A runtime registry ([`src/lib/runtimes/index.ts`](../src/lib/runtimes/index.ts)) maps each id to a `RuntimeEngine` implementation; `getRuntime()` falls back to the default (`DEFAULT_RUNTIME_ID = "openclaw"`) for legacy rows that predate the column. Each engine implements the same surface — `buildEnv()`, `renderConfig()`, `renderCaddyfile()`, `renderInitScript()`, plus `paths`/`serviceName` — so the provisioner is runtime-agnostic.

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
- **Open WebUI sidecar** (service `open-webui` on `127.0.0.1:8080`) is installed into its own venv under `/opt/open-webui`, with **CPU-only torch** from the PyTorch CPU index (as Open WebUI's own image does) — PyPI's Linux torch is the CUDA build, ~3.2 GB of GPU libraries on a box with no GPU. If the PyTorch index is unreachable the install falls back to PyPI. Caddy **dual-routes** on the public host: `/v1/*` → Hermes gateway (bearer-token, CORS-enabled), everything else → Open WebUI (browser, session login). The `webuiEnabled` column flags this; legacy `webuiEnabled=false` instances serve Hermes directly at every path (single-upstream).
- Versions are pinned in code (`HERMES_PINNED_VERSION`, `OPEN_WEBUI_PINNED_VERSION`) and env-overridable (`HERMES_VERSION`, `OPEN_WEBUI_VERSION`). See *Version pinning* below.

### Claude Code & Codex ([`cli-runtime.ts`](../src/lib/runtimes/cli-runtime.ts), [`claude-code.ts`](../src/lib/runtimes/claude-code.ts), [`codex.ts`](../src/lib/runtimes/codex.ts))

Both are CLIs with no server of their own, so one factory (`createCliRuntime`) gives each box three systemd units:

| Unit | What | Port |
|------|------|------|
| `<id>-gateway` | The **Atlas CLI gateway** ([`cli-gateway.ts`](../src/lib/runtimes/cli-gateway.ts)): a dependency-free Node server exposing `/v1/chat/completions` + `/v1/models` behind the gateway token, driving the CLI through its SDK (`@anthropic-ai/claude-agent-sdk` `query()`, `@openai/codex-sdk` threads). | Claude Code 8650, Codex 8651 |
| `open-webui` | The same sidecar Hermes uses ([`open-webui.ts`](../src/lib/runtimes/open-webui.ts)), with its background task generation (titles, tags, follow-ups…) **off** — against an agent each of those is a full, billed agent run. | 8080 |
| `<id>-terminal` | `ttyd` + `tmux` serving the CLI's own TUI at `/terminal/`, one shared session reattached on every visit. Started best-effort after the gateway is healthy; a box without ttyd still deploys. | 7681 |

- **Layout** (HOME = `/opt/claude-code` or `/opt/codex`): `gateway/` is root-owned (gateway code, terminal launcher, the pinned SDK); `.atlas/` holds `.env`, `model.env`, `workspace/` and `sessions.json`. The init script rewrites `gateway.mjs` on every (re)provision, so gateway fixes ship by reprovisioning. Claude Code's workspace `CLAUDE.md` imports the shared `AGENTS.md`/`IDENTITY.md`; Codex reads `AGENTS.md` natively.
- **Auth.** `/v1/*` takes the gateway token as a bearer (`API_SERVER_KEY` — Hermes' name, so the provisioner's `/v1/models` check is unchanged). `/terminal*` goes through Caddy `forward_auth` to the gateway's `/_atlas/terminal-auth`, which checks HTTP Basic against the chat UI admin login (only a sha256 of the random password is on the box). `forward_auth`, not `basic_auth`, because the latter's name and hash format changed between Caddy 2.6.2 (the distro fallback) and 2.11; the rendered Caddyfiles are validated against both.
- **The agent's fence is its Unix user.** Both harnesses run with their own permission prompts off (Claude Code `bypassPermissions`, Codex `danger-full-access` + `approval_policy = "never"`) because nobody is there to answer them — the same posture as Hermes' `terminal.backend local`. The system user has no sudo.
- **Sessions.** Open WebUI resends the whole history every turn. After each turn the gateway maps sha256(history + its reply) to the harness session id and resumes that session on the next request — tool results included — instead of replaying. An unknown history (an API client, or a lost map) starts a fresh session with earlier turns replayed as context; a resume that fails before any output falls back the same way.
- **Models** go through OpenRouter on the per-instance key, so metering is unchanged: Claude Code via the Anthropic-compatible endpoint (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN`), Codex as a custom `model_providers.openrouter` in `$CODEX_HOME/config.toml` (`CODEX_WIRE_API` flips `responses` ↔ `chat`). Tier ladders: Claude Code Haiku / Sonnet / Opus 5.5; Codex gpt-5.1-codex-mini / gpt-5.3-codex / gpt-5.5 (`CLAUDE_CODE_MODELS`, `CODEX_MODELS` in [`model-router.ts`](../src/lib/model-router.ts)). Mid and high tiers cost several times the Hermes ladder — check plan margins before turning the flag on. **The production allowlist lives in the DB**: add the six slugs in `/admin/models` (the code constant only seeds an empty table).
- **Fatal provider errors fail fast.** Both harnesses retry 401/402/403 with backoff for minutes; the gateway stops at the first one and tells the user why (a rejected key, or exhausted credits).
- **Known noise.** Codex logs "Model metadata … not found" for OpenRouter slugs (it ships no metadata for them) and Claude Code logs `unrecognized_model`; both still send the request, and the gateway keeps these out of the reply.
- **Not yet:** warm pool (no pool targets, so claims fall back to a cold provision), BYOS prebake, the Free plan, catalog tools (browser etc. are unsupported on these engines — they bring their own built-in tools), BYO non-OpenRouter keys.

### Version pinning ([`src/lib/runtime-versions.ts`](../src/lib/runtime-versions.ts))

**Every box installs versions pinned in code, not `latest`:**

| Package | Pin (constant) | Policy |
|---------|----------------|--------|
| openclaw | `OPENCLAW_PINNED_VERSION` (`openclaw.ts`) | One release behind npm `latest`. |
| hermes-agent | `HERMES_PINNED_VERSION` (`hermes.ts`) | Newest release that has soaked (0.19.0 has been latest since 2026-07-20). |
| open-webui | `OPEN_WEBUI_PINNED_VERSION` (`open-webui.ts`) | One release behind PyPI latest. |
| @anthropic-ai/claude-code + claude-agent-sdk | `CLAUDE_CODE_PINNED_VERSION`, `CLAUDE_AGENT_SDK_PINNED_VERSION` (`claude-code.ts`) | One behind npm latest; bump together. Override: `ATLAS_CLAUDE_CODE_VERSION` / `ATLAS_CLAUDE_AGENT_SDK_VERSION` — **not** `CLAUDE_CODE_VERSION`, which Claude Code exports to every process it spawns. |
| @openai/codex + codex-sdk | `CODEX_PINNED_VERSION`, `CODEX_SDK_PINNED_VERSION` (`codex.ts`) | One behind npm latest; bump together. Override: `CODEX_VERSION` / `CODEX_SDK_VERSION`. |
| Caddy | `CADDY_DEFAULT_VERSION` (`bootstrap.ts`) | Installed from the GitHub release `.deb`, SHA-512 pinned. Not 2.11.6 (HTTP/2 proxy crash, SSE cut at 60s). |

Bumping one is a deliberate change: update the constant (and, for Caddy, the
hash), deploy one agent of each runtime on a test box, then merge. The pins
are part of the warm pool's key (`warm-pool-key.ts`), so a bump retires the
pool's old VMs automatically. `OPENCLAW_VERSION` / `HERMES_VERSION` /
`OPEN_WEBUI_VERSION` / `CADDY_VERSION` override a pin without a code deploy —
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

`hermes-agent` is `>=3.11,<3.14`; `open-webui` is `>=3.11,<3.13.0a1`. The
bootstrap checks both ends. It used to check only the floor, which is harmless
on a managed VPS (Ubuntu 24.04 ships 3.12) but not on BYOS, where the preflight
admits any amd64 Ubuntu or Debian — and Debian 13 / Ubuntu 25.x ship Python
3.13. Those boxes passed the check and then died minutes later mid-install.

### Models

Model routing is split because the two engines have different constraints:

- **`routeModel(tier)`** ([`src/lib/model-router.ts`](../src/lib/model-router.ts)) feeds OpenClaw (and shared paths): a primary OpenRouter model (`minimax/minimax-m2.5`) with a `:free` fallback (`moonshotai/kimi-k2.6:free`), plus a best-effort NVIDIA cross-provider fallback (`mistralai/mistral-medium-3.5-128b`) on every tier (`NVIDIA_API_KEY`).
- **`hermesModel(tier)`** is kept **separate** because **Hermes rejects any model with <64k context at startup** — the small `:free` slugs are unusable. Slugs must be live OpenRouter `<author>/<slug>` with ≥64k context; `HERMES_MODEL` env overrides per deploy. The per-tier defaults are a cost-efficient ladder of real slugs — `low` `minimax/minimax-m2.5` (204k ctx), `mid` `deepseek/deepseek-v4-pro` (1048k ctx), `high` `moonshotai/kimi-k2.6` (262k ctx) — each also present in `ALLOWED_OPENROUTER_MODELS`, since the account-level allowlist rejects anything else at request time. A malformed/missing slug fails the provision *before* `systemctl start` (`isValidOpenRouterSlug`) rather than crash-looping the gateway.

Budget tiers are `low | mid | high`.

### Prewarmed Open WebUI on warm-pool VMs

Open WebUI's first boot is slow (schema, migrations, a very large Python import), so the
warm pool pays it at bake time, not while a customer waits
([`open-webui-claim.ts`](../src/lib/runtimes/open-webui-claim.ts)):

- **Bake** (`buildBakeFinalizeScript(..., { waitForSidecar: true })`) writes a placeholder env
  with a **random per-VM `WEBUI_SECRET_KEY`** generated on the box, starts the sidecar, waits
  until `/health` answers, and drops `/opt/open-webui/.atlas-prewarmed`. BYOS prebake starts
  the sidecar but does not wait or mark, because a BYOS deploy always restarts it.
- **Claim**: Phase A rewrites the env with the real values but keeps the bake secret. The
  install phase keeps the sidecar running when the marker is present and it is healthy.
  Then, before commit, the customer's admin account is **signed up on the running process**,
  which is also pointed at the real gateway token, `DEFAULT_MODELS` and `WEBUI_URL` through
  Open WebUI's admin API. Signup is then locked, and verified closed on `/api/config`. No
  restart is needed. With `ENABLE_PERSISTENT_CONFIG=false` those API writes only touch the live
  process, and the env file carries the same values into later restarts.
- **Fallbacks**: no marker (a box baked before this change), an unhealthy sidecar, or a failed
  hand-off all take the old path: restart the sidecar, then seed through signup.

The sidecar unit `Wants=` the gateway instead of `Requires=` it. Under `Requires=`, every
gateway restart (including the one at claim) restarted Open WebUI too, and a gateway that
failed at bake kept Open WebUI from starting at all.

### The chat UI's default model

Open WebUI needs its own pre-selected model — pinning Hermes' `model.default` is not enough.
The provisioner seeds the sidecar's admin account over the signup endpoint and then locks
signup, so that account has no prior model preference; with no instance-wide default, a new
chat opens with nothing selected and the **first message is sent with no model attached**.
`renderEnv()` therefore sets `DEFAULT_MODELS` to the same slug `renderInitScript` writes as
`model.default`, and `reprovisionBotEnv()` updates that one key in place (never re-rendering
the file, which by then holds a locked `ENABLE_SIGNUP` and a session secret we do not persist)
and restarts the sidecar. `DEFAULT_MODELS` matches against the `id` Hermes returns from
`GET /v1/models`.

That list is the **only** thing Open WebUI's model picker shows, and unconfigured Hermes
advertises a single id, `hermes-agent`, which never matched the slug in `DEFAULT_MODELS`.
`renderInitScript` therefore writes `platforms.api_server.extra` into `config.yaml` (with the
venv's PyYAML, because `hermes config set` splits keys on dots and slugs contain them):

- `model_name` = the default slug, so `/v1/models` lists it under its real name and
  `DEFAULT_MODELS` selects it;
- `model_routes` = one alias per other slug from `selectableModelsForRuntime` (the same list as
  the dashboard picker), so users can switch model per chat. A request whose `model` matches a
  route runs on that model; anything else falls back to `model.default`.

Routes are written only for the `openrouter` provider (the slugs are OpenRouter's), and the list
is refreshed on every provision/reprovision, so a model newly enabled in admin shows up in
the picker after that agent's next reprovision. The step is best-effort: if it fails, the picker
loses its extra entries, but the agent keeps working.

### Credentials & switching

- **`GET /api/instances/[instanceId]/credentials`** returns the admin login for OpenClaw, and for Hermes **only when the Open WebUI sidecar is enabled** (then `openclawAdmin*` hold the Open WebUI login). A Hermes instance **without** the sidecar has no admin login at all — the route returns `409 NO_ADMIN_FOR_HERMES` and the dashboard hides the card; bots authenticate with the **gateway token** (`API_SERVER_KEY`) instead. The OpenClaw/WebUI login and the gateway token are independent — rotating one doesn't rotate the other.
- **`PATCH /api/instances/[instanceId]/agent-type`** switches an instance's runtime (and agent config), then re-provisions the box.
