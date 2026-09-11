/**
 * A showcase customer for Tom to tour the portal with — seeded on the LIVE
 * project against the existing test login pg.alice.customer@gmail.com
 * (password painttest123, sign in at /login → lands on /account).
 * Idempotent: re-running wipes and rebuilds the demo story.
 */
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { resolveSeedTarget } from "../seed-target.mjs";

// F1-03: this used to read .env.local directly and ignore the environment —
// 23 write call sites, including account creation, straight into production.
const target = resolveSeedTarget("seed-demo-customer");

const db = createClient(target.url, target.serviceKey, { auth: { persistSession: false } });

const EMAIL = "pg.alice.customer@gmail.com";

/** A real solid-colour PNG (width×height), so storage renditions work. */
function png(w, h, [r, g, b]) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)]);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const day = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" })
  .format(new Date(Date.now() + n * 86_400_000));
const iso = (n, h = 9) => new Date(Date.now() + n * 86_400_000 - (24 - h) * 0).toISOString();

async function wipe() {
  const { data: acct } = await db.from("accounts").select("id").eq("email", EMAIL).maybeSingle();
  if (!acct) return;
  const { data: ests } = await db.from("estimates").select("id").eq("account_id", acct.id);
  const ids = (ests ?? []).map((e) => e.id);
  if (ids.length) {
    const { data: invs } = await db.from("invoices").select("id").in("estimate_id", ids);
    const invIds = (invs ?? []).map((i) => i.id);
    if (invIds.length) await db.from("payments").delete().in("invoice_id", invIds);
    await db.from("invoices").delete().in("estimate_id", ids);
    const { data: wos } = await db.from("work_orders").select("id").in("estimate_id", ids);
    for (const w of wos ?? []) {
      const { data: photos } = await db.from("wo_photos").select("storage_path").eq("work_order_id", w.id);
      const paths = (photos ?? []).map((p) => p.storage_path).filter((p) => p.startsWith("demo/"));
      if (paths.length) await db.storage.from("wo-photos").remove(paths);
    }
    await db.from("estimates").delete().in("id", ids); // cascades the WOs
  }
  await db.from("properties").delete().eq("account_id", acct.id);
  await db.from("warranty_issues").delete().eq("account_id", acct.id);
  await db.from("account_users").delete().eq("account_id", acct.id);
  await db.from("accounts").delete().eq("id", acct.id);
}

