import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getWaitlistCopy } from "./waitlist-copy.ts";

test("waitlist copy uses singular and plural grammar", () => {
  assert.equal(getWaitlistCopy(1), "1 is waiting with you.");
  assert.equal(getWaitlistCopy(0), "0 are waiting with you.");
  assert.equal(getWaitlistCopy(500), "500 are waiting with you.");
});

test("database admin and student counts share one aggregate source", () => {
  const migration = readFileSync(
    "supabase/migrations/20261017000002_waitlist_count.sql",
    "utf8",
  );
  assert.match(migration, /p\.is_active is distinct from false/);
  assert.match(migration, /from public\.profile_photos ph\s+where ph\.profile_id = p\.id/i);
  assert.match(migration, /v_waiting := public\.get_waitlist_count\(\)/);
  assert.match(migration, /returns integer[\s\S]*security definer[\s\S]*set search_path/);
  assert.match(migration, /grant execute on function public\.get_waitlist_count\(\) to authenticated/);
});

test("home passes a separate count alongside the untouched permanent spot", () => {
  const page = readFileSync("src/app/home/page.tsx", "utf8");
  const panel = readFileSync("src/components/prelaunch/prelaunch-panel.tsx", "utf8");
  assert.match(page, /spot=\{profile\?\.spot \?\? null\}/);
  assert.match(page, /waitlistCount=\{waitlistCount \?\? null\}/);
  assert.match(panel, /#\{spot \?\? "—"\}/);
  assert.match(panel, /getWaitlistCopy\(waitlistCount\)/);
});
