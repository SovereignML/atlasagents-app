import { describe, expect, it } from "vitest"
import { gunzipSync } from "node:zlib"
import { LINODE_USER_DATA_MAX_BYTES, linodeUserData } from "./linode-user-data"
import { renderUniversalBootstrap } from "./runtimes/universal"

/** Linode refuses user-data over 16 KB once decoded; cloud-init unpacks gzip user-data itself. */
describe("linodeUserData", () => {
  it("sends a script that fits as plain base64, as before", () => {
    const script = "#!/bin/bash\necho hi\n"
    expect(Buffer.from(linodeUserData(script), "base64").toString("utf8")).toBe(script)
  })

  it("gzips the universal warm-pool image, which is over the limit, back to the exact script", () => {
    const script = renderUniversalBootstrap()
    expect(Buffer.byteLength(script)).toBeGreaterThan(LINODE_USER_DATA_MAX_BYTES)
    const sent = Buffer.from(linodeUserData(script), "base64")
    expect(sent.length).toBeLessThanOrEqual(LINODE_USER_DATA_MAX_BYTES)
    expect(sent[0]).toBe(0x1f) // gzip magic, which cloud-init detects
    expect(sent[1]).toBe(0x8b)
    expect(gunzipSync(sent).toString("utf8")).toBe(script)
  })
})
