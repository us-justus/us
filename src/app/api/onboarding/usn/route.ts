import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeUSN, validateUSN } from "@/lib/verification/usn";
import { decideUsnMutation, isDuplicateUsnError } from "@/lib/onboarding/usn-mutation";
import { perfLog, perfStart } from "@/lib/utils/perf";

export async function POST(req: Request) {
  const t = perfStart();
  const { usn } = await req.json().catch(() => ({}));
  const normalized = normalizeUSN(String(usn || ""));
  if (!validateUSN(normalized)) return NextResponse.json({ error: "Enter a valid USN." }, { status: 400 });
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("[onboarding/usn] auth error", {
      message: authError.message,
      code: (authError as unknown as { code?: string }).code,
      status: (authError as unknown as { status?: number }).status,
    });
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ error: "Not authenticated.", details: authError.message }, { status: 401 });
    }
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // USN is immutable once a profile exists: reject any change past that
  // point (identical retry passes through idempotently — e.g. a returning
  // user re-submitting their own USN always succeeds, never 409s).
  const [{ data: existingVr }, { data: existingProfile }] = await Promise.all([
    supabase.from("verification_records").select("usn").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle(),
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
    console.error("[onboarding/usn] database error", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      status: (error as unknown as { status?: number }).status,
    });

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