async function main() {
  await wipe();

  // Alice's auth user → membership.
  let aliceId = null;
  for (let page = 1; page <= 10 && !aliceId; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    aliceId = data?.users?.find((u) => (u.email ?? "").toLowerCase() === EMAIL)?.id ?? null;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  if (!aliceId) throw new Error(`${EMAIL} has no auth user — create the test login first`);

  const { data: acct } = await db.from("accounts")
    .insert({ email: EMAIL, name: "Margaret Attwood" }).select("id").single();
  await db.from("account_users").insert({ account_id: acct.id, profile_id: aliceId, role: "owner" });

  const { data: acacia } = await db.from("properties").insert({
    account_id: acct.id, address: "12 Acacia Street", suburb: "Northcote", state: "VIC",
    postcode: "3070", address_norm: "12 acacia street northcote 3070",
  }).select("id").single();
  const { data: elm } = await db.from("properties").insert({
    account_id: acct.id, address: "4 Elm Grove", suburb: "Preston", state: "VIC",
    postcode: "3072", address_norm: "4 elm grove preston 3072",
  }).select("id").single();

  // ---- Job 1 · the live project at Acacia Street ---------------------------
  const snapshot = {
    version: 1, woRef: "WO-DEMO1", jobTitle: "12 Acacia Street", jobAddress: "12 Acacia Street, Northcote",
    materials: [
      { product: "Dulux Wash&Wear Low Sheen", photoUrl: "", litres: 18, coverageMissing: false,
        colourName: "Natural White", colourHex: "#F2EFE6", colourStatus: "confirmed" },
      { product: "Dulux Aquanamel Semi-Gloss", photoUrl: "", litres: 6, coverageMissing: false,
        colourName: "Lexicon Quarter", colourHex: "#EDEEEA", colourStatus: "confirmed" },
    ],
    areas: [
      { id: "a0", title: "Hallway & stairs", finishCode: "PG-3", finishOverridden: false, photos: [],
        surfaces: [
          { key: "a0:0", label: "Walls", coats: 2, product: "Dulux Wash&Wear Low Sheen", prep: "", hours: 6, status: "in_progress" },
          { key: "a0:1", label: "Trim & doors", coats: 2, product: "Dulux Aquanamel Semi-Gloss", prep: "", hours: 4, status: "not_started" },
        ] },
      { id: "a1", title: "Lounge", finishCode: "PG-3", finishOverridden: false, photos: [],
        surfaces: [
          { key: "a1:0", label: "Walls", coats: 2, product: "Dulux Wash&Wear Low Sheen", prep: "", hours: 5, status: "not_started" },
          { key: "a1:1", label: "Feature wall", coats: 2, product: "Dulux Wash&Wear Low Sheen", prep: "", hours: 2, status: "not_started" },
        ] },
    ],
  };
  const { data: est1 } = await db.from("estimates").insert({
    title: "12 Acacia Street", status: "accepted", level_of_finish: 3, source: "manual",
    account_id: acct.id, property_id: acacia.id, total_cents: 845_000, accepted_total_cents: 845_000,
    builder_state: { blocks: [], contact: { first_name: "Margaret", email: EMAIL } },
  }).select("id").single();
  const { data: wo1 } = await db.from("work_orders").insert({
    estimate_id: est1.id, wo_ref: "WO-DEMO1", share_token: `demwo${Date.now() % 1e8}`,
    stage: "in_progress", status: "in_progress", issued_at: iso(-4),
    start_date: day(-2), end_date: day(3), wo_snapshot: snapshot,
  }).select("id").single();

  await db.from("wo_surfaces").insert([
    { work_order_id: wo1.id, heading: "Hallway & stairs", heading_meta: "", label: "Walls", sort: 0, state: "done" },
    { work_order_id: wo1.id, heading: "Hallway & stairs", heading_meta: "", label: "Trim & doors", sort: 1, state: "prepped" },
    { work_order_id: wo1.id, heading: "Lounge", heading_meta: "", label: "Walls", sort: 2, state: "todo" },
    { work_order_id: wo1.id, heading: "Lounge", heading_meta: "", label: "Feature wall", sort: 3, state: "todo" },
  ]);
  await db.from("wo_events").insert({
    work_order_id: wo1.id, type: "stage_changed", from_stage: "pre_start", to_stage: "in_progress",
    actor_kind: "system", created_at: iso(-2),
  });

  const shots = [
    ["before", "Before — hallway", [107, 104, 96], -2],
    ["before", "Before — lounge", [122, 117, 106], -2],
    ["progress", "Walls sanded & filled", [141, 137, 128], -1],
    ["progress", "First coat — Natural White", [235, 231, 219], 0],
  ];
  for (const [i, [kind, caption, rgb, d]] of shots.entries()) {
    const path = `demo/${wo1.id}/${i}-${kind}.png`;
    await db.storage.from("wo-photos").upload(path, png(640, 480, rgb), { contentType: "image/png", upsert: true });
    await db.from("wo_photos").insert({
      work_order_id: wo1.id, area: "Hallway & stairs", kind, storage_path: path,
      caption, created_at: iso(d, 10 + i),
    });
  }

  await db.from("wo_updates").insert([
    { work_order_id: wo1.id, for_date: day(-1), status: "sent", draft_text: "x",
      final_text: "Hallway fully prepared — cracks filled and sanded back, all trim masked, surfaces washed down. Paint goes on tomorrow.",
      sent_at: iso(-1, 16) },
    { work_order_id: wo1.id, for_date: day(0), status: "sent", draft_text: "x",
      final_text: "First coat on in the hallway — cut in this morning and rolled in Natural White. It needs to dry overnight, then the final coat goes on. Tomorrow: the lounge.",
      sent_at: iso(0, 16) },
  ]);
  await db.from("wo_variations").insert({
    work_order_id: wo1.id, category: "rot", comment: "Window sill by the stairs has soft timber — repair and prime before painting",
    status: "priced", price_cents: 34_000, customer_token: `demvt${Date.now() % 1e8}`,
  });

  const { data: inv1 } = await db.from("invoices").insert({
    estimate_id: est1.id, kind: "deposit", status: "paid", number: "INV-DEMO-2041",
    token: `demin${Date.now() % 1e8}`, subtotal_ex_cents: 230_455, gst_cents: 23_045,
    total_inc_cents: 253_500, issued_on: day(-10), due_on: day(-3),
  }).select("id").single();
  await db.from("payments").insert({
    invoice_id: inv1.id, amount_cents: 253_500, status: "succeeded", method: "bank_transfer",
    paid_on: day(-9), receipt_number: "RCT-DEMO-0181",
  });

  // ---- Job 2 · finished last winter at Elm Grove: register + warranty ------
  const { data: est2 } = await db.from("estimates").insert({
    title: "4 Elm Grove", status: "accepted", level_of_finish: 3, source: "manual",
    account_id: acct.id, property_id: elm.id, total_cents: 412_000, accepted_total_cents: 412_000,
    builder_state: { blocks: [], contact: { first_name: "Margaret", email: EMAIL } },
  }).select("id").single();
  const { data: wo2 } = await db.from("work_orders").insert({
    estimate_id: est2.id, wo_ref: "WO-DEMO2", share_token: `demw2${Date.now() % 1e8}`,
    stage: "closed", status: "complete", issued_at: iso(-100),
    start_date: day(-95), end_date: day(-90),
    wo_snapshot: {
      version: 1, woRef: "WO-DEMO2", jobTitle: "4 Elm Grove",
      materials: [
        { product: "Haymes Expressions Low Sheen", photoUrl: "", litres: 14, coverageMissing: false,
          colourName: "Greyology 1", colourHex: "#E8E6E1", colourStatus: "confirmed" },
        { product: "Haymes Ultratrim Semi-Gloss", photoUrl: "", litres: 4, coverageMissing: false,
          colourName: "Ultra White", colourHex: "#F4F3EF", colourStatus: "confirmed" },
      ],
      areas: [
        { id: "b0", title: "Whole interior", finishCode: "PG-3", finishOverridden: false, photos: [],
          surfaces: [
            { key: "b0:0", label: "Walls", coats: 2, product: "Haymes Expressions Low Sheen", prep: "", hours: 20, status: "complete" },
            { key: "b0:1", label: "Trim & doors", coats: 2, product: "Haymes Ultratrim Semi-Gloss", prep: "", hours: 10, status: "complete" },
          ] },
      ],
    },
    colours: { "Haymes Expressions Low Sheen": { status: "confirmed", match: { code: "GR-1", brand: "Haymes" } } },
  }).select("id").single();
  await db.from("warranties").insert({
    work_order_id: wo2.id, estimate_id: est2.id, starts_on: day(-90),
    ends_on: day(640), years: 2, signed_kind: "in_person",
  });

  console.log("DEMO READY — sign in at /login as", EMAIL, "(password painttest123) → lands on /account");
}

main().catch((e) => { console.error(e); process.exit(1); });
