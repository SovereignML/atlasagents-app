import type { MetadataRoute } from "next"

export const dynamic = "force-static"

// The dashboard host is not a marketing surface — atlasagents.dev (the
// atlasagents-web repo) owns the sitemap and every page we want ranked. Only the
// sign-in / sign-up entry points and the public status page are crawlable here;
// everything behind auth, every API, and every token-in-URL route is not.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/login", "/register", "/status"],
        disallow: [
          "/dashboard",
          "/admin",
          "/tenant-admin",
          "/team",
          "/api",
          "/g/",
          "/tg/",
          "/verify-email",
          "/reset-password",
          "/forgot-password",
          "/banned",
        ],
      },
    ],
  }
}
