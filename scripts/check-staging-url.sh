#!/usr/bin/env bash
# Staging URL guard — shared by .github/workflows/deploy-staging.yml.
#
# Usage: scripts/check-staging-url.sh <base-url>
#   exit 0 = the URL is an allowed staging origin
#   exit 1 = rejected (reason is emitted as a GitHub ::error:: annotation)
#
# Allowed (exact host, no substring matching):
#   https://staging.us-justus.in
#   https://us-staging.<subdomain>.workers.dev
#
# Rejected:
#   - empty / missing value
#   - anything that is not https://
#   - production hosts (us-justus.in, www.us-justus.in)
#   - the production Worker's workers.dev host (us.<subdomain>.workers.dev)
#   - any unrelated host, including lookalikes such as us-justus.in.evil.com
#     or x.us-staging.acct.workers.dev
#
# Why a script: the same rule has to hold in two independent places (the
# pre-build config guard and the post-deploy smoke step). Two copies of the
# host logic would drift, and the smoke step must never inherit trust from an
# earlier step. Node standard library is not used because the pre-build guard
# runs before setup-node.

set -euo pipefail

url="${1:-}"

reject() {
  # stdout: the runner parses ::error:: annotations from the step's output.
  printf '::error::%s\n' "$1"
  exit 1
}

[ -n "$url" ] || reject "STAGING_BASE_URL is empty; refusing to continue"

case "$url" in
  https://*) ;;
  *) reject "STAGING_BASE_URL must be an https:// URL (got: $url)" ;;
esac

# Strip scheme, path, query, fragment, then port — leaving the bare host.
host="${url#https://}"
host="${host%%/*}"
host="${host%%\?*}"
host="${host%%#*}"
host="${host%%:*}"
host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"

[ -n "$host" ] || reject "STAGING_BASE_URL has no host (got: $url)"

case "$host" in
  us-justus.in | www.us-justus.in)
    reject "STAGING_BASE_URL points at production ($host); staging must never smoke-test production"
    ;;
  staging.us-justus.in)
    exit 0
    ;;
  us-staging.*.workers.dev)
    exit 0
    ;;
esac

reject "STAGING_BASE_URL host '$host' is not an allowed staging host (expected staging.us-justus.in or us-staging.<subdomain>.workers.dev)"
