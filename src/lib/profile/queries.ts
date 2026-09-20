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
  if (!user) return { user: null, profile: null, photos: [] as OwnPhoto[] };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, user_id, nickname, age, year, branch, bio, interests")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return { user, profile: null, photos: [] as OwnPhoto[] };

  const { data: photos } = await supabase
    .from("profile_photos")
    .select("id, storage_path, display_order")
    .eq("profile_id", (profile as OwnProfile).id)
    .order("display_order", { ascending: true });

  const mapped: OwnPhoto[] = (photos ?? []).map((p) => ({
    id: p.id,
    storage_path: p.storage_path,
    display_order: p.display_order,
    url: supabase.storage.from("profile-photos").getPublicUrl(p.storage_path).data.publicUrl,
  }));

  return { user, profile: profile as OwnProfile, photos: mapped };
}
