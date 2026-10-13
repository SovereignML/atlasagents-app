import { describe, it, expect } from "vitest"

import { BlockedHostError } from "./net-guard"
import { publicFetch } from "./public-fetch"

// Every case is refused before a connection opens, so nothing leaves the box.
describe("publicFetch", () => {
  it.each([
    "http://127.0.0.1:3000/api/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://10.0.0.8/",
  ])("refuses the private address %s", async (url) => {
    await expect(publicFetch(url)).rejects.toBeInstanceOf(BlockedHostError)
  })

  it("refuses a name that resolves to loopback, at connect time", async () => {
    await expect(publicFetch("http://localhost:3000/")).rejects.toBeInstanceOf(BlockedHostError)
  })

  it("refuses non-http protocols", async () => {
    await expect(publicFetch("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedHostError)
  })
})
