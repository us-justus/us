#!/usr/bin/env bash
# Tests for scripts/check-staging-url.sh.
#
#   bash scripts/check-staging-url.test.sh
#
# The guard is the only thing standing between a typo and a smoke test (or a
# deploy report) against production, so every acceptance and rejection is
# pinned here and run by the staging workflows before they are trusted.

set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/check-staging-url.sh"
failures=0
cases=0

expect() {
  local expected="$1"
  local url="$2"
  cases=$((cases + 1))
  if ( bash "${script}" "${url}" >/dev/null 2>&1 ); then
    actual=accept
  else
    actual=reject
  fi
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL: expected ${expected}, got ${actual} for '${url}'"
    failures=$((failures + 1))
  fi
}

# Accepted staging origins.
expect accept "https://us-staging.atharvaspatil2005-d16.workers.dev"
expect accept "https://us-staging.atharvaspatil2005-d16.workers.dev/"
expect accept "https://us-staging.atharvaspatil2005-d16.workers.dev/login?next=/"
expect accept "https://US-STAGING.atharvaspatil2005-d16.workers.dev"
expect accept "https://us-staging.acct.workers.dev:8443"
expect accept "https://staging.us-justus.in"

# Rejected: production, lookalikes, and malformed input.
expect reject ""
expect reject "http://us-staging.acct.workers.dev"
expect reject "//us-staging.acct.workers.dev"
expect reject "https://us-justus.in"
expect reject "https://www.us-justus.in"
expect reject "https://us-justus.in/login"
expect reject "https://us-justus.in.evil.com"
expect reject "https://staging.us-justus.in.evil.com"
expect reject "https://us.atharvaspatil2005-d16.workers.dev"
expect reject "https://x.us-staging.acct.workers.dev"
expect reject "https://us-staging"
expect reject "https://"
expect reject "https://us-staging.acct.workers.dev.evil.com"
expect reject "https://evil.com/us-staging.acct.workers.dev"
expect reject $'https://us-staging.acct.workers.dev\nhttps://us-justus.in'
# URL-parser ambiguity: userinfo and a port must not smuggle a different host
# past the wildcard, and the port must be numeric.
expect reject "https://us-staging.acct.workers.dev:443@evil.com"
expect reject "https://us-staging.acct.workers.dev@evil.com"
expect reject "https://us-staging.acct.workers.dev:evil"
expect reject "https://us-staging.acct.workers.dev\\@evil.com"
expect reject "https://user:pass@us-staging.acct.workers.dev"

echo "check-staging-url: ${cases} cases, ${failures} failure(s)"
[ "${failures}" -eq 0 ]
