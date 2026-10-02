import { createClient } from "@/lib/supabase/server";

export type LaunchState = {
  launched: boolean;
  /** UTC timestamptz for DISPLAYING a countdown only — never authorization. */
  launchAt: string | null;
  /** Which pre-launch experience is active. Display/config only. */
  prelaunchVersion: string;
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
    .select("launched, launched_at, prelaunch_version")
    .eq("id", 1)
    .maybeSingle();
  if (!error && data) {
    const row = data as {
      launched: boolean;
      launched_at: string | null;
      prelaunch_version: string | null;
    };
    return {
      launched: row.launched === true,
      launchAt: row.launched_at ?? null,
      prelaunchVersion:
        typeof row.prelaunch_version === "string" && row.prelaunch_version
          ? row.prelaunch_version
          : "v1",
    };
  }
  // Pre-migration schema (no prelaunch_version column yet): fall back to the
  // original projection so the product keeps working during rollout.
  if (error && /prelaunch_version/i.test(error.message ?? "")) {
    const legacy = await supabase
      .from("launch_config")
      .select("launched, launched_at")
      .eq("id", 1)
      .maybeSingle();
    if (!legacy.error && legacy.data) {
      return {
        launched:
          (legacy.data as { launched: boolean }).launched === true,
        launchAt:
          (legacy.data as { launched_at: string | null }).launched_at ??
          null,
        prelaunchVersion: "v1",
      };
    }
  }
  if (error || !data) return { launched: false, launchAt: null, prelaunchVersion: "v1" };
  return {
    launched: (data as { launched: boolean }).launched === true,
    launchAt: (data as { launched_at: string | null }).launched_at ?? null,
    prelaunchVersion: "v1",
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
