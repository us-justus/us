import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * POST /api/invite/enter?token=...
 *
 * Sets a short-lived HttpOnly cookie with the invite token for attribution,
 * then redirects to /onboarding. The cookie survives the onboarding flow
 * and is read when onboarding completes to record the referral.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || token.length < 16 || token.length > 64) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const cookieStore = await cookies();
  cookieStore.set("us_invite", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return NextResponse.redirect(new URL("/onboarding", req.url));
}