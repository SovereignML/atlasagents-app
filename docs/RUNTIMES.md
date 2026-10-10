# Agent Runtimes — OpenClaw & Hermes

> The **runtime** is the agent engine installed on the box. Atlas Agents ships two: **OpenClaw** (the default) and **Hermes** (Nous Research Hermes, Python, with a bundled Open WebUI chat interface). The runtime is chosen in the deploy wizard and stored per instance.

For connecting bots/scripts to a Hermes instance's API, see the companion doc **[HERMES-API-INTEGRATION.md](HERMES-API-INTEGRATION.md)**. Related: [BILLING.md](BILLING.md) (what the model calls cost), [BYOS.md](BYOS.md).

---

## Choosing a runtime (for users)

In the deploy wizard's **Interface** step you pick an engine:

| Runtime | What it is | Notes |
|---------|------------|-------|
| **OpenClaw** | The default agent runtime. | Works on every plan, including the 1 GB tier. |
| **Hermes** | Nous Research Hermes (Python) with a bundled **Open WebUI** chat UI. | Requires a **≥2 GB RAM** plan — the wizard blocks it on `shared-1g` and reverts to OpenClaw if you downsize. |

A Hermes instance exposes **two interfaces behind one public URL**: a browser chat UI at `/`, and an OpenAI-compatible API at `/v1/*` for bots. OpenClaw exposes its own admin-login chat UI.

You can switch an existing agent's runtime later from its settings (this re-provisions the box).

---

## How it works (for developers)

The `runtime` column on `instances` is `"openclaw" | "hermes"`. A runtime registry ([`src/lib/runtimes/index.ts`](../src/lib/runtimes/index.ts)) maps each id to a `RuntimeEngine` implementation; `getRuntime()` falls back to the default (`DEFAULT_RUNTIME_ID = "openclaw"`) for legacy rows that predate the column. Each engine implements the same surface — `buildEnv()`, `renderConfig()`, `renderCaddyfile()`, `renderInitScript()`, plus `paths`/`serviceName` — so the provisioner is runtime-agnostic.

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

### Version pinning ([`src/lib/runtime-versions.ts`](../src/lib/runtime-versions.ts))

**Every box installs versions pinned in code, not `latest`:**

| Package | Pin (constant) | Policy |
|---------|----------------|--------|
| openclaw | `OPENCLAW_PINNED_VERSION` (`openclaw.ts`) | One release behind npm `latest`. |
| hermes-agent | `HERMES_PINNED_VERSION` (`hermes.ts`) | Newest release that has soaked (0.19.0 has been latest since 2026-07-20). |
| open-webui | `OPEN_WEBUI_PINNED_VERSION` (`hermes.ts`) | One release behind PyPI latest. |
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

### Credentials & switching

- **`GET /api/instances/[instanceId]/credentials`** returns the admin login for OpenClaw, and for Hermes **only when the Open WebUI sidecar is enabled** (then `openclawAdmin*` hold the Open WebUI login). A Hermes instance **without** the sidecar has no admin login at all — the route returns `409 NO_ADMIN_FOR_HERMES` and the dashboard hides the card; bots authenticate with the **gateway token** (`API_SERVER_KEY`) instead. The OpenClaw/WebUI login and the gateway token are independent — rotating one doesn't rotate the other.
- **`PATCH /api/instances/[instanceId]/agent-type`** switches an instance's runtime (and agent config), then re-provisions the box.
