"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/app/api/search/route";

type Status = "idle" | "searching" | "results" | "empty" | "error";

const DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

/**
 * Pre-launch campus search input (STEP 3B).
 *
 * Minimal by design: one input, one result list, no filters, no cards, no
 * animation libraries. Debounced (no dependency), stale responses ignored
 * via a sequence id so a slow "ath" can never overwrite a fresh "atha".
 * No request fires below the minimum query length.
 */
export function SearchClient() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);

  function handleChange(value: string) {
    setQuery(value);
    // Below the minimum length no request may fire: reset synchronously in
    // the event handler (never in the effect below).
    if (value.trim().replace(/^@/, "").length < MIN_QUERY) {
      seq.current += 1;
      setResults([]);
      setStatus("idle");
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (q.replace(/^@/, "").length < MIN_QUERY) return;
    const handle = setTimeout(() => {
      const mySeq = ++seq.current;
      setStatus("searching");
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(async (res) => {
          if (mySeq !== seq.current) return;
          if (!res.ok) {
            setStatus("error");
            return;
          }
          const j = (await res.json().catch(() => null)) as { results?: SearchResult[] } | null;
          if (mySeq !== seq.current) return;
          const rows = Array.isArray(j?.results) ? j.results : [];
          setResults(rows);
          setStatus(rows.length > 0 ? "results" : "empty");
        })
        .catch(() => {
          if (mySeq !== seq.current) return;
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, attempt]);

  return (
    <div>
      <label
        htmlFor="campus-search"
        className="text-[11px] tracking-[0.18em] uppercase text-ink-faint"
      >
        find by username
      </label>
      <input
        id="campus-search"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="@username"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        className="mt-3 w-full min-h-[44px] rounded-[16px] border border-line bg-paper px-5 py-3 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft focus:outline-none"
      />

      <div className="mt-6" aria-live="polite">
        {status === "idle" && (
          <p className="text-[13px] leading-6 text-ink-faint">
            type at least {MIN_QUERY} letters — your campus, by name.
          </p>
        )}
        {status === "searching" && (
          <p className="text-[13px] leading-6 text-ink-faint">searching…</p>
        )}
        {status === "empty" && (
          <div>
            <p className="font-display text-[22px] tracking-[-0.02em] text-ink">no one found.</p>
            <p className="mt-2 text-[13px] leading-6 text-ink-faint">
              check the spelling — usernames are exact, letter for letter.
            </p>
          </div>
        )}
        {status === "error" && (
          <div className="rounded-[16px] border border-accent-soft bg-accent-wash px-5 py-4">
            <p className="text-[13px] leading-6 text-accent-deep">
              search didn&apos;t go through. check your connection and try again.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="mt-2 inline-flex min-h-[44px] items-center text-[12px] tracking-[0.12em] uppercase text-ink underline underline-offset-4 transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              try again
            </button>
          </div>
        )}
        {status === "results" && (
          <ul className="flex flex-col" aria-label="search results">
            {results.map((r) => (
              <li key={r.username.toLowerCase()} className="border-b border-line last:border-0">
                <Link
                  href={`/u/${encodeURIComponent(r.username)}`}
                  className="flex min-h-[44px] items-center justify-between gap-4 py-3 transition-colors hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[8px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] tracking-[0.02em] text-ink">
                      @{r.username}
                    </span>
                    <span className="mt-0.5 block text-[12px] tracking-[0.04em] text-ink-faint">
                      {r.nickname} · {r.branch} · {r.year} year
                      {r.spot !== null ? ` · spot #${r.spot}` : null}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0 text-[13px] text-ink-faint">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
