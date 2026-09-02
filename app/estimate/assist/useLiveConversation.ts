"use client";

import { useEffect, useRef } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

/**
 * Realtime (S7): subscribe to this conversation's transcript and status under
 * the viewer's OWN session (RLS scopes what they may see), and refetch the
 * authoritative transcript on every event — messages are persisted first,
 * broadcast second, and the fetch is what renders. A polling fallback
 * covers a dropped socket.
 */
export type LiveSnapshot = {
  status: "open" | "handed_off" | "closed";
  handoff: { status: string } | null;
  transcript: Array<{ id: string; role: "user" | "assistant" | "staff" | "system"; text: string; createdAt: string }>;
};

export function useLiveConversation(conversationId: string, onSnapshot: (s: LiveSnapshot) => void, opts: { pollMs?: number } = {}) {
  const cb = useRef(onSnapshot);
  useEffect(() => { cb.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => {
    let alive = true;
    const refetch = async () => {
      try {
        const res = await fetch(`/api/agent/transcript?c=${conversationId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as LiveSnapshot;
        if (alive) cb.current(j);
      } catch { /* the next event or poll retries */ }
    };
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`agent:${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: `conversation_id=eq.${conversationId}` }, () => { void refetch(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "agent_conversations", filter: `id=eq.${conversationId}` }, () => { void refetch(); })
      .subscribe();
    const timer = setInterval(() => { void refetch(); }, opts.pollMs ?? 8000);
    return () => { alive = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, [conversationId, opts.pollMs]);
}
