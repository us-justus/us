#!/usr/bin/env bash
# Verify that the version deployed to `us-staging` is the candidate commit and
# is still the version serving 100% of staging traffic.
#
# Read-only: it never deploys, rolls back or changes Cloudflare state. Called
# twice by deploy-staging.yml (after deploy and again after the smoke test) so
# `staging/verified` cannot be published for a version that was replaced.
#
# Usage: STAGING_WORKER=us-staging CLOUDFLARE_API_TOKEN=... \
#          CLOUDFLARE_ACCOUNT_ID=... \
#          bash scripts/verify-staging-version.sh <40-hex-sha> <version-id>
#
# Never prints the token: only worker names, ids and commit SHAs.

set -euo pipefail

sha="${1:-}"
version_id="${2:-}"
worker="${STAGING_WORKER:-}"

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "::error::CLOUDFLARE_API_TOKEN is missing"; exit 1; }
[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] || { echo "::error::CLOUDFLARE_ACCOUNT_ID is missing"; exit 1; }

# Fail before touching the network if the inputs are not exactly right.
if [ "${worker}" != "us-staging" ]; then
  echo "::error::STAGING_WORKER must be us-staging (got '${worker}')"
  exit 1
fi
node scripts/verify-worker-version.mjs id "${version_id}"
case "${sha}" in
  "" | *[!0-9a-f]*) echo "::error::candidate SHA must be a lowercase 40-character commit SHA"; exit 1 ;;
esac
[ "${#sha}" -eq 40 ] || { echo "::error::candidate SHA must be 40 characters"; exit 1; }

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker}"
outdir="${RUNNER_TEMP:-/tmp}/staging-version-verify"
mkdir -p "${outdir}"

fetch() {
  curl -fsS --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Accept: application/json" \
    "$1"
}

if ! fetch "${api}/versions/${version_id}" >"${outdir}/version.json"; then
  echo "::error::cannot read Worker version ${version_id} from Cloudflare"
  exit 1
fi
if ! fetch "${api}/deployments?per_page=20" >"${outdir}/deployments.json"; then
  echo "::error::cannot read deployments for ${worker} from Cloudflare"
  exit 1
fi

node scripts/verify-worker-version.mjs verify \
  --worker "${worker}" \
  --version-id "${version_id}" \
  --sha "${sha}" \
  --version "${outdir}/version.json" \
  --deployments "${outdir}/deployments.json"
