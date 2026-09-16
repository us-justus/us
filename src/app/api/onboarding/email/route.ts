import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateOptionalEmail } from "@/lib/validation/email";

export async function POST(req: Request) {
  const { email } = await req.json().catch(()=>({}));
  const val = email ? String(email).trim() : null;
  const err = validateOptionalEmail(val || "");
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const { error } = await supabase.from("verification_records").upsert({ user_id: user.id, email: val }, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: "Could not save email." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
