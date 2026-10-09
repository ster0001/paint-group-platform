import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { copiedPhotoPath, noteOutcomeFor } from "./siteNoteMessage";
import { photoPathOk } from "./messageModel";

/**
 * Tom, 9 Oct 2026: ONE route for messages to the painter. A site check-in
 * note sent to the painter is delivered as an office message in the job's
 * thread with them; the note's own sent_outcome (20270248: 'sent' | 'skipped')
 * says what that came to.
 */
const SQL = readFileSync(resolve(__dirname, "../../supabase/migrations/20270249000000_wo_painter_messages.sql"), "utf8");
const WO = "11111111-2222-4333-8444-555555555555";
const C = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PHOTO = "99999999-8888-4777-8666-555555555555";

describe("the note's outcome, from the message's", () => {
  it("sent or held for sending hours is on its way; batched is covered by the text just sent", () => {
    expect(noteOutcomeFor({ status: "sent", detail: "Texted to Marco." })).toEqual({ outcome: "sent", detail: "Texted to Marco." });
    expect(noteOutcomeFor({ status: "queued", detail: "Outside sending hours — Marco is texted at Mon 8:00 am." }).outcome).toBe("sent");
    expect(noteOutcomeFor(null)).toEqual({ outcome: "sent", detail: "Covered by the text that just went — one per 10 minutes." });
  });
  it("not reached, or switched off, is skipped — with the reason", () => {
    expect(noteOutcomeFor({ status: "skipped", detail: "Not sent — Marco has no mobile or email on file." }))
      .toEqual({ outcome: "skipped", detail: "Not sent — Marco has no mobile or email on file." });
    expect(noteOutcomeFor({ status: "off", detail: "Not texted — switched off." }).outcome).toBe("skipped");
  });
});

describe("the note's photos, copied into the thread", () => {
  it("land in the thread's own folder under a name wo_message_post accepts", () => {
    const p = copiedPhotoPath(WO, C, PHOTO, `${WO}/visit/1760000000000-ab.PNG`);
    expect(p).toBe(`${WO}/${C}/sv-${PHOTO}.png`);
    expect(photoPathOk(p, WO, C)).toBe(true);
    expect(copiedPhotoPath(WO, C, PHOTO, `${WO}/visit/noext`)).toBe(`${WO}/${C}/sv-${PHOTO}.jpg`);
  });
});

describe("wo_message_post_from — the SQL", () => {
  it("staff only, the note's own words, a shared note on the painter's job, once per note", () => {
    const fn = SQL.slice(SQL.indexOf("create or replace function public.wo_message_post_from("), SQL.indexOf("-- ---- 6."));
    expect(fn).toContain("security definer");
    expect(fn).toContain("if public.is_staff() is not true then return jsonb_build_object('error', 'not_staff'); end if;");
    expect(fn).toContain("select n.work_order_id, n.body, n.send_to_painter into v_wo, v_body, v_shared");
    expect(fn).toContain("if v_shared is not true then return jsonb_build_object('error', 'not_shared'); end if;");
    expect(fn).toContain("public.wo_message_insert(v_wo, p_contractor_id, 'staff', v_body, p_photo_paths, p_source, p_source_id)");
    expect(SQL).toContain("on conflict (source, source_id) where source_id is not null do nothing");
  });
  it("the shared insert is callable by nobody but the definer functions", () => {
    expect(SQL).toContain("revoke execute on function public.wo_message_insert(uuid, uuid, text, text, text[], text, uuid) from public, anon, authenticated;");
    expect(SQL).not.toMatch(/grant execute on function public\.wo_message_insert/);
    const ins = SQL.slice(SQL.indexOf("create or replace function public.wo_message_insert("), SQL.indexOf("create or replace function public.wo_message_post("));
    expect(ins).not.toContain("security definer");
  });
});
