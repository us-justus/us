import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/validation/profile";
import { requireVerifiedEmailForWrite } from "@/lib/onboarding/require-verified-email";
import { sniffImageMime } from "@/lib/photos/sniff";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { perfLog, perfStart } from "@/lib/utils/perf";

function extFromType(t: string) { if (t==="image/png") return "png"; if (t==="image/webp") return "webp"; return "jpg"; }

type FinalizeResult = { spot: number | null; spotPending: boolean };

function parseFinalize(data: unknown): FinalizeResult {
  if (typeof data === "number" && Number.isInteger(data) && data > 0) {
    return { spot: data, spotPending: false };
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const spot = (data as { spot?: unknown }).spot;
    if (typeof spot === "number" && Number.isInteger(spot) && spot > 0) {
      return { spot, spotPending: false };
    }
  }
  return { spot: null, spotPending: true };
}

/**
 * Server-owned completion finalization (short-circuited).
 *
 * The permanent campus spot is minted only at the completion boundary —
 * after at least one durable photo row exists — via the idempotent
 * finalize_onboarding_completion() RPC (existing spot/claim reused, never a
 * second allocation). When the profile already holds a spot this performs
 * one indexed read and never touches the allocator, so steady-state
 * holders (including all pre-change users) pay no allocator call.
 */
async function tryFinalizeSpot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  privileged: ReturnType<typeof createServiceRoleClient>,
  userId: string,
): Promise<FinalizeResult> {
  const { data: row } = await privileged
    .from("profiles")
    .select("spot")
    .eq("user_id", userId)
    .maybeSingle();
  const current = row as { spot: number | null } | null;
  if (current?.spot != null) return { spot: current.spot, spotPending: false };
  try {
    const { data, error } = await supabase.rpc("finalize_onboarding_completion");
    if (error) {
      if (String(process.env.NODE_ENV) !== "production") console.error("[photos] finalize error", error.code);
      return { spot: current?.spot ?? null, spotPending: true };
    }
    return parseFinalize(data);
  } catch {
    return { spot: current?.spot ?? null, spotPending: true };
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const privileged = createServiceRoleClient();
  const { data: profile } = await privileged.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ photos: [], spot: null, spotPending: false });
  const { data: photos } = await supabase.from("profile_photos").select("id, storage_path, display_order").eq("profile_id", profile.id).order("display_order");
  const mapped = (photos||[]).map(p=>({ ...p, url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl }));
  // Re-entry convergence: a photo that committed while finalization never
  // ran (browser closed, lost response, transient allocator failure)
  // finalizes here, idempotently, before the client decides where to go.
  // Short-circuited when the spot already exists — no allocator call.
  let spot: number | null = null;
  let spotPending = false;
  if (mapped.length > 0) {
    ({ spot, spotPending } = await tryFinalizeSpot(supabase, privileged, user.id));
  }
  return NextResponse.json({ photos: mapped, spot, spotPending });
}

export async function POST(req: Request) {
  const t = perfStart();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  // Email-required completion guard: blocks photo uploads that bypass
  // email verification (same invariant as profile writes + completion).
  const gate = await requireVerifiedEmailForWrite(supabase, user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, emailRequired: true }, { status: gate.status });
  }
  const privileged = createServiceRoleClient();
  const { data: profile } = await privileged.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Create profile first." }, { status: 400 });
  const form = await req.formData().catch(()=>null);
  const file = form?.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "Max 5 MB per photo." }, { status: 400 });
  const { data: existingPhotos } = await supabase.from("profile_photos").select("display_order").eq("profile_id", profile.id);
  if ((existingPhotos?.length || 0) >= MAX_PHOTOS) return NextResponse.json({ error: `Max ${MAX_PHOTOS} photos.` }, { status: 400 });
  let display_order = 0;
  if (existingPhotos && existingPhotos.length) {
    display_order = Math.max(...existingPhotos.map((p) => p.display_order)) + 1;
    if (display_order > 5) {
      const used = new Set(existingPhotos.map((p) => p.display_order));
      for (let i = 0; i < MAX_PHOTOS; i++) if (!used.has(i)) { display_order = i; break; }
    }
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffImageMime(buf);
  if (!mime || (file.type && file.type !== mime)) return NextResponse.json({ error: "Use a valid JPG, PNG or WEBP image." }, { status: 400 });
  const ext = extFromType(mime);
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error: upErr } = await privileged.storage.from("profile-photos").upload(path, buf, { contentType: mime, upsert: false });
  if (upErr) return NextResponse.json({ error: "Upload failed." }, { status: 400 });
  const { error: dbErr } = await supabase.from("profile_photos").insert({ profile_id: profile.id, storage_path: path, display_order });
  if (dbErr) {
    // Storage succeeded but the row did not — remove this operation's object
    // so it is not silently orphaned. Existing user photos are untouched.
    await privileged.storage.from("profile-photos").remove([path]);
    return NextResponse.json({ error: "Could not save photo." }, { status: 400 });
  }
  const { data: photos } = await supabase.from("profile_photos").select("id, storage_path, display_order").eq("profile_id", profile.id).order("display_order");
  const mapped = (photos||[]).map(p=>({ ...p, url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl }));
  perfLog("photo.upload", t);
  // Completion finalization runs ONLY after the photo row has durably
  // committed above — never before validation, storage, or DB insertion.
  // Finalization failure preserves the photo: the response stays 200 with
  // spotPending so the next valid re-entry (GET/POST) retries idempotently
  // instead of the client re-uploading a duplicate photo.
  const { spot, spotPending } = await tryFinalizeSpot(supabase, privileged, user.id);
  return NextResponse.json({ photos: mapped, spot, spotPending });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const privileged = createServiceRoleClient();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { data: photo } = await supabase.from("profile_photos").select("id, storage_path, profile_id").eq("id", id).maybeSingle();
  if (!photo) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: profile } = await privileged.from("profiles").select("id, user_id").eq("id", photo.profile_id).maybeSingle();
  if (!profile || profile.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  await supabase.from("profile_photos").delete().eq("id", id);
  try { await createServiceRoleClient().storage.from("profile-photos").remove([photo.storage_path]); } catch {}
  // Compact display_order to avoid gaps for future reorders.
  // Rows are independent, so each phase runs concurrently (2 batches total
  // instead of 2N sequential round-trips). Two phases are still required to
  // avoid colliding with the (profile_id, display_order) unique constraint.
  const { data: remaining } = await supabase.from("profile_photos").select("id, display_order").eq("profile_id", profile.id).order("display_order");
  if (remaining && remaining.length) {
    await Promise.all(
      remaining.map((r, i) => supabase.from("profile_photos").update({ display_order: 100 + i }).eq("id", r.id)),
    );
    await Promise.all(
      remaining.map((r, i) => supabase.from("profile_photos").update({ display_order: i }).eq("id", r.id)),
    );
  }
  const { data: photos } = await supabase.from("profile_photos").select("id, storage_path, display_order").eq("profile_id", profile.id).order("display_order");
  const mapped = (photos||[]).map(p=>({ ...p, url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl }));
  return NextResponse.json({ photos: mapped });
}
