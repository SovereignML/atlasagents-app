// Pure unit tests for white-label branding helpers. No DB / env required:
//   npm run test:white-label
//
// Covers: CSS color validation (injection guard), host normalization,
// custom-domain parsing/validation, CNAME target resolution, and the scoped
// theme-CSS builder.
//
// Uses dynamic imports after setting a dummy DATABASE_URL so importing the
// helper modules (which transitively import @/db) doesn't throw — no actual
// DB connection is ever opened because only pure functions are called.

process.env.DATABASE_URL ??= "postgres://test"
process.env.NEXT_PUBLIC_APP_URL = "https://app.atlasagents.dev"
delete process.env.WHITELABEL_CNAME_TARGET

let failures = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

async function main() {
  const { isValidCssColor, sanitizeColor, buildBrandingCss } = await import(
    "../src/lib/tenant-branding"
  )
  const { isCanonicalHost, normalizeHost, normalizeCustomDomain, getCnameTarget } =
    await import("../src/lib/host")

  console.log("isValidCssColor — accepts valid colors")
  {
    for (const c of ["#fff", "#015efe", "#015efeff", "rgb(1,2,3)", "rgba(1, 2, 3, 0.5)"]) {
      assert(isValidCssColor(c), `accepts ${c}`)
    }
    assert(isValidCssColor("  #ABCDEF  "), "trims before validating")
  }

  console.log("isValidCssColor — rejects unsafe / invalid input (injection guard)")
  {
    for (const c of [
      "red",
      "url(x)",
      "#xyz",
      "#12",
      "#fff;}body{display:none}",
      "rgb(1,2,3);x:y",
      "expression(alert(1))",
      "var(--x)",
      "",
    ]) {
      assert(!isValidCssColor(c), `rejects ${JSON.stringify(c)}`)
    }
  }

  console.log("sanitizeColor")
  {
    assert(sanitizeColor("#015efe") === "#015efe", "returns valid color")
    assert(sanitizeColor("  #fff ") === "#fff", "trims valid color")
    assert(sanitizeColor("red") === null, "null for invalid")
    assert(sanitizeColor(null) === null, "null for null")
    assert(sanitizeColor("") === null, "null for empty")
  }

  console.log("normalizeHost")
  {
    assert(normalizeHost("App.Example.com:3000") === "app.example.com", "lowercases + strips port")
    assert(normalizeHost("  x.com  ") === "x.com", "trims")
    assert(normalizeHost("") === null, "null for empty")
    assert(normalizeHost(null) === null, "null for null")
  }

  console.log("isCanonicalHost (NEXT_PUBLIC_APP_URL=app.atlasagents.dev)")
  {
    assert(isCanonicalHost("app.atlasagents.dev"), "app url host is canonical")
    assert(isCanonicalHost("atlasagents.dev"), "branding apex is canonical")
    assert(isCanonicalHost("www.atlasagents.dev"), "www apex is canonical")
    assert(isCanonicalHost("localhost"), "localhost is canonical")
    assert(!isCanonicalHost("app.agency.com"), "a custom domain is NOT canonical")

    // Regression guard for the Atlas Agents rename: the pre-rename hosts stay
    // canonical while they still resolve here, so they can't be claimed as
    // tenant white-label domains. Driven by BRANDING.legacyDomains.
    assert(isCanonicalHost("sovereignml.com"), "legacy apex is still canonical")
    assert(isCanonicalHost("www.sovereignml.com"), "legacy www is still canonical")
    assert(isCanonicalHost("app.sovereignml.com"), "legacy app host is still canonical")
  }

  console.log("normalizeCustomDomain")
  {
    assert(normalizeCustomDomain("app.agency.com") === "app.agency.com", "valid subdomain")
    assert(
      normalizeCustomDomain("HTTPS://App.Agency.com/dashboard") === "app.agency.com",
      "strips scheme/path, lowercases",
    )
    assert(normalizeCustomDomain("app.agency.com:443") === "app.agency.com", "strips port")
    assert(normalizeCustomDomain("agency.com") === "agency.com", "apex allowed")
    assert(normalizeCustomDomain("not a domain") === null, "rejects spaces")
    assert(normalizeCustomDomain("localhost") === null, "rejects single label")
    assert(
      normalizeCustomDomain("app.atlasagents.dev") === null,
      "rejects the platform's own canonical host",
    )
    assert(
      normalizeCustomDomain("app.sovereignml.com") === null,
      "rejects a legacy canonical host",
    )
    assert(normalizeCustomDomain("") === null, "rejects empty")
  }

  console.log("getCnameTarget")
  {
    // Prod keeps this pointed at the legacy target until tenant CNAMEs migrate.
    process.env.WHITELABEL_CNAME_TARGET = "cname.sovereignml.com"
    assert(getCnameTarget() === "cname.sovereignml.com", "explicit env wins")
    delete process.env.WHITELABEL_CNAME_TARGET
    assert(getCnameTarget() === "app.atlasagents.dev", "falls back to app url host")
  }

  console.log("buildBrandingCss")
  {
    const base = {
      teamId: "t1",
      brandName: "Acme",
      logoUrl: null,
      logoMarkUrl: null,
      faviconUrl: null,
      supportEmail: "s@a.com",
      primaryLight: null as string | null,
      accentLight: null as string | null,
      primaryDark: null as string | null,
      accentDark: null as string | null,
      isWhiteLabel: true,
    }

    assert(buildBrandingCss({ ...base, isWhiteLabel: false }) === "", "empty when not white-label")
    assert(buildBrandingCss(base) === "", "empty when no colors set")

    const lightOnly = buildBrandingCss({ ...base, primaryLight: "#015efe" })
    assert(
      lightOnly.includes(".app-shell{") &&
        lightOnly.includes("--primary:#015efe") &&
        lightOnly.includes("--sidebar-primary:#015efe"),
      "light primary maps to --primary + --sidebar-primary",
    )
    assert(
      lightOnly.includes("--ring:#015efe") && !lightOnly.includes(".dark"),
      "ring falls back to primary; no dark block when no dark colors",
    )

    const both = buildBrandingCss({
      ...base,
      primaryLight: "#015efe",
      accentLight: "#d0f100",
      primaryDark: "#fafafa",
      accentDark: "#a3e635",
    })
    assert(both.includes(".app-shell{") && both.includes(".dark .app-shell{"), "emits light + dark blocks")
    assert(both.includes("--ring:#d0f100"), "distinct accent used for light ring")
    assert(both.includes("--ring:#a3e635"), "distinct accent used for dark ring")
  }

  console.log(failures === 0 ? "\nAll white-label tests passed." : `\n${failures} test(s) failed.`)
  process.exit(failures > 0 ? 1 : 0)
}

void main()
