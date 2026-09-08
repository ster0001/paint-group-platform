"use client";

import { useCallback } from "react";
import ChatWidget from "@/app/wizard/ChatWidget";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { establishSession } from "@/lib/wizard/session";

/**
 * Tom, 8 Sep 2026: "can we link the same chat bot as we have on the wizard
 * screen on the website as well." Same component, same conversation — the
 * bubble keeps its thread id in localStorage under one key, so someone who
 * asks a question on the homepage and then starts an estimate carries the
 * same conversation with them, and staff answer both from the one dock.
 *
 * The one difference is WHEN the anonymous session is made. The wizard needs
 * one immediately (it is about to write a draft); a marketing visitor may
 * never touch the chat, and signing every passer-by in would mint an
 * anonymous user per page view. So the session is established on the first
 * tap of the bubble, through the same bounded retry/timeout helper the
 * wizard uses — a phone on a bad connection gets an error it can act on
 * rather than a spinner.
 */
export default function SiteChat() {
  const ensureSession = useCallback(async () => {
    const supabase = createBrowserClient();
    const outcome = await establishSession(async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return true;
      const { error } = await supabase.auth.signInAnonymously();
      return !error;
    });
    return outcome.phase === "ready";
  }, []);

  return <ChatWidget ready={false} place="site" ensureSession={ensureSession} />;
}
