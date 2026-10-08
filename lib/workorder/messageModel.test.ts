/**
 * Messages between the office and a painter, per project (Tom, 9 Oct 2026).
 *
 * The rules that matter, pinned here: one notification per burst (the TS twin
 * must say what wo_message_ping_due says), photos only in the thread's own
 * folder, a "sent" only when a channel actually sent (12A Cavell Court), and
 * the SQL that backs it all — read from the migration text, the house
 * contract pattern — keeps RLS on, writes behind definer functions, the bucket
 * private, and anon out.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MESSAGE_BURST_MINUTES, MESSAGE_MAX_CHARS, MESSAGE_MAX_PHOTOS, MESSAGE_PHOTO_MAX_BYTES, MESSAGE_PHOTO_TYPES,
  notifyLine, painterJobLabel, painterNotifyRecord, photoObjectPath, photoPathOk, pingDue, postErrorWords,
} from "./messageModel";

const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20270249000000_wo_painter_messages.sql"), "utf8");
const WO = "11111111-2222-4333-8444-555555555555";
const C = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "99999999-8888-4777-8666-555555555555";

describe("one notification per burst", () => {
  const now = new Date("2026-10-09T03:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

  it("tells them the first time on a thread", () => {
    expect(pingDue(null, null, now)).toBe(true);
  });
  it("a second message inside the window is covered by the first text", () => {
    expect(pingDue(ago(3), null, now)).toBe(false);
    expect(pingDue(ago(MESSAGE_BURST_MINUTES - 1), ago(20), now)).toBe(false);
  });
  it("after the window, they are told again", () => {
    expect(pingDue(ago(MESSAGE_BURST_MINUTES), null, now)).toBe(true);
    expect(pingDue(ago(45), null, now)).toBe(true);
  });
  it("having read the thread since the last telling, a new message is news", () => {
    expect(pingDue(ago(5), ago(2), now)).toBe(true);
  });
  it("is the same rule as the SQL function", () => {
    expect(SQL).toMatch(/p_pinged_at is null\s+or p_pinged_at <= p_now - interval '10 minutes'\s+or \(p_read_at is not null and p_read_at >= p_pinged_at\)/);
    expect(MESSAGE_BURST_MINUTES).toBe(10);
  });
});

describe("photos live in the thread's own folder", () => {
  it("names a new photo inside <job>/<painter>/ with a safe file name", () => {
    const p = photoObjectPath(WO, C, "image/png", 1760000000000, "Ab-12/../x");
    expect(p).toBe(`${WO}/${C}/1760000000000-Ab12x.png`);
    expect(photoPathOk(p, WO, C)).toBe(true);
  });
  it("refuses another painter's folder, another job, a nested or traversing path", () => {
    const p = photoObjectPath(WO, C, "image/jpeg", 1, "abc");
    expect(photoPathOk(p, WO, OTHER)).toBe(false);
    expect(photoPathOk(p, OTHER, C)).toBe(false);
    expect(photoPathOk(`${WO}/${C}/a/b.jpg`, WO, C)).toBe(false);
    expect(photoPathOk(`${WO}/${C}/../x.jpg`, WO, C)).toBe(false);
    expect(photoPathOk(`${WO}/${C}/`, WO, C)).toBe(false);
    expect(photoPathOk("x.jpg", "not-a-uuid", C)).toBe(false);
  });
  it("matches the database's own path test, the bucket's types and size", () => {
    expect(SQL).toContain("v_p !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'");
    expect(SQL).toContain(`values ('wo-messages', 'wo-messages', false, ${MESSAGE_PHOTO_MAX_BYTES},`);
    for (const t of MESSAGE_PHOTO_TYPES) expect(SQL).toContain(`'${t}'`);
    expect(SQL).toContain(`cardinality(photo_paths) <= ${MESSAGE_MAX_PHOTOS}`);
    expect(SQL).toContain(`char_length(body) <= ${MESSAGE_MAX_CHARS}`);
  });
});

describe("what telling the painter came to — the outcome, never the attempt", () => {
  it("sent only when a channel sent, and says how", () => {
    expect(painterNotifyRecord({ outcome: "sent", channels: ["sms", "email"], results: { sms: { status: "sent" }, email: { status: "sent" } } }, "Josef"))
      .toEqual({ status: "sent", detail: "Texted and emailed to Josef." });
    expect(painterNotifyRecord({ outcome: "sent", channels: ["email"], results: { email: { status: "sent" } }, fallback: "no mobile — emailed" }, "Josef").detail)
      .toBe("Emailed to Josef (no mobile — emailed).");
  });
  it("a provider that is not set up is NOT a send", () => {
    const r = painterNotifyRecord({ outcome: "sent", channels: ["sms"], results: { sms: { status: "not_configured" } } }, "Josef");
    expect(r.status).toBe("skipped");
    expect(r.detail).toBe("Nothing went out — Text: not set up on this server.");
  });
  it("nobody to reach, switched off, held for sending hours, waiting for approval — each in words", () => {
    expect(painterNotifyRecord({ outcome: "nobody", detail: "No email or mobile on file." }, "there").detail)
      .toBe("Not sent — the painter has no mobile or email on file. No email or mobile on file.");
    expect(painterNotifyRecord({ outcome: "off" }, "Josef").status).toBe("off");
    const held = painterNotifyRecord({ outcome: "held", holdId: "h", releaseAt: "2026-10-09T21:00:00Z", reason: "quiet" }, "Josef");
    expect(held.status).toBe("queued");
    expect(held.detail).toMatch(/^Outside sending hours — Josef is texted at Sat.*8:00/);
    expect(painterNotifyRecord({ outcome: "pending", holdId: "h" }, "Josef").status).toBe("queued");
  });
  it("a batched message says it is covered; a message never told says nothing", () => {
    expect(notifyLine("batched", "")).toMatch(/one per 10 minutes/);
    expect(notifyLine(null, "")).toBeNull();
    expect(notifyLine("skipped", "Not sent — x")).toBe("Not sent — x");
  });
});

describe("the painter sees the project, not the customer", () => {
  it("labels a thread by job ref and suburb only", () => {
    expect(painterJobLabel("WO-1042", "Thornbury")).toBe("WO-1042 · Thornbury");
    expect(painterJobLabel("WO-1042", "")).toBe("WO-1042");
  });
  it("every database refusal has words", () => {
    for (const code of ["not_signed_in", "bad_input", "not_on_job", "not_yours", "too_long", "too_many_photos", "empty", "bad_photo"]) {
      expect(SQL).toContain(`'${code}'`);
      expect(postErrorWords(code)).not.toMatch(/check your signal/);
    }
    expect(postErrorWords("something_new")).toMatch(/check your signal/);
  });
});

describe("the migration's security shape", () => {
  it("RLS on both tables, read-only to authenticated, nothing to anon", () => {
    expect(SQL).toContain("alter table public.wo_message_threads enable row level security;");
    expect(SQL).toContain("alter table public.wo_messages enable row level security;");
    expect(SQL).toContain("revoke all on public.wo_messages from public, anon, authenticated;");
    expect(SQL).toContain("grant select on public.wo_messages to authenticated;");
    expect(SQL).not.toMatch(/grant (insert|update|delete|all)[^;]*wo_message/i);
    expect(SQL).not.toMatch(/grant execute[^;]*to anon/);
  });
  it("a painter's read goes through the definer ownership helper; staff read all", () => {
    expect(SQL).toContain("using (public.is_staff() or public.wo_message_painter_ok(work_order_id, contractor_id));");
    expect(SQL).toContain("using (public.is_staff() or public.wo_message_thread_mine(thread_id));");
    expect(SQL).toMatch(/wo_message_painter_ok[\s\S]*?security definer[\s\S]*?p_contractor_id = public\.current_contractor_id\(\)[\s\S]*?wo_painter_on_job/);
  });
  it("an ownership answer is never NULL — a customer (no contractors row) once posted as the painter through a null", () => {
    expect(SQL).toMatch(/wo_message_painter_ok[\s\S]*?select coalesce\([\s\S]*?false\)\s*\$\$;/);
    expect(SQL).toContain("elsif public.wo_message_painter_ok(p_work_order_id, p_contractor_id) is not true then");
    expect(SQL).toContain("return public.wo_message_painter_ok(v_wo, v_c) is true;");
    expect(SQL).toContain("if public.wo_message_thread_mine(p_thread_id) is not true then return 'error:not_yours'; end if;");
    expect(SQL).not.toMatch(/\bif not public\.wo_message/);
  });
  it("every function grant is preceded by its revoke from public, anon", () => {
    const grants = [...SQL.matchAll(/grant execute on function (public\.[a-z_]+)\(/g)].map((m) => m[1]);
    expect(grants.length).toBe(7);
    for (const fn of grants) {
      const revoke = SQL.indexOf(`revoke execute on function ${fn}(`);
      const grant = SQL.indexOf(`grant execute on function ${fn}(`);
      expect(revoke, fn).toBeGreaterThan(-1);
      expect(revoke, fn).toBeLessThan(grant);
    }
  });
  it("the bucket is private; deleting is the office's; the run is recorded last", () => {
    expect(SQL).toContain("set public = false");
    expect(SQL).toContain("using (bucket_id = 'wo-messages' and public.is_staff());");
    expect(SQL.trimStart().startsWith("--")).toBe(true);
    expect(SQL).toMatch(/^set lock_timeout = '15s';$/m);
    expect(SQL.trim().split("\n").pop()).toBe("insert into public._prod_migrations(name) values ('20270249000000_wo_painter_messages.sql') on conflict (name) do nothing;");
  });
});
