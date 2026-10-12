/**
 * Golden tests for the Payments page's per-job row (payments-merge brief §4.1,
 * Step 1). The fixtures are the 12 Oct 2026 cases from the brief's §6, with
 * fictional street and customer names (the repo is public): jobs under way with
 * the deposit still a draft, a booked job with no invoice, a closed job with no
 * invoice, a first payment request labelled Progress, leftover drafts beside a
 * final, plus an overdue claim, a paid-in-full job and the midday overdue line.
 */
import { describe, expect, it } from "vitest";
import { melbourneInstant } from "@/lib/time/businessHours";
import type { DerivePayment } from "./derive";
import type { WoStage } from "@/lib/workorder/stages";
import {
  compareRows, depositPreview, headlineParts, parseDollarsToCents, suggestedDue, headlineSentences, matchRows, tableFilter, totalCollectableCents, totalNowCents, isLeftoverDraft, jobMoneyPage, jobMoneyRow, slotOf,
  contractorGroups, matchCiRows, totalCiCents,
  type JobMoneyCi, type JobMoneyInput, type JobMoneyInvoice, type JobMoneyJob,
} from "./jobMoney";

/** Mon 12 Oct 2026, 9:20 pm Melbourne — when the mockup's figures were read. */
const NOW = melbourneInstant(2026, 10, 12, 21, 20);
const fmt = (c: number) => "$" + (c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let seq = 0;
const job = (estimateId: string, address: string, woStage: WoStage | null, startDate: string | null, acceptedTotalCents: number, extra: Partial<JobMoneyJob> = {}): JobMoneyJob => ({
  estimateId, address, customer: `Customer ${estimateId}`, woRef: `WO-${estimateId}`, contractor: "Fictional Painting Pty Ltd",
  woStage, startDate, acceptedTotalCents, variations: [], ...extra,
});
const inv = (estimateId: string, kind: JobMoneyInvoice["kind"], status: JobMoneyInvoice["status"], totalIncCents: number, dueOn: string | null = null, extra: Partial<JobMoneyInvoice> = {}): JobMoneyInvoice => {
  seq += 1;
  return {
    id: `${estimateId}-${kind}-${seq}`, estimateId, kind, status, totalIncCents, dueOn,
    issuedOn: status === "draft" ? null : "2026-10-01", number: status === "draft" ? null : `INV-${String(seq).padStart(4, "0")}`,
    createdAt: `2026-10-01T0${seq % 10}:00:00Z`, ...extra,
  };
};
const paid = (invoiceId: string, amountCents: number, paidOn: string): DerivePayment => ({ invoiceId, amountCents, status: "succeeded", paidOn });

// ---- the fixture set ---------------------------------------------------------------
const jobs: JobMoneyJob[] = [
  job("kite", "17 Kite St, Forest Hill", "in_progress", "2026-10-05", 1_573_079),
  job("saltbush", "12A Saltbush Ct Interior, Beaumaris", "in_progress", "2026-10-07", 106_535),
  job("kookaburra", "91 Kookaburra St, Richmond", "qa", "2026-09-28", 1_074_504),
  job("kestrel", "8 Kestrel Ct, Wonga Park", "pre_start", "2026-10-13", 120_010),
  job("ironbark", "20 Ironbark St, Preston", "pre_start", "2026-10-13", 833_176),
  job("stint", "77 Stint Rd", "pre_start", "2026-10-30", 1_751_900),
  job("egret", "1 Egret St", "closed", null, 1_312_100),
  job("heron", "247-249 Heron Rd, Preston", "offered", null, 1_167_560),
  job("brolga", "40 Brolga Blvd, St Kilda", "closed", null, 900_986),
  job("wren", "13 Wren Cres, Caulfield East", "closed", null, 1_405_112),
  job("avocet", "5 Avocet Pl, Elwood", "in_progress", "2026-10-01", 400_000),
  job("gannet", "3 Gannet Way, Brighton", "closed", null, 100_000),
  job("wattle", "9 Wattle St, Coburg", "offered", null, 300_000, {
    variations: [{ status: "customer_approved", priceCents: 20_000 }, { status: "declined", priceCents: 99_999 }],
  }),
  job("robin", "4 Robin Ct, Malvern", "in_progress", "2026-10-06", 500_000),
];

const I = {
  kite: inv("kite", "deposit", "draft", 786_540),
  saltbush: inv("saltbush", "deposit", "draft", 53_268),
  kookaburra: inv("kookaburra", "deposit", "draft", 537_252),
  kestrel: inv("kestrel", "deposit", "viewed", 60_005, "2026-10-15"),
  ironbark: inv("ironbark", "deposit", "sent", 416_588, "2026-10-12"),
  heron: inv("heron", "progress", "sent", 583_780, "2026-10-19"),
  brolgaDep: inv("brolga", "deposit", "paid", 450_493, "2026-09-20"),
  brolgaFinal: inv("brolga", "final", "sent", 450_493, "2026-10-13"),
  wrenFinal: inv("wren", "final", "draft", 1_405_112),
  wrenDep: inv("wren", "deposit", "draft", 702_556),
  wrenZero: inv("wren", "progress", "draft", 0),
  avocetDep: inv("avocet", "deposit", "paid", 200_000, "2026-09-25"),
  avocetProg: inv("avocet", "progress", "sent", 200_000, "2026-10-09"),
  gannetDep: inv("gannet", "deposit", "paid", 50_000, "2026-08-20"),
  gannetFinal: inv("gannet", "final", "paid", 50_000, "2026-09-10"),
  wattle: inv("wattle", "deposit", "draft", 150_000),
  robinDep: inv("robin", "deposit", "paid", 250_000, "2026-10-08"),
  void: inv("robin", "progress", "void", 999_999, "2026-09-01"),
};
const payments: DerivePayment[] = [
  paid(I.brolgaDep.id, 450_493, "2026-10-01"),
  paid(I.avocetDep.id, 200_000, "2026-10-02"),
  paid(I.gannetDep.id, 50_000, "2026-09-01"),
  paid(I.gannetFinal.id, 50_000, "2026-09-15"),
  paid(I.robinDep.id, 250_000, "2026-10-10"),
  { invoiceId: I.heron.id, amountCents: 583_780, status: "failed", paidOn: "2026-10-11" },
];
const contractorInvoices: JobMoneyCi[] = [
  { id: "ci-a", number: "CI-0007", status: "approved", totalIncCents: 100_000, dueOn: "2026-10-01", contractor: "Fictional Painting Pty Ltd", estimateId: "brolga", autoDraftSource: "signoff" },
  { id: "ci-s", number: "CI-0016", status: "submitted", totalIncCents: 1_722_671, dueOn: null, contractor: "Another Painting Co", estimateId: "egret", autoDraftSource: "claim", claimPct: 50 },
  { id: "ci-p", number: "CI-0005", status: "paid", totalIncCents: 500_000, dueOn: "2026-09-01", contractor: "Fictional Painting Pty Ltd", estimateId: "gannet" },
  { id: "ci-d", number: null, status: "draft", totalIncCents: 171_428, dueOn: "2026-10-20", contractor: "Fictional Painting Pty Ltd", estimateId: null, address: "Somewhere off the board", autoDraftSource: "bonus" },
];
const input: JobMoneyInput = {
  jobs, invoices: Object.values(I), payments, contractorInvoices,
  materials: { intakePending: [{ totalCents: 1_534_218 }], jobCosts: [{ status: "recorded", amountExCents: 261_672, gstCents: 26_167 }, { status: "paid", amountExCents: 4_545, gstCents: 455 }] },
  now: NOW,
};
const page = jobMoneyPage(input);
const row = (id: string) => page.rows.find((r) => r.estimateId === id)!;

describe("slot states (§4.1 table) — every state on a real-shaped job", () => {
  it("need: a deposit not in on a job booked through to walkthrough, draft or sent", () => {
    expect(row("kite").slots.deposit.state).toBe("need");         // under way, deposit a draft (§6.6)
    expect(row("kookaburra").slots.deposit.state).toBe("need");   // quality check, deposit a draft
    expect(row("kestrel").slots.deposit.state).toBe("need");      // pre-start, sent and opened
  });
  it("over: sent, unpaid, past the midday-after line", () => {
    expect(row("avocet").slots.progress.state).toBe("over");
    expect(row("avocet").slots.deposit.state).toBe("paid");
  });
  it("sent: sent and not yet overdue — due today is not overdue", () => {
    expect(row("brolga").slots.final.state).toBe("sent");
    expect(row("ironbark").slots.deposit.dueOn).toBe("2026-10-12");
    expect(row("ironbark").slots.deposit.state).toBe("need");     // booked, so need — but not over
  });
  it("draft: not sent, on a job not booked yet", () => {
    expect(row("wattle").slots.deposit.state).toBe("draft");
  });
  it("noinv: booked with no invoice at all (§6.6, the 77 Williamstown case)", () => {
    expect(row("stint").slots.deposit.state).toBe("noinv");
    expect(row("stint").lane).toBe("booking_confirmed");
    expect(row("stint").next).toMatchObject({ state: "noinv", invoiceId: null, amountCents: null });
  });
  it("uninv: closed with part of the contract on no invoice (§6.5, the McNamara case)", () => {
    expect(row("egret").slots.final).toMatchObject({ state: "uninv", amountCents: 1_312_100 });
    expect(row("egret").slots.deposit.state).toBe("none");
    expect(row("egret").next).toMatchObject({ state: "uninv", invoiceId: null, amountCents: 1_312_100 });
  });
  it("later: the final not invoiced yet on an open job, carrying the remainder", () => {
    expect(row("kite").slots.final).toMatchObject({ state: "later", amountCents: 786_539 });
  });
  it("paid: nothing owing in the slot", () => {
    expect(row("gannet").slots.deposit.state).toBe("paid");
    expect(row("gannet").slots.final.state).toBe("paid");
  });
});

describe("the slot rule", () => {
  it("a first payment request labelled Progress sits in the DEPOSIT slot (PS-3102 / 3153 / 3613)", () => {
    expect(slotOf(I.heron, [I.heron])).toBe("deposit");
    expect(row("heron").slots.deposit).toMatchObject({ state: "sent", invoiceIds: [I.heron.id], amountCents: 583_780 });
    expect(row("heron").slots.progress.state).toBe("none");
  });
  it("a progress claim after a deposit stays in Progress", () => {
    expect(slotOf(I.avocetProg, [I.avocetDep, I.avocetProg])).toBe("progress");
  });
  it("finals are final; voids and written-off invoices are nowhere", () => {
    expect(slotOf(I.brolgaFinal, [I.brolgaDep, I.brolgaFinal])).toBe("final");
    expect(row("robin").slots.progress.state).toBe("none");
  });
});

describe("leftover drafts are hidden by rule, never deleted (§6.1, §6.2)", () => {
  it("a $0.00 draft and a deposit draft beside a final", () => {
    const wren = [I.wrenFinal, I.wrenDep, I.wrenZero];
    expect(isLeftoverDraft(I.wrenZero, wren)).toBe(true);
    expect(isLeftoverDraft(I.wrenDep, wren)).toBe(true);
    expect(isLeftoverDraft(I.wrenFinal, wren)).toBe(false);
    expect(row("wren").hiddenDraftIds.sort()).toEqual([I.wrenDep.id, I.wrenZero.id].sort());
    expect(row("wren").slots.deposit.state).toBe("none");
    expect(page.hiddenDraftCount).toBe(2);
  });
});

describe("money on the row reconciles to the ledger", () => {
  it("contract = accepted + approved variations (declined never counts)", () => {
    expect(row("wattle").contractCents).toBe(320_000);
    expect(row("wattle").variationsCents).toBe(20_000);
  });
  it("paid counts succeeded payments only; balance = contract − paid", () => {
    expect(row("heron").paidCents).toBe(0);                       // the failed payment is not money
    expect(row("brolga")).toMatchObject({ paidCents: 450_493, balanceCents: 450_493 });
  });
  it("collectable = unpaid invoice balances, plus the uninvoiced remainder once closed", () => {
    expect(row("kite").collectableCents).toBe(786_540);           // open job: the final is not collectable yet
    expect(row("egret").collectableCents).toBe(1_312_100);
    expect(row("wren").collectableCents).toBe(1_405_112);         // hidden drafts never count
  });
  it("every job's figures add up across the page", () => {
    const totalBalance = page.rows.reduce((s, r) => s + r.balanceCents, 0);
    const contract = page.rows.reduce((s, r) => s + r.contractCents, 0);
    const paidAll = payments.filter((p) => p.status === "succeeded").reduce((s, p) => s + p.amountCents, 0);
    expect(totalBalance).toBe(contract - paidAll);
  });
});

describe("sections and ordering", () => {
  it("each job lands in one To-chase section", () => {
    const sections = Object.fromEntries(page.rows.map((r) => [r.estimateId, r.section]));
    expect(sections).toEqual({
      avocet: "overdue",
      kite: "deposit_not_in", saltbush: "deposit_not_in", kookaburra: "deposit_not_in",
      kestrel: "deposit_not_in", ironbark: "deposit_not_in", stint: "deposit_not_in",
      egret: "closed_owing", brolga: "closed_owing", wren: "closed_owing",
      heron: "waiting", wattle: "not_booked", robin: "nothing", gannet: "paid_in_full",
    });
  });
  it("overdue first; need: under way first then soonest start; then sent, draft, the rest", () => {
    expect(page.rows.map((r) => r.estimateId)).toEqual([
      "avocet",
      "kookaburra", "kite", "saltbush",      // under way, soonest start first
      "ironbark", "kestrel",                 // both start tomorrow — the earlier due first
      "stint",                               // no invoice, starts in 18 days
      "brolga", "heron",                     // sent: due 13 Oct, then 19 Oct
      "wren", "wattle",                      // drafts: the larger first
      "egret",                               // uninvoiced
      "robin",                               // nothing to collect now
      "gannet",                              // paid in full
    ]);
  });
  it("compareRows is the order the page uses", () => {
    const resorted = [...page.rows].reverse().sort(compareRows).map((r) => r.estimateId);
    expect(resorted).toEqual(page.rows.map((r) => r.estimateId));
  });
});

describe("the four blocks and the stage strip come from the same rows", () => {
  it("Customers owe us: outstanding on issued invoices, the drafts not sent yet", () => {
    expect(page.blocks.customers).toEqual({
      outstandingCents: 60_005 + 416_588 + 583_780 + 450_493 + 200_000, outstandingCount: 5,
      overdueCents: 200_000, overdueCount: 1,
      notSentCents: 786_540 + 53_268 + 537_252 + 1_405_112 + 150_000, notSentCount: 5,
    });
  });
  it("Contractors and Materials", () => {
    expect(page.blocks.contractors).toEqual({
      toApproveCents: 1_722_671, toApproveCount: 1, approvedToPayCents: 100_000, approvedToPayCount: 1,
      pastPayByCents: 100_000, pastPayByCount: 1, owingCents: 1_822_671,
    });
    expect(page.blocks.materials).toEqual({
      toCheckCents: 1_534_218, toCheckCount: 1, toApproveCents: 287_839, toApproveCount: 1,
      toPayCents: 0, toPayCount: 0, openCents: 1_822_057,
    });
  });
  it("Activity: received in the last 14 days", () => {
    expect(page.blocks.activity.receivedFortnightCents).toBe(450_493 + 200_000 + 250_000);
  });
  it("the strip: seven lanes in Project Progress order; paid-in-full jobs leave it", () => {
    expect(page.strip.map((c) => c.lane)).toEqual(["offered", "booking_confirmed", "pre_start", "in_progress", "qa", "walkthrough", "closed"]);
    expect(page.strip.find((c) => c.lane === "in_progress")).toEqual({ lane: "in_progress", jobs: 4, collectableCents: 786_540 + 53_268 + 200_000, overdueCents: 200_000, tone: "bad" });
    expect(page.strip.find((c) => c.lane === "closed")).toEqual({ lane: "closed", jobs: 3, collectableCents: 1_312_100 + 450_493 + 1_405_112, overdueCents: 0, tone: "wait" });
    expect(page.strip.find((c) => c.lane === "booking_confirmed")).toMatchObject({ jobs: 1, collectableCents: 0 });
  });
});

describe("the headline (R2)", () => {
  it("the fixture set reads exactly", () => {
    expect(headlineSentences(page.headline, fmt).join(" ")).toBe(
      "6 jobs have no deposit in. 2 start within three days and 3 are already under way. " +
      "1 customer invoice is overdue, $2,000.00. 1 contractor invoice is past the pay-by date.",
    );
  });
  it("the mockup's sentence, and every clause dropping at zero", () => {
    const base = { noDepositJobs: 19, startWithinThreeDays: 3, underWay: 3, overdueInvoices: 0, overdueCents: 0, contractorPastPayBy: 0 };
    expect(headlineSentences(base, fmt).join(" ")).toBe("19 jobs have no deposit in. 3 start within three days and 3 are already under way. Nothing is overdue.");
    expect(headlineSentences({ ...base, startWithinThreeDays: 0 }, fmt).join(" ")).toBe("19 jobs have no deposit in. 3 are already under way. Nothing is overdue.");
    expect(headlineSentences({ ...base, startWithinThreeDays: 1, underWay: 0 }, fmt).join(" ")).toBe("19 jobs have no deposit in. 1 starts within three days. Nothing is overdue.");
    expect(headlineSentences({ ...base, noDepositJobs: 0, startWithinThreeDays: 0, underWay: 0 }, fmt).join(" ")).toBe("Nothing is overdue.");
    expect(headlineSentences({ ...base, noDepositJobs: 1, startWithinThreeDays: 0, underWay: 1, overdueInvoices: 2, overdueCents: 123_456 }, fmt).join(" "))
      .toBe("1 job has no deposit in. 1 is already under way. 2 customer invoices are overdue, $1,234.56.");
  });
});

describe("overdue is the shared midday-after rule (Tom, 12 Oct 2026)", () => {
  const j = job("plover", "6 Plover St", "in_progress", "2026-10-01", 400_000);
  const dep = inv("plover", "deposit", "paid", 200_000, "2026-09-25");
  const claim = inv("plover", "progress", "sent", 200_000, "2026-10-11");
  const pays = [paid(dep.id, 200_000, "2026-09-26")];
  it("due Sunday: not overdue at 11:59 on Monday, overdue from 12:00", () => {
    expect(jobMoneyRow(j, [dep, claim], pays, melbourneInstant(2026, 10, 12, 11, 59)).slots.progress.state).toBe("sent");
    expect(jobMoneyRow(j, [dep, claim], pays, melbourneInstant(2026, 10, 12, 12)).slots.progress.state).toBe("over");
  });
});

describe("Step 2 — what the page reads off a row", () => {
  it("each slot's lead invoice: state, days, share of the contract, views", () => {
    expect(row("kestrel").slots.deposit.lead).toMatchObject({ kind: "deposit", state: "need", sent: true, balanceCents: 60_005, dueInDays: 3, overdueDays: null, pctOfContract: 50 });
    expect(row("avocet").slots.progress.lead).toMatchObject({ state: "over", overdueDays: 3, dueInDays: -3 });
    expect(row("kite").slots.deposit.lead).toMatchObject({ sent: false, pctOfContract: 50 });
    expect(row("stint").slots.deposit.lead).toBeNull();
    expect(row("ironbark").next?.lead).toMatchObject({ dueInDays: 0, state: "need" });   // "due today"
  });
  it("the orange pulse: deposit not in AND starting within a week or under way (⚑P1)", () => {
    expect(["kite", "saltbush", "kookaburra", "kestrel", "ironbark"].every((id) => row(id).pulse)).toBe(true);
    expect(row("stint").pulse).toBe(false);          // orange, but 18 days out
    expect(row("brolga").pulse).toBe(false);
  });
  it("search matches address, customer, contractor and work-order ref; the strip filters by lane", () => {
    expect(matchRows(page.rows, { q: "kite st" }).map((r) => r.estimateId)).toEqual(["kite"]);
    expect(matchRows(page.rows, { q: "WO-heron" }).map((r) => r.estimateId)).toEqual(["heron"]);
    expect(matchRows(page.rows, { q: "customer gannet" }).map((r) => r.estimateId)).toEqual(["gannet"]);
    expect(matchRows(page.rows, { lane: "qa" }).map((r) => r.estimateId)).toEqual(["kookaburra"]);
  });
  it("All jobs filters; a paid-in-full job shows only under Show paid or Paid in full (R9)", () => {
    const ids = (f: Parameters<typeof tableFilter>[0], paid = false) => page.rows.filter(tableFilter(f, paid)).map((r) => r.estimateId);
    expect(ids("all")).not.toContain("gannet");
    expect(ids("all", true)).toContain("gannet");
    expect(ids("paid")).toEqual(["gannet"]);
    expect(ids("over")).toEqual(["avocet"]);
    expect(ids("dep").sort()).toEqual(["ironbark", "kestrel", "kite", "kookaburra", "saltbush", "stint"]);
    expect(ids("fin").sort()).toEqual(["brolga", "egret", "wren"]);
  });
  it("section and lane totals are lib sums", () => {
    const dep = page.rows.filter((r) => r.section === "deposit_not_in");
    expect(totalNowCents(dep)).toBe(786_540 + 53_268 + 537_252 + 60_005 + 416_588);
    expect(totalCollectableCents(page.rows.filter((r) => r.lane === "closed"))).toBe(1_312_100 + 450_493 + 1_405_112);
  });
  it("headline parts: the count orange, overdue sentences red, same words as the sentence", () => {
    const parts = headlineParts(page.headline, fmt);
    expect(parts.map((p) => p.text).join("")).toBe(headlineSentences(page.headline, fmt).join(" "));
    expect(parts[0]).toEqual({ text: "6 jobs", tone: "o" });
    expect(parts.filter((p) => p.tone === "r").map((p) => p.text.trim())).toEqual([
      "1 customer invoice is overdue, $2,000.00.", "1 contractor invoice is past the pay-by date.",
    ]);
  });
});

describe("Step 3 — the Send confirm's default due date (§4.3)", () => {
  it("7 days from today, or the day before a sooner start", () => {
    expect(suggestedDue("2026-10-12", null, 7)).toBe("2026-10-19");
    expect(suggestedDue("2026-10-12", "2026-10-30", 7)).toBe("2026-10-19");   // start is later: terms win
    expect(suggestedDue("2026-10-12", "2026-10-15", 7)).toBe("2026-10-14");   // starts sooner: the day before
    expect(suggestedDue("2026-10-12", "2026-10-13", 7)).toBe("2026-10-12");   // starts tomorrow: due today
    expect(suggestedDue("2026-10-12", "2026-10-01", 7)).toBe("2026-10-19");   // already under way: terms
    expect(suggestedDue("2026-12-28", null, 7)).toBe("2027-01-04");           // across the year
  });
  it("drafts carry it; sent invoices don't (R13: the due date locks at send)", () => {
    expect(row("kite").slots.deposit.lead?.suggestedDueOn).toBe("2026-10-19");
    expect(row("kestrel").slots.deposit.lead?.suggestedDueOn).toBeNull();
  });
});

describe("Step 3 — sheet previews (the server still decides)", () => {
  it("parses what an office types", () => {
    expect(parseDollarsToCents("$7,865.40")).toBe(786_540);
    expect(parseDollarsToCents("1234.5")).toBe(123_450);
    expect(parseDollarsToCents("1,234")).toBe(123_400);
    expect(parseDollarsToCents("0")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
  it("deposit preview: 30% of the contract, and what is left — same rounding as invoice_set_deposit", () => {
    expect(depositPreview(1_573_079, { pct: 30 })).toEqual({ depositCents: 471_924, pctOfContract: 30, leavesCents: 1_101_155 });
    expect(depositPreview(1_573_079, { pct: 50 }).depositCents).toBe(786_540);   // the live 50% draft
    expect(depositPreview(100_000, { cents: 33_333 })).toEqual({ depositCents: 33_333, pctOfContract: 33.3, leavesCents: 66_667 });
    expect(depositPreview(100_000, { cents: 500_000 }).depositCents).toBe(100_000);
  });
});

describe("Step 4 — last messaged (§4.4)", () => {
  it("Melbourne days since the newest staff line; null when never messaged", () => {
    const j = job("lark", "2 Lark St", "pre_start", "2026-10-20", 200_000, { lastMessagedAt: "2026-10-09T23:30:00Z" }); // 10 Oct, 10:30 am Melbourne
    expect(jobMoneyRow(j, [], [], NOW).lastMessagedDays).toBe(2);
    expect(jobMoneyRow({ ...j, lastMessagedAt: "2026-10-12T01:00:00Z" }, [], [], NOW).lastMessagedDays).toBe(0);
    expect(row("kite").lastMessagedDays).toBeNull();
  });
});

describe("Step 5 — the Contractors block (§4.5)", () => {
  const ci = (id: string) => page.contractors.find((c) => c.id === id)!;
  it("sections in order: past the pay-by date, to approve, to pay, with the contractor, paid", () => {
    expect(page.contractors.map((c) => [c.id, c.section])).toEqual([
      ["ci-a", "past_pay_by"], ["ci-s", "to_approve"], ["ci-d", "with_contractor"], ["ci-p", "paid"],
    ]);
    expect(ci("ci-a").overdueDays).toBe(11);
  });
  it("the customer-paid line is the job panel's own figures", () => {
    expect(ci("ci-a").customerPaid).toEqual({ paidCents: row("brolga").paidCents, contractCents: row("brolga").contractCents });
    expect(ci("ci-s").customerPaid).toEqual({ paidCents: 0, contractCents: 1_312_100 });       // paid nothing yet
    expect(ci("ci-p").customerPaid).toEqual({ paidCents: 100_000, contractCents: 100_000 });   // paid in full
    expect(ci("ci-d").customerPaid).toBeNull();                                                 // not on the board
  });
  it("claim notes, bonus flags, and the to-approve total equals the old Payables tile", () => {
    expect(ci("ci-s").claimNote).toBe("claim 50%");
    expect(ci("ci-d").bonus).toBe(true);
    const toApprove = page.contractors.filter((c) => c.status === "submitted");
    expect(totalCiCents(toApprove)).toBe(page.blocks.contractors.toApproveCents);
  });
  it("by contractor: open invoices grouped, with the ids Approve all and ✓ Paid act on", () => {
    const g = contractorGroups(page.contractors);
    expect(g.map((x) => x.contractor)).toEqual(["Fictional Painting Pty Ltd", "Another Painting Co"]);
    expect(g[0]).toMatchObject({ openCents: 100_000 + 171_428, toPayIds: ["ci-a"], toPayCents: 100_000, toApproveIds: [], anyPastPayBy: true });
    expect(g[1].toApproveIds).toEqual(["ci-s"]);
  });
  it("search: contractor, address, number", () => {
    expect(matchCiRows(page.contractors, "another").map((c) => c.id)).toEqual(["ci-s"]);
    expect(matchCiRows(page.contractors, "CI-0005").map((c) => c.id)).toEqual(["ci-p"]);
    expect(matchCiRows(page.contractors, "brolga").map((c) => c.id)).toEqual(["ci-a"]);
  });
});
