import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";

export async function POST(req: Request) {
  const { usn } = await req.json().catch(()=>({}));
  const normalized = normalizeUSN(String(usn||""));
  if (!validateUSN(normalized)) return NextResponse.json({ error: "Enter a valid USN." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { error } = await supabase.from("verification_records").upsert({ user_id: user.id, usn: normalized, verification_status: "verified" }, { onConflict: "user_id" });
  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate")) return NextResponse.json({ error: "This USN is already associated with an account." }, { status: 409 });
    return NextResponse.json({ error: "Could not save USN." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
