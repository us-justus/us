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

  const { data: photos } = await supabase.from("profile_photos").select("id, profile_id, storage_path").eq("profile_id", profile.id);
  const pathById = new Map((photos ?? []).map((p) => [p.id, p.storage_path] as const));
  const ownIds = new Set(pathById.keys());
  if (ids.length !== ownIds.size) {
    // Must reorder exactly all photos; partial reorder is not allowed to keep display_order dense
    return NextResponse.json({ error: "Must provide all photo ids in order." }, { status: 400 });
  }
  for (const id of ids) {
    if (!ownIds.has(id)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  // Ownership validated above, so every id resolves to a stored path.
  const orderedPaths = ids.map((id) => pathById.get(id) as string);

  // display_order carries a (profile_id, display_order) UNIQUE constraint plus
  // a 0..5 CHECK, so in-place updates would need out-of-range scratch values
  // that the CHECK forbids. Delete + re-insert instead: the delete frees the
  // unique keys, the insert writes dense 0..n-1 orders (also healing any gaps
  // left by deletions), and no other table references photo row IDs. Storage
  // objects are untouched — rows keep pointing at the same storage_path.
  const { error: delErr } = await supabase.from("profile_photos").delete().eq("profile_id", profile.id);
  if (delErr) return NextResponse.json({ error: "Could not reorder." }, { status: 400 });
  const { error: insErr } = await supabase
    .from("profile_photos")
    .insert(orderedPaths.map((storage_path, i) => ({ profile_id: profile.id, storage_path, display_order: i })));
  if (insErr) return NextResponse.json({ error: "Could not reorder." }, { status: 400 });

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
