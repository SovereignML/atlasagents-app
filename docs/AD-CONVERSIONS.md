# Ad-conversion tracking (Meta + Google)

Server-side conversion tracking for ad attribution. Conversions are reported
**server-to-server** — there is no browser pixel — so ad-blockers, ITP, and iOS
opt-outs can't drop them. Two events are tracked:

| Event   | Fired from                                   | Meta event            | Google |
| ------- | -------------------------------------------- | --------------------- | ------ |
| Signup  | `POST /api/auth/register`                    | `CompleteRegistration`| signup destination |
| Purchase| Stripe `checkout.session.completed` webhook  | `Purchase` (+value)   | purchase destination |

Everything is a **no-op until configured** (mirrors PostHog/Sentry), and nothing
is transmitted to Meta/Google unless the user has granted **marketing consent**.

## How attribution works without a pixel

Match quality comes from **click IDs captured on landing** plus a hashed email:

1. A visitor lands from an ad with `?fbclid=…` (Meta) or `?gclid=…` (Google).
2. `AdClickCapture` (mounted app-wide) POSTs them to `/api/ads/click`, which
   stores them in a first-party, httpOnly cookie (`sov_ad_click`).
3. At **signup** the click IDs + consent decision are persisted onto the `User`
   row (`fbclid`, `gclid`, `adClickCapturedAt`, `marketingConsent`).
4. At **purchase** the Stripe webhook has **no browser context** — no IP, no
   user-agent, no cookie. It reads the stored click IDs + hashed email off the
   `User` row, which is the only thing that makes the paid conversion
   attributable.

`event_id` / `transactionId` are deterministic (`signup:<userId>`,
`purchase:<stripeSessionId>`) for idempotency and clean dedup if a browser pixel
is ever added later.

## Consent

Sending hashed email / click IDs to Meta/Google is marketing processing of
personal data and is gated on consent:

- `ConsentBanner` records the decision via `/api/consent` (cookie + persisted to
  `User.marketingConsent` when logged in).
- `src/lib/ads` refuses to transmit unless `consent === true`.
- `/api/ads/click` still stores click IDs first-party when the decision is
  *undecided* (so attribution isn't lost before the banner is answered) but
  skips storage entirely on an explicit marketing opt-out. Nothing leaves the
  server until consent is granted.

## Configuration

See `.env.example` for the full list. Each platform activates independently.

### Meta Conversions API

Events Manager → your dataset → Settings → Conversions API.

```
META_PIXEL_ID=...            # numeric pixel/dataset id
META_CAPI_ACCESS_TOKEN=...   # system-user token
META_GRAPH_API_VERSION=v21.0 # optional
META_CAPI_TEST_EVENT_CODE=...# optional; routes to Test Events while validating
```

Validate with a `META_CAPI_TEST_EVENT_CODE` set — events appear under
Events Manager → Test Events in real time.

### Google Ads (Data Manager API)

This uses the **Data Manager API** (`events:ingest`), **not** the deprecated
Google Ads API `UploadClickConversions` (deprecation began 2026-06-15).

1. Create a service account; grant it the `datamanager` scope and link it in
   Google Ads (Data Manager access).
2. Each conversion action is a "destination" — get the destination id for your
   signup and purchase conversions.

```
GOOGLE_DM_SERVICE_ACCOUNT_JSON=...   # key JSON, raw or base64
GOOGLE_ADS_CUSTOMER_ID=...           # operating account, digits only
GOOGLE_ADS_LOGIN_CUSTOMER_ID=...     # optional, manager (MCC) id
GOOGLE_DM_SIGNUP_DESTINATION_ID=...
GOOGLE_DM_PURCHASE_DESTINATION_ID=...
```

## Schema

Adds five nullable columns to `User`: `fbclid`, `gclid`, `adClickCapturedAt`,
`marketingConsent`, `consentUpdatedAt`. Apply via the project's usual
`npm run db:push` (or generate a migration).

## Files

```
src/lib/ads/hash.ts        PII normalization + SHA-256
src/lib/ads/click-ids.ts   click-ID cookie + fbc construction
src/lib/ads/meta.ts        Meta CAPI client
src/lib/ads/google.ts      Google Data Manager client
src/lib/ads/index.ts       facade: consent gate, fire-and-forget, error isolation
src/lib/consent.ts         consent cookie model
src/app/api/ads/click/     click-ID capture endpoint
src/app/api/consent/       consent endpoint
src/components/ad-click-capture.tsx
src/components/consent-banner.tsx
```
