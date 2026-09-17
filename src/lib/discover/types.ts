export type DiscoverProfile = {
  userId: string;
  nickname: string;
  age: number;
  year: string;
  branch: string;
  bio: string | null;
  interests: string[];
  photos: string[];
};

export type SwipeDirection = "like" | "pass";
