import "server-only";
import type { User } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { hasRealVerifiedEmail } from "./account.ts";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type VerifiedEmailSyncResult =
  | { ok: true }
  | { ok: false; reason: "unverified" | "write-failed" };

export async function syncVerifiedEmailFromUser(
  user: User | null,
  service?: ServiceClient,
): Promise<VerifiedEmailSyncResult> {
  if (!user || !hasRealVerifiedEmail(user)) return { ok: false, reason: "unverified" };
  const email = user.email?.trim();
  const confirmedAt =
    user.email_confirmed_at ??
    (user as unknown as { confirmed_at?: string | null }).confirmed_at ??
    null;
  if (!email || !confirmedAt) return { ok: false, reason: "unverified" };

  try {
    const client = service ?? createServiceRoleClient();
    const { data: existing, error: readError } = await client
      .from("verification_records")
      .select("email, email_verified_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) {
      console.error("[account] sync-verified-email failed", readError.code ?? "unknown");
      return { ok: false, reason: "write-failed" };
    }
    const record = existing as { email?: unknown; email_verified_at?: unknown } | null;
    if (
      record &&
      typeof record.email === "string" &&
      record.email.trim().toLowerCase() === email.toLowerCase() &&
      typeof record.email_verified_at === "string" &&
      record.email_verified_at.length > 0
    ) {
      return { ok: true };
    }
    const { error } = await client.from("verification_records").upsert({
      user_id: user.id,
      email,
      email_skipped: false,
      email_verified_at: confirmedAt,
    }, { onConflict: "user_id" });
    if (error) {
      console.error("[account] sync-verified-email failed", error.code ?? "unknown");
      return { ok: false, reason: "write-failed" };
    }
    return { ok: true };
  } catch {
    console.error("[account] sync-verified-email failed", "unknown");
    return { ok: false, reason: "write-failed" };
  }
}
