import { describe, it, expect } from "vitest"

import {
  AGENT_CATEGORIES,
  CATEGORY_DIRECTIVES,
  DEFAULT_CATEGORY_SLUG,
  categoryDisplayName,
  directiveForSlug,
  findCategory,
  roleTitleForSlug,
} from "./agent-categories"

describe("AGENT_CATEGORIES", () => {
  it("is exactly the eight templates, in order", () => {
    // Order is product-visible: it is the order of the use-case grid in both
    // deploy wizards. "default" leads because every other entry is a
    // specialization of it; "custom" trails as the escape hatch.
    expect(AGENT_CATEGORIES.map((c) => c.slug)).toEqual([
      "default",
      "automation",
      "devops",
      "support",
      "research",
      "sales",
      "social",
      "custom",
    ])
  })

  it("no longer offers the retired Content Agent", () => {
    expect(AGENT_CATEGORIES.some((c) => c.slug === "content")).toBe(false)
  })

  it("names the social template as an Agent, not a Manager", () => {
    const social = findCategory("social")
    expect(social.name).toBe("Social Media Agent")
    // The persona job title is deliberately unchanged.
    expect(social.role).toBe("Social Media Manager")
  })

  it("has unique slugs and a directive for every template", () => {
    const slugs = AGENT_CATEGORIES.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(CATEGORY_DIRECTIVES[slug], `missing directive: ${slug}`).toBeTruthy()
      expect(roleTitleForSlug(slug)).toBeTruthy()
    }
  })

  it("keeps the content directive so already-deployed content agents keep their persona", () => {
    // The template is gone from the picker, but existing rows still carry
    // use_case="content" and regenerate their persona from this map.
    expect(directiveForSlug("content")).toBe(CATEGORY_DIRECTIVES.content)
    expect(directiveForSlug("content")).not.toBe(CATEGORY_DIRECTIVES.custom)
  })

  it("falls back to custom for an unknown slug", () => {
    expect(findCategory("no-such-template").slug).toBe("custom")
    expect(directiveForSlug("no-such-template")).toBe(CATEGORY_DIRECTIVES.custom)
  })
})

describe("categoryDisplayName", () => {
  it("names the default template after the runtime it runs", () => {
    expect(categoryDisplayName(DEFAULT_CATEGORY_SLUG, "hermes")).toBe("Default Hermes Agent")
    expect(categoryDisplayName(DEFAULT_CATEGORY_SLUG, "openclaw")).toBe("Default OpenClaw Agent")
  })

  it("never renders a runtime it cannot label", () => {
    // Guards the "Default undefined Agent" bug for a missing, null or
    // unrecognized runtime.
    for (const runtime of [undefined, null, "", "nomad-engine"]) {
      expect(categoryDisplayName(DEFAULT_CATEGORY_SLUG, runtime)).toBe("Default Agent")
    }
  })

  it("leaves every specialization's name alone regardless of runtime", () => {
    for (const c of AGENT_CATEGORIES.filter((c) => c.slug !== DEFAULT_CATEGORY_SLUG)) {
      expect(categoryDisplayName(c.slug, "hermes")).toBe(c.name)
      expect(categoryDisplayName(c.slug, undefined)).toBe(c.name)
    }
  })
})
