// What the Sentry SDK may collect, shared by the server, edge and browser inits
// (sentry.server.config.ts, sentry.edge.config.ts, src/instrumentation-client.ts).
// A plain constant, so it is safe in every runtime.
//
// Sentry v11 replaced `sendDefaultPii` with per-category `dataCollection`, and an
// unset `dataCollection` collects everything: user info, cookies, headers,
// request and response bodies, query strings. This is Sentry's documented
// baseline for keeping v10's `sendDefaultPii: false` (JavaScript SDK migration
// guide, v10 to v11), plus `stackFrameVariables: false`: v10 never captured
// local variable values unless asked to, and they can hold tokens and customer
// data.
import type { init } from "@sentry/nextjs"

type DataCollection = NonNullable<Parameters<typeof init>[0]["dataCollection"]>

// Name fragments that identify a client IP or user in header and query names
// (x-forwarded-for, x-real-ip, remote-addr, via, x-remote-user, ...).
const IP_AND_USER_KEYS = ["forwarded", "-ip", "remote-", "via", "-user"]

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: IP_AND_USER_KEYS },
    response: { deny: IP_AND_USER_KEYS },
  },
  httpBodies: [],
  urlQueryParams: { deny: IP_AND_USER_KEYS },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
  stackFrameVariables: false,
}
