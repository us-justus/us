import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import { isMissingNotificationsError } from "@/lib/notifications/queries";

/**
 * Per-notification state (spec/3D3.md).
 *
 * PATCH  /api/notifications/[id] → mark one row read (read_at = now).
 * DELETE /api/notifications/[id] → soft-delete (deleted_at = now).
 *
 * - Recipient-owned rows only (id + user_id predicate; RLS re-checks).
 * - The immutability trigger rejects any actor/type/reference rewrite, so
 *   these endpoints cannot be abused to forge history.
 * - Deleting a notification never touches the underlying like/match.
 */
async function guard(reqUser: { id: string } | null) {
  if (!reqUser) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  return null;
}

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authErr = await guard(user);
  if (authErr) return authErr;

  const session = await getProductSession(user);
  if (guardProductSession(session)) {
    return NextResponse.json({ error: "Finish onboarding to view notifications." }, { status: 403 });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("notifications")
    // RLS + predicate both scope to the caller; the trigger freezes every
    // column except read_at/deleted_at.
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", (user as { id: string }).id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingNotificationsError(error)) return NextResponse.json({ ok: true });
    if (process.env.NODE_ENV !== "production") console.error("[notifications] read error", error.code);
    return NextResponse.json({ error: "Could not update that notification." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const authErr = await guard(user);
  if (authErr) return authErr;

  const session = await getProductSession(user);
  if (guardProductSession(session)) {
    return NextResponse.json({ error: "Finish onboarding to view notifications." }, { status: 403 });
  }

  const { id } = await params;
  // Soft-delete only — the row (and the underlying like/match) stays intact.
  const { data, error } = await supabase
    .from("notifications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", (user as { id: string }).id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    if (isMissingNotificationsError(error)) return NextResponse.json({ ok: true });
    if (process.env.NODE_ENV !== "production") console.error("[notifications] delete error", error.code);
    return NextResponse.json({ error: "Could not delete that notification." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
