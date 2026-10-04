import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  INSIDE_COOKIE,
  clearInsideCookieHeader,
  cookieAttrs,
  setInsideCookieHeader,
} from "./cookie.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("inside_admin cookie", () => {
  it("uses the stable cookie name (no __Host- prefix: incompatible with http dev)", () => {
    assert.equal(INSIDE_COOKIE, "inside_admin");
  });

  it("sets HttpOnly, SameSite=Lax, Path=/, and the 12h Max-Age", () => {
    const h = setInsideCookieHeader("v123");
    assert.match(h, /^inside_admin=v123;/);
    assert.match(h, /Path=\/;/);
    assert.match(h, /HttpOnly/);
    assert.match(h, /SameSite=Lax/);
    assert.match(h, /Max-Age=43200/);
  });

  it("keeps Path=/ (required: sent to both /inside and /api/inside/*)", () => {
    assert.match(cookieAttrs(60), /Path=\/;/);
    assert.doesNotMatch(cookieAttrs(60), /Path=\/inside/);
  });

  it("never sets Domain (host-only cookie)", () => {
    assert.doesNotMatch(cookieAttrs(60), /Domain=/i);
  });

  it("sets Secure only in production", () => {
    if (process.env.NODE_ENV !== "production") {
      assert.doesNotMatch(cookieAttrs(60), /Secure/);
    }
    const prod = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import('./src/lib/inside/cookie.ts').then((m) => console.log(m.cookieAttrs(60)))",
      ],
      { cwd: REPO_ROOT, env: { ...process.env, NODE_ENV: "production" }, encoding: "utf8" },
    );
    assert.match(prod, /; Secure/);
  });

  it("clears with Max-Age=0 and an empty value", () => {
    const h = clearInsideCookieHeader();
    assert.match(h, /^inside_admin=;/);
    assert.match(h, /Max-Age=0/);
    assert.match(h, /HttpOnly/);
  });
});
