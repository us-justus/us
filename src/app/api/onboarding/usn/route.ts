import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { decideUsnMutation, isDuplicateUsnError } from "@/lib/onboarding/usn-mutation";
import { perfLog, perfStart } from "@/lib/utils/perf";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(req: Request) {
  const t = perfStart();
  const { usn } = (await req.json().catch(() => ({}))) as { usn?: unknown };
  const normalized = normalizeUSN(String(usn || ""));
  if (!validateUSN(normalized)) return NextResponse.json({ error: "Enter a valid USN." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[onboarding/usn] auth lookup failed", authError.code);
      return NextResponse.json({ error: "Not authenticated.", details: authError.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // USN is immutable once a profile exists: reject any change past that
  // point (identical retry passes through idempotently — e.g. a returning
  // user re-submitting their own USN always succeeds, never 409s).
  const service = createServiceRoleClient();
  const [{ data: existingVr }, { data: existingProfile }] = await Promise.all([
    supabase.from("verification_records").select("usn").eq("user_id", user.id).maybeSingle(),
    service.from("profiles").select("id").eq("user_id", user.id).maybeSingle(),
  ]);
  const stored = existingVr?.usn ? normalizeUSN(String(existingVr.usn)) : "";
  const mutation = decideUsnMutation({
    hasProfile: Boolean(existingProfile),
    storedUsn: stored,
    submittedUsn: normalized,
  });
  if (mutation.action === "ok-idempotent") {
    perfLog("onboarding.usn", t);
    return NextResponse.json({ ok: true });
  }
  if (mutation.action === "reject-immutable") {
    return NextResponse.json({ error: "Your USN is already set and can't be changed." }, { status: 409 });
  }

  const { error } = await supabase.from("verification_records").upsert(
    { user_id: user.id, usn: normalized, verification_status: "verified" },
    { onConflict: "user_id" }
  );

  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[onboarding/usn] database write failed", error.code);

    if (isDuplicateUsnError(error)) {
      return NextResponse.json({ error: "This USN has already been registered." }, { status: 409 });
    }

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(
        { error: "Could not save USN.", details: error.message, code: error.code, hint: error.hint, detailsRaw: error.details },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Could not save USN." }, { status: 400 });
  }

  perfLog("onboarding.usn", t);
  return NextResponse.json({ ok: true });
}
