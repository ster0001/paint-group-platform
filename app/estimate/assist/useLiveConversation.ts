"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/lazyClient";
import { reportError } from "@/lib/monitoring/report";

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
    // No conversation yet (the wizard's chat bubble before its first open): nothing to watch.
    if (!conversationId) return;
    let alive = true;
    const refetch = async () => {
      try {
        const res = await fetch(`/api/agent/transcript?c=${conversationId}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as LiveSnapshot;
        if (alive) cb.current(j);
      } catch { /* the next event or poll retries */ }
    };
    // The client loads on first use (lib/supabase/lazyClient.ts), so the
    // channel opens a moment after the effect — and not at all if the effect
    // was torn down first. The poll below covers that moment.
    let live: { supabase: SupabaseClient; channel: RealtimeChannel } | null = null;
    void browserClient().then((supabase) => {
      if (!alive) return;
      const channel = supabase
        .channel(`agent:${conversationId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_messages", filter: `conversation_id=eq.${conversationId}` }, () => { void refetch(); })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "agent_conversations", filter: `id=eq.${conversationId}` }, () => { void refetch(); })
        .subscribe();
      live = { supabase, channel };
    }, (e: unknown) => { reportError(e, { where: "useLiveConversation.channel" }); });
    // The first read straight away (a viewer that arrives with no
    // server-rendered transcript — the staff dock — would otherwise wait a
    // whole poll), deferred a tick to keep state changes out of the effect body.
    const first = setTimeout(() => { void refetch(); }, 0);
    const timer = setInterval(() => { void refetch(); }, opts.pollMs ?? 8000);
    return () => { alive = false; clearTimeout(first); clearInterval(timer); if (live) void live.supabase.removeChannel(live.channel); };
  }, [conversationId, opts.pollMs]);
}
