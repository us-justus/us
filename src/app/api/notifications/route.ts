import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProductSession, guardProductSession } from "@/lib/auth/product-state";
import {
  NOTIFICATION_LIMIT_DEFAULT,
  getNotifications,
  isMissingNotificationsError,
} from "@/lib/notifications/queries";
import { perfLog, perfStart } from "@/lib/utils/perf";

/**
 * Notification history API (spec/3D3.md).
 *
 * GET /api/notifications?limit=50 → { notifications, unread_count }
 *
 * - Completed campus/permanent sessions only (public → 401, incomplete →
 *   403). Product-guarded, launch-independent: pre-launch users simply have
 *   no rows (likes cannot exist before launch).
 * - Only the caller's rows, soft-deleted excluded, newest first, bounded.
 * - Actor resolved to public fields only — never USN/email/auth ID.
 * - Degrades to empty (not 500) when the migration is not applied yet.
 *
 * POST /api/notifications { all: "read" } → marks every unread row read.
 */
export async function GET(req: Request) {
  const t = perfStart();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Reuse the known user — no second auth.getUser() on this request.
  const session = await getProductSession(user);
  if (guardProductSession(session)) {
    return NextResponse.json({ error: "Finish onboarding to view notifications." }, { status: 403 });
  }

  const rawLimit = Number(new URL(req.url).searchParams.get("limit") ?? "");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : NOTIFICATION_LIMIT_DEFAULT;
  try {
    const result = await getNotifications(supabase, user.id, limit);
    perfLog("notifications.list", t);
    return NextResponse.json(result);
  } catch (e) {
    if (isMissingNotificationsError((e as { code?: string; message?: string } | null) ?? null)) {
      return NextResponse.json({ notifications: [], unread_count: 0 });
    }
    if (process.env.NODE_ENV !== "production") console.error("[notifications] list error", e);
    return NextResponse.json({ error: "Notifications are unavailable right now." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const session = await getProductSession(user);
  if (guardProductSession(session)) {
    return NextResponse.json({ error: "Finish onboarding to view notifications." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || (body as { all?: string }).all !== "read") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null)
    .is("deleted_at", null);
  if (error) {
    if (isMissingNotificationsError(error)) return NextResponse.json({ ok: true });
    if (process.env.NODE_ENV !== "production") console.error("[notifications] read-all error", error.code);
    return NextResponse.json({ error: "Could not update notifications." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
