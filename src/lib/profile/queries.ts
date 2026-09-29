import { createClient } from "@/lib/supabase/server";

export type OwnProfile = {
  id: string;
  user_id: string;
  nickname: string;
  age: number;
  year: string;
  branch: string;
  bio: string | null;
  interests: string[];
};

export type OwnPhoto = {
  id: string;
  storage_path: string;
  display_order: number;
  url: string;
};

export async function getOwnProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, photos: [] as OwnPhoto[], error: null as string | null };

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, user_id, nickname, age, year, branch, bio, interests")
    .eq("user_id", user.id)
    .maybeSingle();

  // A database/RLS failure must never look like "no profile" — surface it so
  // callers can render an error state instead of the onboarding CTA.
  if (profileError) {
    // Dev-only diagnostic: user ID + error code/message. Never tokens/secrets.
    if (process.env.NODE_ENV !== "production") {
      console.error("[profile] fetch error", profileError.code, profileError.message);
    }
    return { user, profile: null, photos: [] as OwnPhoto[], error: "Could not load your profile. Please try again." };
  }

  // Dev-only diagnostic: user ID + row-exists boolean. Never tokens/secrets.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[profile] user=${user.id} profileExists=${profile !== null}`);
  }

  if (!profile) return { user, profile: null, photos: [] as OwnPhoto[], error: null as string | null };

  const { data: photos, error: photosError } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", (profile as OwnProfile).id)
    .order("display_order", { ascending: true });

  if (photosError && process.env.NODE_ENV !== "production") {
    console.error("[profile] photos fetch error", photosError.code, photosError.message);
  }

  const mapped: OwnPhoto[] = (photos ?? []).map((p) => ({
    id: p.id,
    storage_path: p.storage_path,
    display_order: p.display_order,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  return { user, profile: profile as OwnProfile, photos: mapped, error: null as string | null };
}
