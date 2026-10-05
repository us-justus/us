import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  FEEDBACK_SUBMIT_PER_HOUR,
  isFeedbackCategory,
  validateFeedbackMessage,
} from "@/lib/feedback/constants";

/**
 * /api/feedback — student feedback submission + own history.
 *
 * POST { category, message }: authenticated-only. Identity comes from the
 * session (user_id = auth user); the server never trusts client-provided
 * user_id/email. Category is allowlisted, message is length-limited, and
 * a simple per-user throttle (5/hour) caps abuse. No email is asked for:
 * the student's address already lives in verification_records.
 *
 * Suspension appeals travel through this same route (no second inbox):
 * the server loads the author's live profile and — when the author is
 * currently suspended — marks the row suspension_related with a snapshot
 * of suspended_at. A client-supplied appeal flag is NEVER authoritative:
 * normal users cannot fabricate moderation context, and suspended users
 * need not claim anything (the server already knows). The suspension
 * guard deliberately does NOT block this route: suspended accounts lose
 * the product but keep the appeal path.
 *
 * GET: the caller's own rows only (id/category/message/status/created_at
 * — never admin-only fields, never suspension context). RLS (own-select)
 * enforces the boundary; the projection below keeps it explicit.
 */

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (!isFeedbackCategory(body?.category)) {
    return NextResponse.json(
      { error: "Pick a feedback category." },
      { status: 400 },
    );
  }
  const messageError = validateFeedbackMessage(body?.message);
  if (messageError) {
    return NextResponse.json({ error: messageError }, { status: 400 });
  }
  const message = (body.message as string).trim();

  // Per-user throttle: recent submissions in the rolling hour. Counted
  // through the caller's own RLS-scoped rows — no new infrastructure.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", hourAgo);
  if (countError) {
    return NextResponse.json(
      { error: "Could not send feedback. Try again." },
      { status: 500 },
    );
  }
  if ((count ?? 0) >= FEEDBACK_SUBMIT_PER_HOUR) {
    return NextResponse.json(
      { error: "Too many messages — try again in a bit." },
      { status: 429 },
    );
  }

  // Appeal link: resolved purely server-side from the author's live
  // profile. Suspended now → this submission IS an appeal, pinned to the
  // current suspended_at (fallback now() if the timestamp is missing).
  // Never read from the request body — client context is untrusted.
  let appealLink: string | null = null;
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_active, suspended_at")
      .eq("user_id", user.id)
      .maybeSingle();
    const p = prof as { is_active?: boolean | null; suspended_at?: string | null } | null;
    if (p?.is_active === false) {
      appealLink =
        typeof p.suspended_at === "string" && p.suspended_at
          ? p.suspended_at
          : new Date().toISOString();
    }
  } catch {}

  const { data, error } = await supabase
    .from("feedback")
    .insert({
      user_id: user.id,
      category: body.category,
      message,
      // Server-derived appeal link: the author's CURRENT suspension state.
      // Any client "appeal"/"suspension_related" field is ignored — the
      // profile is the authority, so ordinary users can never set this.
      ...(appealLink
        ? { suspension_related: true, related_suspension_at: appealLink }
        : {}),
    })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: "Could not send feedback. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("feedback")
    .select("id, category, message, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json(
      { error: "Could not load feedback." },
      { status: 500 },
    );
  }
  return NextResponse.json({ feedback: data ?? [] });
}
