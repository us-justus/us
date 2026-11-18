import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  allowedDevOrigins: ["192.168.0.100", "192.168.0.106", "192.168.1.4"],
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
