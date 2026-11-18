#!/usr/bin/env bash
# Deploy an already-built `.open-next` bundle to the staging Worker `us-staging`.
#
# SAFETY: `--env staging` is hard-coded below. No argument, environment variable
# or flag can remove it, because without `--env` Wrangler resolves the top-level
# Worker (`us`, production). This script cannot deploy production.
#
# `opennextjs-cloudflare deploy` is deliberately NOT used: it runs a build first,
# which in the privileged workflow would execute PR-controlled code while the
# Cloudflare token is available.
#
# Usage:
#   STAGING_DEPLOY_SHA=<40-hex> bash scripts/deploy-staging.sh [--dry-run]
#
# Environment (staging-scoped; supplied by the `staging` GitHub environment):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
#
# Never prints secret values: secret presence is checked with
# `wrangler secret list`, which returns names only.

set -euo pipefail

usage() {
  echo "usage: STAGING_DEPLOY_SHA=<40-hex> $0 [--dry-run]" >&2
  exit 2
}

mode="deploy"
for arg in "$@"; do
  case "$arg" in
    --dry-run) mode="dry-run" ;;
    *) echo "::error::unknown argument: ${arg}"; usage ;;
  esac
done

sha="${STAGING_DEPLOY_SHA:-}"
case "$sha" in
  "" | *[!0-9a-f]*)
    echo "::error::STAGING_DEPLOY_SHA must be a lowercase 40-character commit SHA"
    exit 1
    ;;
esac
if [ "${#sha}" -ne 40 ]; then
  echo "::error::STAGING_DEPLOY_SHA must be 40 characters (got ${#sha})"
  exit 1
fi

if [ ! -f .open-next/worker.js ]; then
  echo "::error::.open-next/worker.js is missing; build before deploying"
  exit 1
fi
if [ ! -d .open-next/assets ]; then
  echo "::error::.open-next/assets is missing; build before deploying"
  exit 1
fi

# Trusted config from the checked-out default branch: resolves `us` without
# `--env` and `us-staging` with it, refuses routes, and keeps the self-reference
# inside staging.
node scripts/staging-config.mjs wrangler wrangler.jsonc

required="ADMIN_SECRET_KEY BREVO_API_KEY BREVO_SENDER_EMAIL SUPABASE_SERVICE_ROLE_KEY"

if [ "$mode" = "deploy" ]; then
  # `wrangler deploy` deletes dashboard plaintext vars when the config declares
  # none (secrets are never deleted). Refuse to replace code on a Worker that is
  # missing runtime configuration, because the deploy would then be live but
  # broken. A name that is declared as a `var` in wrangler.jsonc also counts.
  if ! secret_names="$(pnpm exec wrangler secret list --env staging 2>/dev/null | jq -r '.[].name')"; then
    echo "::error::cannot list secrets for us-staging; check staging credentials and that the Worker exists"
    exit 1
  fi
  have="$(
    {
      printf '%s\n' "${secret_names}"
      node scripts/staging-config.mjs staging-vars wrangler.jsonc
    } | sed '/^[[:space:]]*$/d' | sort -u
  )"
  missing="$(comm -23 <(printf '%s\n' "${required}" | tr ' ' '\n' | sort -u) <(printf '%s\n' "${have}"))"
  if [ -n "${missing}" ]; then
    echo "::error::us-staging is missing required runtime configuration: $(printf '%s' "${missing}" | tr '\n' ' ')"
    echo "::error::set each one with: pnpm exec wrangler secret put <NAME> --env staging (a dashboard plaintext var would be deleted by this deploy)"
    exit 1
  fi
fi

recipe=(deploy --env staging --tag "${sha}" --message "staging candidate ${sha}" --autoconfig=false)

if [ "$mode" = "dry-run" ]; then
  outdir="${RUNNER_TEMP:-/tmp}/wrangler-staging-dry-run"
  rm -rf "${outdir}"
  if ! output="$(pnpm exec wrangler "${recipe[@]}" --dry-run --outdir "${outdir}" 2>&1)"; then
    printf '%s\n' "${output}"
    echo "::error::staging dry-run failed"
    exit 1
  fi
  printf '%s\n' "${output}"

  # Independent proof that Wrangler resolved staging, not production. The config
  # guard above already parsed the file; this checks Wrangler's own resolution.
  if ! printf '%s\n' "${output}" | grep -F 'WORKER_SELF_REFERENCE (us-staging)' >/dev/null; then
    echo "::error::staging dry-run did not resolve WORKER_SELF_REFERENCE (us-staging)"
    exit 1
  fi
  if printf '%s\n' "${output}" | grep -F 'WORKER_SELF_REFERENCE (us)' >/dev/null; then
    echo "::error::staging dry-run resolved the production Worker self-reference (us)"
    exit 1
  fi
  assets="$(printf '%s\n' "${output}" | grep -oE 'Read [0-9]+ files from the assets' | grep -oE '[0-9]+' | tail -1)"
  if [ -z "${assets}" ] || [ "${assets}" -lt 1 ]; then
    echo "::error::staging dry-run found no static assets in .open-next/assets"
    exit 1
  fi
  echo "OK: staging dry-run resolved us-staging with ${assets} asset files (sha ${sha})"
  exit 0
fi

pnpm exec wrangler "${recipe[@]}"
