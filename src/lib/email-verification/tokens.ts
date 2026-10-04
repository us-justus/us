/**
 * Email-ownership token primitives (server-only).
 *
 * NEVER import from client components. Plaintext tokens exist only in server
 * memory: generated here, hashed (SHA-256 hex) for persistence, embedded in
 * a verification URL passed to the queue worker in memory, then dropped.
 * Nothing here logs a token, URL, or email.
 *
 * Token shape: 32 cryptographically random bytes, base64url (43 chars).
 * No Math.random, no UUID-as-secret, no PII in the token or URL.
 */

import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlausibleEmail, normalizeEmail } from "./queue";

export const TOKEN_BYTES = 32;
export const TOKEN_TTL_SECONDS = 15 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("email-verification tokens are server-only");
  }
}

/** 256 bits of entropy, URL-safe (no padding). Throws in the browser. */
export function generateVerificationToken(): string {
  assertServer();
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** SHA-256 hex of the token — the only form ever persisted. */
export function hashVerificationToken(token: string): string {
  assertServer();
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Structural check only (length + alphabet). No DB lookup. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** The token is the only secret in the URL — no user id, email, or USN. */
export function buildVerificationUrl(appBaseUrl: string, token: string): string {
  assertServer();
  const base = appBaseUrl.replace(/\/+$/, "");
  return `${base}/auth/verify?token=${token}`;
}

export type MintResult =
  | { ok: true; token: string; tokenId: string; expiresAt: string }
  | { ok: false; error: string };

/**
 * Mint one active token for (userId, email): invalidates predecessors and
 * stores ONLY the hash (via the mint RPC — service-role only). The plaintext
 * `token` is returned in memory to the caller (the queue worker embeds it in
 * the delivery URL) and never written anywhere.
 */
export async function mintVerificationToken(
  serviceClient: SupabaseClient,
  args: { userId: string; email: string; ttlSeconds?: number },
): Promise<MintResult> {
  assertServer();
  const normalized = normalizeEmail(args.email);
  if (!args.userId || !isPlausibleEmail(normalized)) {
    return { ok: false, error: "invalid verification identity" };
  }
  const token = generateVerificationToken();
  const tokenHash = hashVerificationToken(token);
  const { data, error } = await serviceClient.rpc("mint_email_verification_token", {
    p_user_id: args.userId,
    p_normalized_email: normalized,
    p_token_hash: tokenHash,
    p_ttl_seconds: args.ttlSeconds ?? TOKEN_TTL_SECONDS,
  });
  if (error) return { ok: false, error: "verification mint unavailable" };
  const row = (Array.isArray(data) ? data[0] : data) as {
    token_id: string;
    token_expires_at: string;
  } | null;
  if (!row?.token_id) return { ok: false, error: "verification mint unavailable" };
  return { ok: true, token, tokenId: row.token_id, expiresAt: row.token_expires_at };
}

export type ConsumeResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: string };

/** Generic failure — malformed, unknown, expired, consumed, invalidated, or superseded all look identical. */
const GENERIC_CONSUME_ERROR = "This link is invalid or has expired.";

/**
 * Atomically consume a token and mark the bound email trusted (single RPC —
 * exactly one concurrent consumer succeeds). Never logs the token.
 */
export async function consumeVerificationToken(
  serviceClient: SupabaseClient,
  token: string,
): Promise<ConsumeResult> {
  assertServer();
  if (!isWellFormedToken(token)) return { ok: false, error: GENERIC_CONSUME_ERROR };
  const tokenHash = hashVerificationToken(token);
  const { data, error } = await serviceClient.rpc("consume_email_verification_token", {
    p_token_hash: tokenHash,
  });
  if (error) return { ok: false, error: GENERIC_CONSUME_ERROR };
  const row = (Array.isArray(data) ? data[0] : data) as {
    verified_user_id: string;
    verified_email: string;
  } | null;
  if (!row?.verified_user_id) return { ok: false, error: GENERIC_CONSUME_ERROR };
  return { ok: true, userId: row.verified_user_id, email: row.verified_email };
}
