import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal OpenNext Cloudflare config: default caching, no R2/KV/D1.
// Add overrides here only when a measured production need appears
// (see https://opennext.js.org/cloudflare/caching).
export default defineCloudflareConfig({});
