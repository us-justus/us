import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES, MAX_PHOTOS } from "@/lib/validation/profile";

function extFromType(t: string) {
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  return "jpg";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ photos: [] });
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order");
  const mapped = (photos || []).map((p) => ({
    ...p,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));
  return NextResponse.json({ photos: mapped });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Create profile first." }, { status: 400 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file." }, { status: 400 });
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(file.type))
    return NextResponse.json({ error: "Use JPG, PNG or WEBP." }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) return NextResponse.json({ error: "Max 5 MB per photo." }, { status: 400 });

  const { data: existingPhotos } = await supabase
    .from("profile_photos")
    .select("display_order")
    .eq("profile_id", profile.id);
  if ((existingPhotos?.length || 0) >= MAX_PHOTOS)
    return NextResponse.json({ error: `Max ${MAX_PHOTOS} photos.` }, { status: 400 });

  // Determine next display_order: max + 1, handling gaps from deletions
  let nextOrder = 0;
  if (existingPhotos && existingPhotos.length) {
    nextOrder = Math.max(...existingPhotos.map((p) => p.display_order)) + 1;
    // clamp if somehow out of range, find first free slot
    if (nextOrder > 5) {
      const used = new Set(existingPhotos.map((p) => p.display_order));
      for (let i = 0; i < MAX_PHOTOS; i++) if (!used.has(i)) { nextOrder = i; break; }
    }
  }

  const ext = extFromType(file.type);
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from("profile-photos").upload(path, buf, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) return NextResponse.json({ error: "Upload failed." }, { status: 400 });
  const { error: dbErr } = await supabase.from("profile_photos").insert({
    profile_id: profile.id,
    storage_path: path,
    display_order: nextOrder,
  });
  if (dbErr) {
    await supabase.storage.from("profile-photos").remove([path]);
    return NextResponse.json({ error: "Could not save photo." }, { status: 400 });
  }
  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order");
  const mapped = (photos || []).map((p) => ({
    ...p,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));
  return NextResponse.json({ photos: mapped });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const { data: photo } = await supabase
    .from("profile_photos")
    .select("id, storage_path, profile_id, display_order")
    .eq("id", id)
    .maybeSingle();
  if (!photo) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: profile } = await supabase.from("profiles").select("id, user_id").eq("id", photo.profile_id).maybeSingle();
  if (!profile || profile.user_id !== user.id) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  await supabase.from("profile_photos").delete().eq("id", id);
  await supabase.storage.from("profile-photos").remove([photo.storage_path]);

  // Compact display_order to 0..n-1 to avoid gaps
  const { data: remaining } = await supabase
    .from("profile_photos")
    .select("id, display_order")
    .eq("profile_id", profile.id)
    .order("display_order");
  if (remaining && remaining.length) {
    // Avoid unique constraint collision: first move to 100+ offset.
    // Rows are independent, so each phase runs concurrently (2 batches total
    // instead of 2N sequential round-trips).
    await Promise.all(
      remaining.map((r, i) => supabase.from("profile_photos").update({ display_order: 100 + i }).eq("id", r.id)),
    );
    await Promise.all(
      remaining.map((r, i) => supabase.from("profile_photos").update({ display_order: i }).eq("id", r.id)),
    );
  }

  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", profile.id)
    .order("display_order");
  const mapped = (photos || []).map((p) => ({
    ...p,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));
  return NextResponse.json({ photos: mapped });
}
