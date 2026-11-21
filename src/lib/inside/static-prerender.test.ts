import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGE = new URL("../../app/inside/page.tsx", import.meta.url);

/**
 * Regression guard for the Nov 2026 /inside 500.
 *
 * /inside reads the inside_admin cookie and the live Supabase session at
 * request time. If it is allowed to be statically prerendered, a build whose
 * environment does not define ADMIN_SECRET_KEY short-circuits
 * requireInsideAdmin() before cookies() runs, so Next emits the login screen
 * as a static page. The Cloudflare Worker cannot serve that page and returns
 * the generic Server Components 500. force-dynamic makes the route
 * request-rendered regardless of build-time secrets.
 */
describe("/inside is request-rendered, never statically prerendered", () => {
  it("declares export const dynamic = \"force-dynamic\"", () => {
    const src = readFileSync(PAGE, "utf8");
    assert.match(
      src,
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']\s*;/,
      '/inside must declare `export const dynamic = "force-dynamic"` so a build without ADMIN_SECRET_KEY cannot statically prerender it.',
    );
  });
});
