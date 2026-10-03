import { createClient } from "@supabase/supabase-js";

/**
 * Server-only service-role client for pre-login RPCs
 * (`resolve_login_email`, `resolve_phone_login_email`, login rate limiter).
 *
 * SERVER-ONLY: this module reads SUPABASE_SERVICE_ROLE_KEY (never a
 * NEXT_PUBLIC_* variable). Never import it from client components, never
 * log/return the key, never send it to the browser.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("missing service-role configuration");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
