import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType = "LIKE" | "MATCH" | "MESSAGE";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  /** like.id or match.id — never a user/USN/email/auth identifier. */
  reference_id: string | null;
  read_at: string | null;
  /** Set when a LIKE notification is liked-back or ignored. Actions hide; the row stays in history. */
  resolved_at: string | null;
  created_at: string;
  /** Public actor identity only (never USN/email/auth ID). Null when unknown. */
  actor_username: string | null;
  actor_nickname: string | null;
  /** Primary public photo of the actor, if any. Null when unknown/removed. */
  actor_photo_url: string | null;
};

export const NOTIFICATION_LIMIT_DEFAULT = 50;
export const NOTIFICATION_LIMIT_MAX = 100;

/** True when the notifications migration has not been applied yet — every
 *  caller degrades to empty instead of 500ing (same posture as the launch
 *  pre-migration fallback). */
export function isMissingNotificationsError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /notifications/i.test(error.message ?? "") || /create_notification/i.test(error.message ?? "");
}

type NotificationRow = {
  id: string;
  type: string;
  reference_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  resolved_at: string | null;
  created_at: string;
};

/**
 * Server-side notification history for one recipient.
 *
 * - Excludes soft-deleted rows, newest first, bounded limit.
 * - Resolves actor_id → public profile fields (username/nickname) in one
 *   batched lookup; raw actor_id never leaves the server.
 * - Runs under the existing "own notifications select" + "discover
 *   profiles select" RLS policies — no weakening, no new policy.
 */
export async function getNotifications(
  supabase: SupabaseClient,
  userId: string,
  limit: number = NOTIFICATION_LIMIT_DEFAULT,
): Promise<{ notifications: NotificationItem[]; unread_count: number }> {
  const empty = { notifications: [] as NotificationItem[], unread_count: 0 };
  const bounded = Math.min(Math.max(limit, 1), NOTIFICATION_LIMIT_MAX);

  // resolved_at ships with the actionable-LIKE migration; before it is
  // applied the column does not exist — fall back to the pre-migration
  // shape (every row treated as unresolved) instead of 500ing.
  let rows: NotificationRow[] | null = null;
  const full = await supabase
    .from("notifications")
    .select("id, type, reference_id, actor_id, read_at, resolved_at, created_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(bounded);
  if (!full.error && full.data) {
    rows = full.data as unknown as NotificationRow[];
  } else if (full.error && /resolved_at/i.test(full.error.message ?? "")) {
    const legacy = await supabase
      .from("notifications")
      .select("id, type, reference_id, actor_id, read_at, created_at")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(bounded);
    if (legacy.error || !legacy.data) return empty;
    rows = (legacy.data as unknown as Omit<NotificationRow, "resolved_at">[]).map((r) => ({
      ...r,
      resolved_at: null,
    }));
  } else {
    return empty;
  }
  if (!rows) return empty;
  const unread_count = rows.filter((r) => r.read_at === null && r.resolved_at === null).length;

  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((a) => !!a))] as string[];
  const actorById = new Map<string, { username: string | null; nickname: string; profile_id: string | null }>();
  if (actorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, username, nickname")
      .in("user_id", actorIds);
    for (const p of (profiles ?? []) as {
      id: string;
      user_id: string;
      username: string | null;
      nickname: string;
    }[]) {
      actorById.set(p.user_id, { username: p.username, nickname: p.nickname, profile_id: p.id });
    }
  }

  // Primary photo per actor (first by display_order). Public URLs only —
  // no profile data is duplicated into the notification table.
  const photoByActorId = new Map<string, string>();
  const profileIds = [...actorById.values()].map((a) => a.profile_id).filter((v): v is string => !!v);
  if (profileIds.length) {
    const { data: photos } = await supabase
      .from("profile_photos")
      .select("profile_id, storage_path, display_order")
      .in("profile_id", profileIds)
      .order("display_order", { ascending: true });
    const seenProfiles = new Set<string>();
    for (const ph of (photos ?? []) as { profile_id: string; storage_path: string }[]) {
      if (seenProfiles.has(ph.profile_id)) continue;
      seenProfiles.add(ph.profile_id);
      const url = supabase.storage.from("profile-photos").getPublicUrl(ph.storage_path).data.publicUrl;
      if (url) {
        for (const [actorId, actor] of actorById) {
          if (actor.profile_id === ph.profile_id && !photoByActorId.has(actorId)) {
            photoByActorId.set(actorId, url);
          }
        }
      }
    }
  }

  return {
    notifications: rows.map((r) => ({
      id: r.id,
      type: (r.type === "LIKE" || r.type === "MATCH" || r.type === "MESSAGE" ? r.type : "LIKE") as NotificationType,
      reference_id: r.reference_id,
      read_at: r.read_at,
      resolved_at: r.resolved_at ?? null,
      created_at: r.created_at,
      actor_username: r.actor_id ? (actorById.get(r.actor_id)?.username ?? null) : null,
      actor_nickname: r.actor_id ? (actorById.get(r.actor_id)?.nickname ?? null) : null,
      actor_photo_url: r.actor_id ? (photoByActorId.get(r.actor_id) ?? null) : null,
    })),
    unread_count,
  };
}

/** Cheap unread badge count. Returns 0 (never throws) when the migration
 *  is not applied yet or the query fails. Resolved LIKE rows never count. */
export async function getUnreadCount(supabase: SupabaseClient, userId: string): Promise<number> {
  const full = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .is("resolved_at", null)
    .is("deleted_at", null);
  if (!full.error && typeof full.count === "number") return full.count;
  if (full.error && !/resolved_at/i.test(full.error.message ?? "")) return 0;
  // Pre-resolved_at migration: fall back to the read/deleted-only count.
  const legacy = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null)
    .is("deleted_at", null);
  if (legacy.error || typeof legacy.count !== "number") return 0;
  return legacy.count;
}
