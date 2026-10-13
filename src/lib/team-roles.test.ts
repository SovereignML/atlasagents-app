import { describe, it, expect } from "vitest"

import { canDeploy } from "./team-roles"

describe("canDeploy", () => {
  it("lets developers and above deploy", () => {
    expect(canDeploy("owner")).toBe(true)
    expect(canDeploy("admin")).toBe(true)
    expect(canDeploy("developer")).toBe(true)
  })

  it("refuses viewers, non-members and unknown roles", () => {
    expect(canDeploy("viewer")).toBe(false)
    expect(canDeploy(null)).toBe(false)
    expect(canDeploy(undefined)).toBe(false)
    expect(canDeploy("superuser")).toBe(false)
  })
})
