import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.100", "192.168.0.106"],
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
  },
};

export default nextConfig;
