import { createClient } from "@/lib/supabase/server";

export type LaunchState = {
  launched: boolean;
  /** UTC timestamptz for DISPLAYING a countdown only — never authorization. */
  launchAt: string | null;
};

/**
 * Single server-side source of launch truth (public.launch_config id = 1).
 *
 * Authorization must always use `launched` from this helper. `launchAt` is
 * display-only for a future countdown; the browser clock must never unlock
 * product features.
 */
export async function getLaunchState(): Promise<LaunchState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("launch_config")
    .select("launched, launched_at")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return { launched: false, launchAt: null };
  return {
    launched: (data as { launched: boolean }).launched === true,
    launchAt: (data as { launched_at: string | null }).launched_at ?? null,
  };
}

/**
 * Redirect target for launch-gated product routes (/discover, /matches,
 * /chat) while PRE_LAUNCH. Null once launched (allowed).
 *
 * Hiding navigation is never sufficient — pages apply this server-side so
 * direct URL access cannot bypass it.
 */
export function guardLaunch(launch: LaunchState): string | null {
  return launch.launched ? null : "/";
}
