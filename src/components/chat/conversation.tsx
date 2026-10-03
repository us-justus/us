"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { markConversationSeenAction, sendMessageAction } from "@/lib/chat/actions";
import type { ChatMessage } from "@/lib/chat/queries";

type Props = {
  matchId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "today";
  if (sameDay(d, yesterday)) return "yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LocalMessage = ChatMessage & { pending?: boolean };

/**
 * Chat client island — history + composer + realtime only.
 * The page stays a Server Component; this island owns the single
 * `chat:${matchId}` INSERT subscription and optimistic reconciliation.
 */
export function Conversation({ matchId, currentUserId, initialMessages }: Props) {
  const reduceMotion = useReducedMotion();
  const [messages, setMessages] = useState<LocalMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(
    (smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth && !reduceMotion ? "smooth" : "auto",
      });
    },
    [reduceMotion],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottomRef.current = distance < 120;
  }, []);

  // Initial scroll to latest.
  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  // Single realtime channel for this conversation.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            sender_id: string;
            body: string;
            created_at: string;
          };
          if (!row?.id) return;
          setMessages((prev) => {
            // Sender echo reconciliation: a pending temp row with the same
            // body from us becomes the server row — never a duplicate.
            if (prev.some((m) => m.id === row.id)) {
              return prev.map((m) =>
                m.id === row.id
                  ? { id: row.id, sender_id: row.sender_id, body: row.body, created_at: row.created_at }
                  : m,
              );
            }
            const echoIdx = row.sender_id === currentUserId
              ? prev.findIndex((m) => m.pending && m.sender_id === currentUserId && m.body === row.body)
              : -1;
            if (echoIdx >= 0) {
              const next = [...prev];
              next[echoIdx] = { id: row.id, sender_id: row.sender_id, body: row.body, created_at: row.created_at };
              return next;
            }
            return [...prev, { id: row.id, sender_id: row.sender_id, body: row.body, created_at: row.created_at }];
          });
          // Only auto-scroll when already near the bottom, or when it's our
          // own echo — never yank someone reading older content.
          if (nearBottomRef.current || row.sender_id === currentUserId) {
            requestAnimationFrame(() => scrollToBottom(true));
          }
          // A new message from the other user arrived while this
          // conversation is open and viewed: advance the read cursor so the
          // global dot never sticks on a conversation being read, then tell
          // the header to re-resolve. Best-effort; own echoes need no mark.
          if (row.sender_id !== currentUserId) {
            void markConversationSeenAction(matchId).finally(() => {
              window.dispatchEvent(new CustomEvent("us:chat-activity"));
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, currentUserId, scrollToBottom]);

  // Lightweight visibility recovery for mobile background socket drops.
  // No polling — one bounded refetch when returning to the conversation.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const supabase = createClient();
      const { data } = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("match_id", matchId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!data) return;
      const fresh = ([...data] as ChatMessage[]).reverse();
      setMessages((prev) => {
        const ids = new Set(fresh.map((m) => m.id));
        const pending = prev.filter((m) => m.pending && !ids.has(m.id));
        return [...fresh, ...pending];
      });
      // Returning to a visible conversation re-marks it seen (same
      // best-effort cursor advance as the realtime path above).
      void markConversationSeenAction(matchId).finally(() => {
        window.dispatchEvent(new CustomEvent("us:chat-activity"));
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [matchId]);

  const autogrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`;
  }, []);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    if (body.length > 1000) {
      setSendError("messages can be up to 1000 characters.");
      return;
    }
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSendError(null);
    setSending(true);
    // Optimistic row (display-only timestamp; server created_at is truth
    // and replaces this on reconcile).
    setMessages((prev) => [
      ...prev,
      { id: tempId, sender_id: currentUserId, body, created_at: new Date().toISOString(), pending: true },
    ]);
    setDraft("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus({ preventScroll: true });
      }
      scrollToBottom(true);
    });
    startTransition(async () => {
      try {
        const result = await sendMessageAction(matchId, body);
        if (result.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? { id: result.id, sender_id: currentUserId, body, created_at: result.created_at }
                : m,
            ),
          );
        } else {
          // Failure keeps the draft — restore it, drop the temp row.
          setMessages((prev) => prev.filter((m) => m.id !== tempId));
          setDraft(body);
          setSendError(result.error || "couldn't send — try again");
        }
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setDraft(body);
        setSendError("couldn't send — try again");
      } finally {
        setSending(false);
      }
    });
  }

  const days = messages.map((m) => dayLabel(m.created_at));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-6 sm:px-8"
        aria-live="polite"
        aria-label="messages"
      >
        {days.length === 0 ? (
          <div className="py-14 text-center">
            <p className="font-display text-[26px] tracking-[-0.02em] text-ink">say hello.</p>
            <p className="mx-auto mt-2 max-w-[30ch] text-[14px] leading-6 text-ink-soft">
              a quiet start is a good start — keep it kind.
            </p>
            <div aria-hidden className="mx-auto mt-8 h-px w-12 bg-line-strong" />
          </div>
        ) : (
          <ul className="flex flex-col gap-1 py-6">
            {messages.map((m, i) => {
              const mine = m.sender_id === currentUserId;
              const day = days[i];
              const showDay = i === 0 || days[i - 1] !== day;
              return (
                <li key={m.id}>
                  {showDay && (
                    <p className="py-3 text-center text-[11px] tracking-[0.14em] uppercase text-ink-faint">
                      {day}
                    </p>
                  )}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] break-words ${mine ? "text-right" : "text-left"}`}>
                      <p
                        className={
                          mine
                            ? "inline-block rounded-[20px] bg-ink px-4 py-2.5 text-left text-[15px] leading-6 text-paper"
                            : "inline-block rounded-[20px] border border-line bg-paper-2 px-4 py-2.5 text-left text-[15px] leading-6 text-ink"
                        }
                        style={m.pending ? { opacity: 0.7 } : undefined}
                      >
                        {m.body}
                      </p>
                      <p className="mt-1 px-1 text-[11px] tracking-wide text-ink-faint">
                        {formatTime(m.created_at)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer is the last in-flow row of the conversation column
          (header / scrollable messages / composer) and owns the device
          safe-area inset (no bottom nav is rendered on this route).
          Single compact row: input + 52px send — no helper text. Enter
          sends, Shift+Enter newlines (see onKeyDown). It consumes its own
          space, so the message list above (flex-1, overflow-y-auto) is the
          only scroller and the composer never covers messages. */}
      <div
        className="shrink-0 border-t border-line bg-paper px-6 pt-3 sm:px-8"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        {sendError && (
          <div role="alert" className="mb-2 rounded-2xl border border-accent-soft bg-accent-wash px-4 py-3">
            <p className="text-[12px] leading-5 text-accent-deep">{sendError}</p>
          </div>
        )}
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="chat-composer" className="sr-only">
            write a message
          </label>
          <textarea
            id="chat-composer"
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autogrow();
            }}
            onInput={autogrow}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="say something kind…"
            inputMode="text"
            enterKeyHint="send"
            maxLength={1001}
            disabled={sending}
            className="max-h-[112px] min-h-[52px] flex-1 resize-none overflow-y-auto rounded-2xl border border-line bg-paper px-4 py-3 text-base leading-6 text-ink placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label="send message"
            className="inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-ink text-[18px] text-paper transition-colors hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <span aria-hidden>↑</span>
          </button>
        </form>
      </div>
    </div>
  );
}
