import { NextResponse } from "next/server";
import { clearInsideCookieHeader } from "@/lib/inside/auth";

/** POST /api/inside/logout — clears the signed inside cookie. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearInsideCookieHeader());
  return res;
}
