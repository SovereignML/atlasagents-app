import { describe, it, expect } from "vitest"

import { findDrops, parseAllowList, parseExportedSchema } from "./schema-guard"

const EXPORTED = `CREATE TABLE "Account" (
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "Account_pkey" PRIMARY KEY("provider","userId")
);

CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"deletedAt" timestamp
);
`

describe("parseExportedSchema", () => {
  it("reads tables and their columns, not constraints", () => {
    const t = parseExportedSchema(EXPORTED)
    expect([...t.keys()]).toEqual(["Account", "User"])
    expect([...t.get("Account")!]).toEqual(["userId", "provider"])
    expect([...t.get("User")!]).toEqual(["id", "email", "deletedAt"])
  })
})

describe("findDrops", () => {
  const schema = parseExportedSchema(EXPORTED)
  const live = new Map([
    ["Account", new Set(["userId", "provider"])],
    ["User", new Set(["id", "email", "legacyFlag"])],
    ["ApiToken", new Set(["id", "hash"])],
  ])

  it("lists tables and columns a push would drop", () => {
    expect(findDrops(schema, live, new Set())).toEqual({
      tables: ["ApiToken"],
      columns: ["User.legacyFlag"],
    })
  })

  it("ignores columns the schema adds (a push only adds those)", () => {
    expect(findDrops(schema, live, new Set()).columns).not.toContain("User.deletedAt")
  })

  it("accepts explicitly allowed drops", () => {
    expect(findDrops(schema, live, parseAllowList("ApiToken, User.legacyFlag"))).toEqual({
      tables: [],
      columns: [],
    })
  })
})
