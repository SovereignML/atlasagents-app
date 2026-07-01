import { describe, it, expect } from "vitest"
import { buildPipedBashCommand, decideElevation } from "./ssh-elevate"

describe("buildPipedBashCommand()", () => {
  it("unelevated: pipes into plain bash (root VPS/shared path, unchanged)", () => {
    const cmd = buildPipedBashCommand("echo hi", false)
    const expectedB64 = Buffer.from("echo hi", "utf8").toString("base64")
    expect(cmd).toBe(`echo '${expectedB64}' | base64 -d | bash`)
    expect(cmd).not.toContain("sudo")
  })

  it("defaults to unelevated when the flag is omitted", () => {
    expect(buildPipedBashCommand("echo hi")).not.toContain("sudo")
  })

  it("elevated: pipes into passwordless sudo bash (non-root BYOS user)", () => {
    const cmd = buildPipedBashCommand("apt-get update", true)
    const expectedB64 = Buffer.from("apt-get update", "utf8").toString("base64")
    // -n so a non-passwordless sudo fails fast instead of hanging on a prompt.
    expect(cmd).toBe(`echo '${expectedB64}' | base64 -d | sudo -n bash`)
  })

  it("base64 framing keeps quotes/newlines in the script off the command line", () => {
    const script = "echo 'a'\napt-get install -y \"pkg\""
    const cmd = buildPipedBashCommand(script, true)
    // The raw script never appears unescaped in the outer command.
    expect(cmd).not.toContain("apt-get install -y \"pkg\"")
    const b64 = cmd.split("'")[1]
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe(script)
  })
})

describe("decideElevation()", () => {
  it("root (uid 0): no sudo needed, does not require a sudo probe", () => {
    const elevate = decideElevation(
      { uidStdout: "0\n", uidCode: 0, sudoCode: null },
      "root",
    )
    expect(elevate).toBe(false)
  })

  it("non-root with passwordless sudo: elevate", () => {
    const elevate = decideElevation(
      { uidStdout: "1000\n", uidCode: 0, sudoCode: 0 },
      "ubuntu",
    )
    expect(elevate).toBe(true)
  })

  it("non-root without passwordless sudo: throws an actionable error", () => {
    expect(() =>
      decideElevation(
        {
          uidStdout: "1000",
          uidCode: 0,
          sudoCode: 1,
          sudoDetail: "sudo: a password is required",
        },
        "deploy",
      ),
    ).toThrowError(/passwordless sudo/i)
  })

  it("names the offending SSH user and surfaces the sudo probe detail", () => {
    try {
      decideElevation(
        { uidStdout: "1000", uidCode: 0, sudoCode: 1, sudoDetail: "sudo: a password is required" },
        "deploy",
      )
      throw new Error("expected decideElevation to throw")
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).toContain('"deploy"')
      expect(msg).toContain("sudo: a password is required")
    }
  })

  it("a login named root that is not actually uid 0 falls back to the sudo probe", () => {
    // Guards the exact bug the resolver replaced: don't trust the username
    // string. A "root" login reporting a non-zero uid must be treated as
    // non-root and go through the sudo path.
    expect(
      decideElevation({ uidStdout: "1000", uidCode: 0, sudoCode: 0 }, "root"),
    ).toBe(true)
  })
})
