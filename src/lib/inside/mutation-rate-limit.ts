import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getClientIp } from "@/lib/auth/login-rate-limit";

/** Distributed DB-backed admin mutation limiter. Errors deny the mutation. */
export async function insideMutationRateLimit(req: Request, userId: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  try {
    const ip = getClientIp(req);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("check_inside_rate_limit", {
      p_ip_key: `inside-action-ip:${hash(ip)}`,
      p_identity_key: `inside-action-user:${hash(`${ip}\n${userId}`)}`,
    });
    if (error) return { allowed: false };
    const decision = data as { allowed?: boolean; retry_after_seconds?: number } | null;
    return decision?.allowed === true
      ? { allowed: true }
      : { allowed: false, retryAfterSeconds: Number(decision?.retry_after_seconds) || 60 };
  } catch { return { allowed: false }; }
}
