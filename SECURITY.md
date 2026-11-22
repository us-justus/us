# Security Policy

`us` handles student identity, profile photos, and private account data. Please
report security problems privately so they can be fixed before they are
disclosed.

## Supported versions

The `main` branch is the only supported version. There are no versioned
releases or long-term support branches.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**https://github.com/us-justus/us/security/advisories/new**

Do **not** open a public issue, discussion, or pull request for a suspected
vulnerability.

Please include, where possible:

- a short description of the issue and its impact;
- the affected commit or URL;
- reproduction steps or a minimal proof of concept;
- the environment (browser, device, local/staging/production);
- any suggested fix or mitigation.

Never include real passwords, access tokens, service-role keys, USNs, email
addresses, auth IDs, verification metadata, or other people's data. Use
synthetic test accounts and redact identifiers.

## Scope

In scope:

- authentication, session handling, and account conversion;
- authorization and Row Level Security boundaries;
- profile, photo, search, invite, feedback, and admin surfaces;
- database functions, grants, and migrations;
- storage access and upload validation;
- deployment workflows and secret handling;
- dependency vulnerabilities that affect the running application.

Out of scope:

- social engineering, phishing, or physical attacks;
- denial-of-service or volumetric attacks;
- spam or automated account creation without a security boundary bypass;
- vulnerabilities in third-party services that are not caused by this
  repository (report those to the upstream project);
- findings that require a compromised device, browser extension, or account.

## What to expect

This is a volunteer-maintained project. Maintainers will review reports on a
best-effort basis and will prioritize issues by impact. There is no guaranteed
response or fix deadline. Please allow reasonable time for a fix before public
disclosure, and coordinate disclosure through the private advisory.

## Safe handling

- Do not access, modify, or retain other users' data.
- Do not run destructive tests against production.
- Stop testing and report immediately if you encounter real user data.
- Use the local Supabase stack for database testing.
