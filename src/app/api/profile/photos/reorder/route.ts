import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_PHOTOS } from "@/lib/validation/profile";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const orderedIds: unknown = body?.orderedIds;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return NextResponse.json({ error: "Missing orderedIds." }, { status: 400 });
  }
  if (orderedIds.length > MAX_PHOTOS) return NextResponse.json({ error: "Too many photos." }, { status: 400 });
  const ids = orderedIds.map(String);
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "Duplicate ids." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("id, user_id").eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const { data: photos } = await supabase.from("profile_photos").select("id, profile_id").eq("profile_id", profile.id);
  const ownIds = new Set((photos ?? []).map((p) => p.id));
  if (ids.length !== ownIds.size) {
    // Must reorder exactly all photos; partial reorder is not allowed to keep display_order dense
    return NextResponse.json({ error: "Must provide all photo ids in order." }, { status: 400 });
  }
  for (const id of ids) {
    if (!ownIds.has(id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // Two-phase update to avoid unique constraint on (profile_id, display_order).
  // Rows are independent, so each phase runs concurrently (2 batches total
  // instead of 2N sequential round-trips).
  const phase1 = await Promise.all(
    ids.map((id, i) => supabase.from("profile_photos").update({ display_order: 100 + i }).eq("id", id)),
  );
  if (phase1.some((r) => r.error)) return NextResponse.json({ error: "Could not reorder." }, { status: 400 });
  const phase2 = await Promise.all(
    ids.map((id, i) => supabase.from("profile_photos").update({ display_order: i }).eq("id", id)),
  );
  if (phase2.some((r) => r.error)) return NextResponse.json({ error: "Could not reorder." }, { status: 400 });

  const { data: reordered } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order");

  const mapped = (reordered || []).map((p) => ({
    ...p,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));
  return NextResponse.json({ photos: mapped });
}
