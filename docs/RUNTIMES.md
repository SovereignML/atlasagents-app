# Agent Runtimes — OpenClaw & Hermes

> The **runtime** is the agent engine installed on the box. SovereignML ships two: **OpenClaw** (the default) and **Hermes** (Nous Research Hermes, Python, with a bundled Open WebUI chat interface). The runtime is chosen in the deploy wizard and stored per instance.

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

### Hermes ([`src/lib/runtimes/hermes.ts`](../src/lib/runtimes/hermes.ts))

- **CLI-driven install** (unlike OpenClaw): the init script runs `hermes setup` then `hermes config set` as the hermes system user. Requires Node ≥ `22.14.0` (`HERMES_VPS_MIN_NODE`).
- **Gateway** binds loopback `127.0.0.1:8642` (`HERMES_GATEWAY_PORT`). Its `.env` uses an `API_SERVER_*` convention (no prefix): `API_SERVER_ENABLED`, `API_SERVER_KEY` (the bearer/gateway token), `API_SERVER_HOST`, `API_SERVER_PORT`, `API_SERVER_CORS_ORIGINS`.
- **Open WebUI sidecar** (service `open-webui` on `127.0.0.1:8080`) is installed into its own venv under `/opt/open-webui`. Caddy **dual-routes** on the public host: `/v1/*` → Hermes gateway (bearer-token, CORS-enabled), everything else → Open WebUI (browser, session login). The `webuiEnabled` column flags this; legacy `webuiEnabled=false` instances serve Hermes directly at every path (single-upstream).
- Versions are env-pinnable: `HERMES_VERSION`, `OPEN_WEBUI_VERSION` (both default `latest`).

### Models

Model routing is split because the two engines have different constraints:

- **`routeModel(tier)`** ([`src/lib/model-router.ts`](../src/lib/model-router.ts)) feeds OpenClaw (and shared paths): a primary OpenRouter model (`minimax/minimax-m2.5`) with a `:free` fallback (`moonshotai/kimi-k2.6:free`), plus a best-effort NVIDIA cross-provider fallback (`mistralai/mistral-medium-3.5-128b`) on every tier (`NVIDIA_API_KEY`).
- **`hermesModel(tier)`** is kept **separate** because **Hermes rejects any model with <64k context at startup** — the small `:free` slugs are unusable. Slugs must be live OpenRouter `<author>/<slug>` with ≥64k context; `HERMES_MODEL` env overrides per deploy. The current per-tier defaults are a conservative ≥64k placeholder (`anthropic/claude-3.5-sonnet`) flagged for replacement with chosen slugs. A malformed/missing slug fails the provision *before* `systemctl start` (`isValidOpenRouterSlug`) rather than crash-looping the gateway.

Budget tiers are `low | mid | high`.

### Credentials & switching

- **`GET /api/instances/[instanceId]/credentials`** returns the admin login for OpenClaw, and for Hermes **only when the Open WebUI sidecar is enabled** (then `openclawAdmin*` hold the Open WebUI login). A Hermes instance **without** the sidecar has no admin login at all — the route returns `409 NO_ADMIN_FOR_HERMES` and the dashboard hides the card; bots authenticate with the **gateway token** (`API_SERVER_KEY`) instead. The OpenClaw/WebUI login and the gateway token are independent — rotating one doesn't rotate the other.
- **`PATCH /api/instances/[instanceId]/agent-type`** switches an instance's runtime (and agent config), then re-provisions the box.
