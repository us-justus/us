import type { NextConfig } from "next";
import { buildReportOnlyCsp, parseSupabaseOrigin } from "./src/lib/security/csp";

// LAN hostnames allowed to reach the dev server (comma-separated). Keep this
// environment-driven: committed machine-specific IPs are a privacy and
// portability leak. Empty means "no extra origins", which is correct for CI
// and for anyone using localhost only.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const supabaseOrigin = parseSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const reportOnlyCsp = buildReportOnlyCsp(supabaseOrigin);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
      ],
    }, {
      source: "/inside/:path*",
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
    }];
  },
  // Supabase Storage hosts profile photos. Declared here so a future
  // migration from raw <img> to next/image works without a config change;
  // AVIF/WebP first keeps mobile decode + bandwidth minimal.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Keep the motion runtime out of the shared chunk where possible.
    optimizePackageImports: ["motion"],
    // Next.js 16.3+ persists Turbopack's build database in
    // `.next/cache/turbopack`. CI build caches (Cloudflare Workers Builds
    // caches `.next/cache` for Next.js projects) can restore that directory
    // partially; a `.meta` file whose referenced `.sst` is missing makes
    // Turbopack panic with `TurbopackInternalError` instead of treating it
    // as a cache miss, which fails the whole deploy. Builds are small
    // (~20s clean), so we opt out of the persistent cache rather than let
    // a restored cache decide whether a release can ship.
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;

// OpenNext Cloudflare dev integration: lets `next dev` resolve local
// Cloudflare bindings the same way the Worker does in preview/production.
// No-op for `next build`; required only for local development.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
