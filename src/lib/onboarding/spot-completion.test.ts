import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Spot-completion lifecycle (allocate at durable completion, not creation).
 *
 * LOCKED INVARIANT: the permanent campus spot is an entry/completion number.
 * A profile-only account (zero photos) consumes NO spot. Allocation happens
 * at the completion boundary — after the first durable profile_photos row
 * commits — via the idempotent finalize_onboarding_completion() RPC, and a
 * profile with photos but a NULL spot is NOT fully complete (retryable
 * finalization; resolves to the existing `photos` step until the spot
 * exists). Waiting stays photo-based; existing spots are never touched.
 *
 * These tests pin the wiring statically (repo convention: no live DB in
 * unit tests). They assert call-site placement, ordering, idempotency, and
 * that no second allocation path exists.
 */

const profileRouteUrl = new URL(
  "../../app/api/onboarding/photos/route.ts",
  import.meta.url,
);
const createProfileRouteUrl = new URL(
  "../../app/api/onboarding/profile/route.ts",
  import.meta.url,
);
const stateUrl = new URL("./state.ts", import.meta.url);
const finalizeMigrationUrl = new URL(
  "../../../supabase/migrations/20261024000001_onboarding_completion_finalize.sql",
  import.meta.url,
);
const allocatorMigrationUrl = new URL(
  "../../../supabase/migrations/20261022000001_allocate_spot_reject_admin.sql",
  import.meta.url,
);
const foundationMigrationUrl = new URL(
  "../../../supabase/migrations/20250930000001_prelaunch_foundation.sql",
  import.meta.url,
);
const waitlistMigrationUrl = new URL(
  "../../../supabase/migrations/20261017000002_waitlist_count.sql",
  import.meta.url,
);

async function read(url: URL): Promise<string> {
  return readFile(url, "utf8");
}

describe("spot completion: profile creation does not allocate", () => {
  it("1. profile POST never calls the allocator", async () => {
    const src = await read(createProfileRouteUrl);
    assert.ok(
      !src.includes('rpc("allocate_campus_spot")') &&
        !src.includes("rpc('allocate_campus_spot')"),
      "profile creation must not invoke allocate_campus_spot in any quoting style",
    );
  });

  it("2. new profiles are written with spot NULL (legal nullable column)", async () => {
    const src = await read(createProfileRouteUrl);
    assert.ok(
      src.includes("prev?.spot ?? null"),
      "first-time profiles must carry spot NULL forward",
    );
    const foundation = await read(foundationMigrationUrl);
    assert.ok(
      foundation.includes("profiles_spot_positive"),
      "spot positivity check must remain (NULL-tolerant)",
    );
    assert.doesNotMatch(
      foundation,
      /\bspot\s+(int|integer)\s+not\s+null/i,
      "profiles.spot must stay nullable — no NOT NULL may be introduced (\\b excludes next_spot)",
    );
  });

  it("3. existing spots are preserved exactly, never cleared or replaced", async () => {
    const src = await read(createProfileRouteUrl);
    assert.ok(
      src.includes("prev?.spot ?? null"),
      "existing spot must be reused verbatim",
    );
    assert.doesNotMatch(
      src,
      /spot:\s*null\b/,
      "profile upsert must never write a literal NULL over an existing spot",
    );
  });

  it("20. no code path allocates from profile creation anymore", async () => {
    const src = await read(createProfileRouteUrl);
    assert.ok(!src.includes("campus_spot_claims"), "profile route must not touch claims");
    assert.ok(!src.includes("next_spot"), "profile route must not touch the counter");
  });
});

