import { createClient } from "@/lib/supabase/server";

export type OnboardingStep = "usn" | "email" | "profile" | "photos" | "complete";

export async function getOnboardingState(): Promise<{ user: { id: string } | null; step: OnboardingStep }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, step: "usn" };
  const { data: vr } = await supabase.from("verification_records").select("usn, email").eq("user_id", user.id).maybeSingle();
  if (!vr || !vr.usn) return { user: { id: user.id }, step: "usn" };
  if (vr.email === null) {
    const { data: prof } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (!prof) return { user: { id: user.id }, step: "email" };
  }
  const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
  if (!profile) return { user: { id: user.id }, step: "profile" };
  const { count } = await supabase.from("profile_photos").select("id", { count: "exact", head: true }).eq("profile_id", profile.id);
  if (!count || count < 1) return { user: { id: user.id }, step: "photos" };
  return { user: { id: user.id }, step: "complete" };
}

export function stepPath(step: OnboardingStep): string {
  if (step === "complete") return "/discover";
  return `/onboarding/${step}`;
}
