export type NavStatus = "loading" | "public" | "onboarding" | "product";

export type NavSnapshot = {
  status: NavStatus;
  unread: number;
  primaryAvatarUrl: string | null;
  /**
   * Chat activity for the 💬 dot — intentionally separate from `unread`
   * (🔔 notification count). Boolean only: a subtle dot, never a number.
   */
  chatUnread: boolean;
};

export const initialNavSnapshot: NavSnapshot = {
  status: "loading",
  unread: 0,
  primaryAvatarUrl: null,
  chatUnread: false,
};

/**
 * Section matcher. Exact matches plus nested routes (e.g. /chat stays active
 * on /chat/[matchId], /settings on /settings/account), so navigation reads
 * identically across a section. The root "/" only ever matches exactly.
 */
export function isActiveLink(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href.length > 1 && pathname.startsWith(`${href}/`)) return true;
  return false;
}