describe("spot completion: finalize RPC owns allocation", () => {
  it("finalize function exists with fixed search_path + authenticated-only grant", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.ok(
      sql.includes("create or replace function public.finalize_onboarding_completion()"),
      "additive finalize function must exist",
    );
    assert.match(
      sql,
      /set search_path = pg_catalog, public, auth, pg_temp/,
      "fixed search_path required (existing security convention)",
    );
    assert.match(
      sql,
      /revoke all on function public\.finalize_onboarding_completion\(\) from public, anon/i,
      "anon/public must stay revoked",
    );
    assert.match(
      sql,
      /grant execute on function public\.finalize_onboarding_completion\(\) to authenticated/i,
      "authenticated-only EXECUTE required",
    );
  });

  it("11. admin finalization is rejected before consuming anything", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.match(
      sql,
      /if\s+public\.is_admin\(\)\s+then\s+raise exception[^;]*42501/,
      "admin refusal via is_admin() with 42501 required",
    );
    const guardAt = sql.search(/public\.is_admin\(\)/);
    const consumeAt = sql.search(/select public\.allocate_campus_spot\(\) into v_spot/);
    assert.ok(consumeAt > 0, "allocator composition must exist");
    assert.ok(guardAt < consumeAt, "admin refusal must precede any allocator call");
  });

  it("12. anonymous finalization is rejected", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.match(
      sql,
      /if\s+v_user\s+is\s+null\s+then\s+raise exception[^;]*42501/,
      "null auth.uid() must raise 42501",
    );
  });

  it("completion preconditions: owned profile + username + >=1 durable photo", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.ok(sql.includes("where p.user_id = v_user"), "must operate only on auth.uid()");
    assert.doesNotMatch(
      sql,
      /p_user_id|p_invitee|user_id\s*uuid|in\s+p_/i,
      "must never accept an arbitrary user_id from the caller",
    );
    assert.ok(sql.includes("raise exception 'profile required'"), "missing profile must raise");
    assert.ok(sql.includes("raise exception 'username required'"), "missing username must raise");
    assert.ok(
      sql.includes("from public.profile_photos ph where ph.profile_id = v_profile_id"),
      "photo existence must be verified for the caller's own profile",
    );
    assert.ok(sql.includes("raise exception 'photo required'"), "zero photos must raise");
  });

  it("6/7. existing spot short-circuits before any allocator call (idempotent)", async () => {
    const sql = await read(finalizeMigrationUrl);
    const earlyAt = sql.indexOf("already_allocated', true");
    const allocAt = sql.indexOf("select public.allocate_campus_spot() into v_spot");
    assert.ok(earlyAt > 0 && allocAt > 0, "both paths must exist");
    assert.ok(earlyAt < allocAt, "existing spot must return before the allocator runs");
  });

  it("E. allocation reuses existing machinery (no duplicated allocator logic)", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.ok(
      sql.includes("select public.allocate_campus_spot() into v_spot"),
      "must compose the existing atomic allocator, not re-implement the bump",
    );
    assert.doesNotMatch(
      sql,
      /next_spot\s*=\s*next_spot\s*\+\s*1/,
      "must not duplicate the counter increment",
    );
  });

  it("F. spot write is NULL -> allocated, caller-owned row only", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.match(
      sql,
      /update public\.profiles set spot = v_spot\s+where user_id = v_user and spot is null/i,
      "only the NULL -> allocated transition on the caller's row is allowed",
    );
  });

  it("9. concurrent finalizes collapse to one spot (claim + guarded update)", async () => {
    const allocator = await read(allocatorMigrationUrl);
    assert.match(allocator, /on conflict \(user_id\) do nothing/i, "claim idempotency required");
    const sql = await read(finalizeMigrationUrl);
    const updateAt = sql.indexOf("where user_id = v_user and spot is null");
    const reselectAt = sql.indexOf("select p.spot into v_spot from public.profiles");
    assert.ok(updateAt > 0 && reselectAt > updateAt, "loser must re-read the committed spot");
  });

  it("8/10. duplicate finalization cannot increment the allocator or claim twice", async () => {
    const sql = await read(finalizeMigrationUrl);
    // Second call for a holder returns before allocate_campus_spot() runs.
    const earlyAt = sql.indexOf("already_allocated', true");
    const allocAt = sql.indexOf("select public.allocate_campus_spot() into v_spot");
    assert.ok(earlyAt < allocAt, "retry short-circuits: zero allocator calls, zero counter movement");
    const allocator = await read(allocatorMigrationUrl);
    assert.match(allocator, /on conflict \(user_id\) do nothing/i, "claim reuse, never a second claim");
  });

  it("19. existing users are untouched: no reset, no rewrite, no reclaim", async () => {
    const sql = await read(finalizeMigrationUrl);
    assert.doesNotMatch(sql, /next_spot\s*=\s*1/i, "counter must never reset");
    // Strip -- comments: prose names the forbidden operations, but no
    // statement may perform them (same convention as admin-spot-exclusion).
    const code = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    assert.doesNotMatch(code, /renumber|reclaim|delete from public\.campus_spot_claims|delete from public\.profiles/i, "no renumber/reclaim/delete paths may exist");
    assert.ok(
      !sql.includes("delete from public.campus_spot_claims") &&
        !sql.includes("delete from public.profiles"),
      "finalize must never delete claims or profiles",
    );
    assert.doesNotMatch(code, /alter table/i, "no schema changes in the finalize migration");
  });
});

