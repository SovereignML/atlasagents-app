# Hermes — API integration for external bots

Hermes instances ship with two interfaces behind a single public URL:

- **`/`** — Open WebUI chat interface (humans, browser, password login)
- **`/v1/*`** — OpenAI-compatible API (bots and scripts, bearer-token auth)

Caddy path-routes these on the same host. You don't need a separate subdomain or
a different port; pick the right path and the right auth.

## Connecting a Telegram / Discord / custom bot

Hermes speaks the OpenAI Chat Completions API. Anything that can call
`https://api.openai.com/v1/chat/completions` can call your Hermes instance — just
swap the base URL and the API key.

**Base URL:** `https://<your-host>/v1`
**Auth:** `Authorization: Bearer <gateway_token>`

The gateway token is shown on the instance's dashboard page in the **Gateway
Token** card (reveal, then copy).

### `curl` smoke test

```bash
curl -i -X POST https://<your-host>/v1/chat/completions \
  -H "Authorization: Bearer $GATEWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "ping"}]
  }'
```

Expect `HTTP/2 200` and a JSON body with `choices[0].message.content`. The
request lands in Hermes' journal (`journalctl -u hermes-gateway`), not Open
WebUI's.

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<your-host>/v1",
    api_key="<gateway_token>",
)

resp = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "ping"}],
)
print(resp.choices[0].message.content)
```

### Node.js (OpenAI SDK)

```typescript
import OpenAI from "openai"

const client = new OpenAI({
  baseURL: "https://<your-host>/v1",
  apiKey: process.env.GATEWAY_TOKEN!,
})

const resp = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "ping" }],
})
console.log(resp.choices[0].message.content)
```

## CORS

Only `/v1/*` is CORS-enabled (so browser clients on your allowed origins can hit
the API directly). The Open WebUI surface assumes same-origin browser use and
ships its own headers — don't add a different origin to the dashboard's
"allowed origins" expecting it to work for the WebUI itself.

The allow-list is built from the instance's custom domain and managed
subdomain. If you need additional origins, configure them on the instance
settings page.

## Auth surfaces, by audience

| Audience | URL | Credential | Where to find it |
|---|---|---|---|
| Humans (browser) | `https://<host>/` | Open WebUI admin email + password | Credentials card on the instance page |
| Bots / scripts | `https://<host>/v1/chat/completions` | Gateway token (Bearer) | Gateway Token card on the instance page |
| You (operator, SSH) | `ssh root@<ip>` | Root password | Credentials card on the instance page |

The Open WebUI login and the gateway token are independent — rotating one
doesn't rotate the other. Don't share the gateway token publicly; it's a full
admin bearer for the Hermes API.

## Models

Pass `"model": "auto"` to use the budget-tier default routed via OpenRouter, or
pass an explicit OpenRouter model slug. The set of routable models is governed
by the instance's `budget_tier`; see [DEPLOYMENT.md](DEPLOYMENT.md) for the
tier-to-model map.

## Legacy API-only Hermes instances

Instances provisioned before Open WebUI became mandatory (those with
`webuiEnabled=false` in the database) keep their original topology: the public
URL serves Hermes directly at every path, no Open WebUI in front. The
`/v1/chat/completions` example above still works on those — you just won't see
a browser UI at `/`. New deploys all get the dual-route shape.
