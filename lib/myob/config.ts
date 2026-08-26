// MYOB Business integration — shared shapes and keys. Tom ruled 26 Aug:
// API integration, NOT an export file; his product is MYOB Business.
//
// Two settings rows:
//   myob_connection  server-managed OAuth state (tokens + chosen business).
//                    Never rendered to the browser — status only.
//   invoicing_myob   the account map (seeded empty by 20261112) — which MYOB
//                    ledger account each platform money stream lands in.
//                    ⚑18: the codes come from Tom's bookkeeper.

export const MYOB_CONNECTION_KEY = "myob_connection";
export const MYOB_ACCOUNTS_KEY = "invoicing_myob";

export type MyobCompanyFile = {
  id: string;
  name: string;
  uri: string; // the company file's API base, from MYOB's own listing
};

export type MyobConnection = {
  refreshToken: string;
  accessToken: string;
  /** ISO — MYOB access tokens live ~20 minutes; refresh under the hood. */
  accessExpiresAt: string;
  companyFile: MyobCompanyFile | null;
  connectedAt: string;
  /** The MYOB login that authorised us — display only. */
  myobUser?: string;
};

export type MyobAccountRef = {
  uid: string;
  displayId: string; // MYOB's account number, e.g. "4-1000"
  name: string;
};

/** slot key → chosen MYOB account. Slots without a pick are simply absent. */
export type MyobAccountMap = Record<string, MyobAccountRef>;

/**
 * The money streams the platform will push, each needing a ledger home.
 * `kinds` narrows the dropdown to sensible MYOB account classifications.
 */
export const MYOB_ACCOUNT_SLOTS: {
  key: string;
  label: string;
  hint: string;
  kinds: string[]; // MYOB Account "Classification" values
}[] = [
  {
    key: "salesIncome",
    label: "Sales income",
    hint: "Customer invoices land here",
    kinds: ["Income"],
  },
  {
    key: "bankAccount",
    label: "Bank account",
    hint: "Where customer payments are received",
    kinds: ["Asset"],
  },
  {
    key: "contractorPayments",
    label: "Contractor payments",
    hint: "Contractor invoices / subcontractor costs",
    kinds: ["Expense", "CostOfSales"],
  },
  {
    key: "materialsCosts",
    label: "Materials & supplier bills",
    hint: "bills@ paint and materials costs",
    kinds: ["Expense", "CostOfSales"],
  },
  {
    key: "expenseReimbursements",
    label: "Expense reimbursements",
    hint: "Contractor/staff at-cost reimbursements",
    kinds: ["Expense", "CostOfSales"],
  },
  {
    key: "merchantFees",
    label: "Card surcharge / merchant fees",
    hint: "Stripe fees and card surcharge income",
    kinds: ["Income", "Expense"],
  },
];

/** True while the stored access token still has a safety margin left. */
export function accessTokenFresh(conn: MyobConnection, nowMs: number): boolean {
  const at = Date.parse(conn.accessExpiresAt);
  return Number.isFinite(at) && at - nowMs > 60_000;
}

export type MyobStatus =
  | { state: "unconfigured" } // no client id/secret in env
  | { state: "disconnected" }
  | { state: "pick_business"; myobUser?: string }
  | { state: "connected"; businessName: string; myobUser?: string; connectedAt: string };

export function myobStatus(
  envConfigured: boolean,
  conn: MyobConnection | null,
): MyobStatus {
  if (!envConfigured) return { state: "unconfigured" };
  if (!conn?.refreshToken) return { state: "disconnected" };
  if (!conn.companyFile) return { state: "pick_business", myobUser: conn.myobUser };
  return {
    state: "connected",
    businessName: conn.companyFile.name,
    myobUser: conn.myobUser,
    connectedAt: conn.connectedAt,
  };
}