describe("spot completion: photo route finalizes after durable insert", () => {
  it("4. first durable photo triggers finalization (and only after commit)", async () => {
    const src = await read(profileRouteUrl);
    const postAt = src.indexOf("export async function POST");
    const deleteAt = src.indexOf("export async function DELETE");
    const postBlock = src.slice(postAt, deleteAt);
    const insertAt = postBlock.indexOf('.from("profile_photos").insert(');
    const finalizeAt = postBlock.indexOf("tryFinalizeSpot(supabase, privileged, user.id)");
    assert.ok(insertAt > 0 && finalizeAt > 0, "POST must both insert and finalize");
    assert.ok(insertAt < finalizeAt, "finalize must run only after the photo row commits");
  });

  it("13/14/15. failed validation, storage, or DB insert never reaches finalization", async () => {
    const src = await read(profileRouteUrl);
    const postAt = src.indexOf("export async function POST");
    const deleteAt = src.indexOf("export async function DELETE");
    const postBlock = src.slice(postAt, deleteAt);
    const finalizeAt = postBlock.indexOf("tryFinalizeSpot(supabase, privileged, user.id)");
    assert.ok(finalizeAt > 0, "POST finalize call must exist");
    for (const marker of ["Max 5 MB per photo", "Upload failed.", "Could not save photo."]) {
      const at = postBlock.indexOf(marker);
      assert.ok(at > 0, `${marker} guard must exist`);
      assert.ok(at < finalizeAt, `${marker} must return before finalization`);
    }
    const mimeAt = postBlock.indexOf("sniffImageMime");
    assert.ok(mimeAt > 0 && mimeAt < finalizeAt, "MIME validation must precede finalization");
  });

  it("5. photo-less profiles hold no claim (profile route touches neither claims nor counter)", async () => {
    const src = await read(createProfileRouteUrl);
    assert.ok(!src.includes("campus_spot_claims"), "no claim row may be created at profile time");
    assert.ok(
      !src.includes('rpc("finalize_onboarding_completion")'),
      "profile route must not invoke finalization either (it only documents the owner in a comment)",
    );
  });

  it("16. finalize failure preserves the photo and stays retryable (200 + spotPending)", async () => {
    const src = await read(profileRouteUrl);
    // Scope to the POST success path: from the finalize call in POST to the
    // end of POST (before the DELETE handler). A finalize failure must flow
    // to the joint photo+spot response with no storage/row cleanup.
    const postAt = src.indexOf("export async function POST");
    const deleteAt = src.indexOf("export async function DELETE");
    assert.ok(postAt > 0 && deleteAt > postAt, "POST and DELETE handlers must exist");
    const postBlock = src.slice(postAt, deleteAt);
    const finalizeAt = postBlock.indexOf("tryFinalizeSpot(supabase, privileged, user.id)");
    assert.ok(finalizeAt > 0, "POST must finalize after the photo row commits");
    const afterFinalize = postBlock.slice(finalizeAt);
    assert.ok(!afterFinalize.includes(".delete()"), "a finalize failure must never delete the committed photo");
    assert.ok(!afterFinalize.includes(".remove(["), "a finalize failure must never remove the stored object");
    assert.ok(postBlock.includes("spotPending"), "pending finalization must be explicit in the response");
    assert.ok(
      postBlock.includes("NextResponse.json({ photos: mapped, spot, spotPending })"),
      "photo + spot state must be returned together",
    );
  });

  it("re-entry convergence: GET finalizes when photos exist but the spot is missing", async () => {
    const src = await read(profileRouteUrl);
    const getBlock = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
    assert.ok(
      getBlock.includes("finalize") || getBlock.includes("tryFinalizeSpot"),
      "GET must attempt convergence for browser-close / lost-response cases",
    );
    assert.ok(
      getBlock.includes("mapped.length > 0"),
      "convergence must only run when at least one photo exists",
    );
  });

  it("finalize is short-circuited when the spot already exists (no allocator calls)", async () => {
    const src = await read(profileRouteUrl);
    assert.ok(
      src.includes("if (current?.spot != null) return { spot: current.spot, spotPending: false }"),
      "holders must skip the RPC entirely",
    );
  });

  it("photo limit unchanged (MAX_PHOTOS=6)", async () => {
    const src = await read(profileRouteUrl);
    assert.ok(src.includes("MAX_PHOTOS"), "photo cap must remain enforced");
  });

  it("17. photo DELETE never releases the spot", async () => {
    const src = await read(profileRouteUrl);
    const deleteBlock = src.slice(src.indexOf("export async function DELETE"));
    assert.ok(!deleteBlock.includes("spot"), "DELETE must not read, clear, or reassign spots");
    assert.ok(!deleteBlock.includes("campus_spot_claims"), "DELETE must not touch claims");
  });
});

describe("spot completion: state machine treats photo+NULL spot as retryable", () => {
  it("profile + photo + spot NULL resolves to photos, not complete", async () => {
    const src = await read(stateUrl);
    assert.ok(src.includes("row.spot == null"), "NULL-spot check must exist on the photo tail");
    const nullAt = src.indexOf("row.spot == null");
    const photosAt = src.indexOf('return done("photos")', nullAt);
    const completeAt = src.indexOf('return done("complete")');
    assert.ok(nullAt > 0 && photosAt > nullAt, "NULL spot must resolve to the photos step");
    assert.ok(photosAt < completeAt, "complete must remain gated behind a non-null spot");
  });

  it("complete still requires verified email + profile + >=1 photo", async () => {
    const src = await read(stateUrl);
    assert.ok(src.includes("hasRealVerifiedEmail(user)"), "Auth gate must remain");
    assert.ok(src.includes("count < 1"), "photo-count threshold must remain");
    assert.ok(src.includes('return done("complete")'), "complete tail must remain");
  });
});

describe("spot completion: waiting stays photo-based, never spot-based", () => {
  it("18. get_waitlist_count has no spot predicate", async () => {
    const sql = await read(waitlistMigrationUrl);
    const fn = sql.slice(sql.indexOf("get_waitlist_count()"), sql.indexOf("admin_overview_counts"));
    assert.ok(fn.includes("profile_photos"), "photo predicate must remain");
    assert.ok(fn.includes("is_active"), "active predicate must remain");
    assert.doesNotMatch(fn, /spot/i, "waiting must not depend on spot in either direction");
  });
});
