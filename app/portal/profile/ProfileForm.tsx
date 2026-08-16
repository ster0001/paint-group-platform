"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { signout } from "@/app/auth/actions";
import {
  DOC_LABEL,
  daysUntil,
  docState,
  missingProfileFields,
  type ContractorDoc,
  type ContractorRow,
} from "@/lib/contractor/model";

const DOCS_BUCKET = "contractor-docs";
const LOGO_BUCKET = "contractor-logos";

// Turns a Supabase error into something a painter can act on, rather than
// "new row violates row-level security policy".
// Supabase returns plain objects (PostgrestError / StorageError), NOT Error
// instances, so pull `message` off anything that carries one before falling back
// to String() — otherwise the user just sees "[object Object]".
function friendly(e: unknown): string {
  const msg =
    typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string"
      ? (e as { message: string }).message
      : String(e);
  if (/bucket not found/i.test(msg)) {
    return "Storage isn't set up yet — Paint Group needs to run the latest database migration.";
  }
  if (/pgp_sym_encrypt|pgp_sym_decrypt/i.test(msg)) {
    return "Bank details can't be saved yet — Paint Group needs to run the latest database migration.";
  }
  if (/row-level security/i.test(msg)) {
    return "You don't have permission to change that.";
  }
  return msg;
}

export default function ProfileForm({
  contractor,
  docs,
  name,
  email,
}: {
  contractor: ContractorRow;
  docs: ContractorDoc[];
  name: string;
  email: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  // ---- company details -----------------------------------------------------
  const [company, setCompany] = useState({
    company_name: contractor.company_name ?? "",
    abn: contractor.abn ?? "",
    gst_registered: contractor.gst_registered,
    address: contractor.address ?? "",
    invoice_prefix: contractor.invoice_prefix ?? "",
    crew_size: contractor.crew_size ?? 1,
  });
  const [logoUrl, setLogoUrl] = useState(contractor.logo_url ?? "");
  const [companyBusy, setCompanyBusy] = useState(false);
  const [companyMsg, setCompanyMsg] = useState("");
  const [companyErr, setCompanyErr] = useState("");

  async function saveCompany() {
    setCompanyBusy(true);
    setCompanyMsg("");
    setCompanyErr("");
    try {
      const { error } = await supabase
        .from("contractors")
        .update({
          company_name: company.company_name.trim(),
          abn: company.abn.trim() || null,
          gst_registered: company.gst_registered,
          address: company.address.trim() || null,
          invoice_prefix: company.invoice_prefix.trim().toUpperCase() || null,
          crew_size: Math.max(1, Math.min(99, Number(company.crew_size) || 1)),
          logo_url: logoUrl || null,
        })
        .eq("id", contractor.id);
      if (error) throw error;
      setCompanyMsg("Saved.");
      router.refresh();
    } catch (e) {
      setCompanyErr(friendly(e));
    } finally {
      setCompanyBusy(false);
    }
  }

  const logoInput = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    setCompanyErr("");
    setCompanyMsg("");
    try {
      // Path must start with the contractor id — that's what the storage policy checks.
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${contractor.id}/logo.${ext}`;
      const { error } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
      // Cache-bust so a re-upload shows immediately.
      setLogoUrl(`${data.publicUrl}?v=${crypto.randomUUID().slice(0, 8)}`);
      setCompanyMsg("Logo uploaded — press Save company details to keep it.");
    } catch (e) {
      setCompanyErr(friendly(e));
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  }

  // ---- bank details --------------------------------------------------------
  const [bsb, setBsb] = useState(contractor.bank_bsb ?? "");
  const [account, setAccount] = useState("");
  const [bankBusy, setBankBusy] = useState(false);
  const [bankMsg, setBankMsg] = useState("");
  const [bankErr, setBankErr] = useState("");

  async function saveBank() {
    setBankBusy(true);
    setBankMsg("");
    setBankErr("");
    try {
      if (!bsb.trim() || !account.trim()) throw new Error("Enter both a BSB and an account number.");
      // The account number is encrypted in the database — it only ever travels
      // through this RPC, and only the last 4 digits are ever read back.
      const { error } = await supabase.rpc("contractor_set_bank", {
        p_bsb: bsb.trim(),
        p_account: account.trim(),
      });
      if (error) throw error;
      setAccount("");
      setBankMsg("Bank details saved securely.");
      router.refresh();
    } catch (e) {
      setBankErr(friendly(e));
    } finally {
      setBankBusy(false);
    }
  }

  // ---- compliance documents ------------------------------------------------
  const docInput = useRef<HTMLInputElement>(null);
  const [docKind, setDocKind] = useState<ContractorDoc["kind"]>("insurance");
  const [docExpiry, setDocExpiry] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docErr, setDocErr] = useState("");
  const [docMsg, setDocMsg] = useState("");

  async function uploadDoc(file: File) {
    setDocBusy(true);
    setDocErr("");
    setDocMsg("");
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${contractor.id}/${docKind}-${crypto.randomUUID().slice(0, 8)}-${safe}`;
      const { error: upErr } = await supabase.storage.from(DOCS_BUCKET).upload(path, file);
      if (upErr) throw upErr;

      // The database trigger sets status and recomputes `offerable` from this row.
      const { error: insErr } = await supabase.from("contractor_documents").insert({
        contractor_id: contractor.id,
        kind: docKind,
        name: file.name,
        file_url: path,
        expires_on: docExpiry || null,
      });
      if (insErr) throw insErr;

      setDocExpiry("");
      setDocMsg("Uploaded. Paint Group can see it straight away.");
      router.refresh();
    } catch (e) {
      setDocErr(friendly(e));
    } finally {
      setDocBusy(false);
      if (docInput.current) docInput.current.value = "";
    }
  }

  async function removeDoc(id: string) {
    setDocErr("");
    setDocMsg("");
    const { error } = await supabase.from("contractor_documents").delete().eq("id", id);
    if (error) setDocErr(friendly(error));
    else router.refresh();
  }

  // Private bucket — files are opened through a short-lived signed link.
  async function openDoc(path: string) {
    setDocErr("");
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 60);
    if (error || !data) setDocErr(friendly(error ?? new Error("Could not open that file.")));
    else window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const missing = missingProfileFields({
    ...contractor,
    company_name: company.company_name,
    abn: company.abn,
    address: company.address,
    bank_bsb: bsb,
  });

  return (
    <div className="wrap">
      <Link href="/portal" className="backlink">
        ← Home
      </Link>
      <h1>My profile</h1>
      <p className="slab">
        {name} · {email}
      </p>

      {/* ---- status ---------------------------------------------------- */}
      <div className={`card ${contractor.offerable ? "greenish" : "amberish"}`}>
        <span className={`chip ${contractor.offerable ? "grn" : "amb"}`}>
          {contractor.offerable ? "Ready for work" : "Not yet offerable"}
        </span>
        <div style={{ marginTop: 10, fontSize: "12.5px", color: "var(--muted)" }}>
          {contractor.offerable
            ? "Your compliance is current, so Paint Group can offer you jobs."
            : "A current public liability certificate has to be on file before Paint Group can offer you work. Upload it below."}
        </div>
        {missing.length > 0 && (
          <div style={{ marginTop: 8, fontSize: "12.5px", color: "var(--amber)" }}>
            Still to fill in: {missing.join(", ")}.
          </div>
        )}
      </div>

      {/* ---- company details ------------------------------------------- */}
      <div className="card">
        <h3>Company details</h3>
        <p className="hint">These appear on the tax invoices you send Paint Group.</p>

        {companyErr && <div className="err" style={{ marginTop: 12 }}>{companyErr}</div>}
        {companyMsg && <div className="ok" style={{ marginTop: 12 }}>{companyMsg}</div>}

        <label className="fl" htmlFor="company_name">Trading name</label>
        <input
          id="company_name"
          type="text"
          value={company.company_name}
          onChange={(e) => setCompany({ ...company, company_name: e.target.value })}
          placeholder="e.g. Kovac Painting Pty Ltd"
        />

        <label className="fl" htmlFor="abn">ABN</label>
        <input
          id="abn"
          type="text"
          value={company.abn}
          onChange={(e) => setCompany({ ...company, abn: e.target.value })}
          placeholder="00 000 000 000"
          inputMode="numeric"
        />

        <label className="fl" htmlFor="address">Business address</label>
        <input
          id="address"
          type="text"
          value={company.address}
          onChange={(e) => setCompany({ ...company, address: e.target.value })}
          placeholder="Street, suburb, state, postcode"
        />

        <label className="fl" htmlFor="crew_size">Painters on your crew</label>
        <div className="crewrow">
          <button
            type="button"
            onClick={() => setCompany({ ...company, crew_size: Math.max(1, Number(company.crew_size) - 1) })}
            aria-label="One fewer painter"
          >
            −
          </button>
          <input
            id="crew_size"
            type="number"
            min={1}
            max={99}
            value={company.crew_size}
            onChange={(e) => setCompany({ ...company, crew_size: Number(e.target.value) })}
            inputMode="numeric"
          />
          <button
            type="button"
            onClick={() => setCompany({ ...company, crew_size: Math.min(99, Number(company.crew_size) + 1) })}
            aria-label="One more painter"
          >
            +
          </button>
        </div>
        <p className="hint">
          Including yourself. Paint Group use this to see how much you can take on
          at once — it doesn&rsquo;t stop you accepting jobs that overlap.
        </p>

        <label className="fl" htmlFor="invoice_prefix">Invoice prefix</label>
        <input
          id="invoice_prefix"
          type="text"
          value={company.invoice_prefix}
          onChange={(e) => setCompany({ ...company, invoice_prefix: e.target.value })}
          placeholder="e.g. KOV"
          maxLength={8}
        />
        <p className="hint">
          Your invoices will be numbered {(company.invoice_prefix.trim().toUpperCase() || "INV")}-
          {String(contractor.invoice_next_number).padStart(4, "0")} onwards.
        </p>

        <div className="checkrow">
          <input
            id="gst"
            type="checkbox"
            checked={company.gst_registered}
            onChange={(e) => setCompany({ ...company, gst_registered: e.target.checked })}
          />
          <label htmlFor="gst">I&rsquo;m registered for GST</label>
        </div>

        <label className="fl">Logo</label>
        <div className="logobox">
          <div className="logoprev">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Your logo" />
            ) : (
              <span>NONE</span>
            )}
          </div>
          <div>
            <button
              type="button"
              className="btn gh narrow"
              style={{ marginTop: 0 }}
              disabled={logoBusy}
              onClick={() => logoInput.current?.click()}
            >
              {logoBusy ? "Uploading…" : logoUrl ? "Replace logo" : "Upload logo"}
            </button>
            <input
              ref={logoInput}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo(f);
              }}
            />
          </div>
        </div>

        <button type="button" className="btn cy" disabled={companyBusy} onClick={saveCompany}>
          {companyBusy ? "Saving…" : "Save company details"}
        </button>
      </div>

      {/* ---- bank details ----------------------------------------------- */}
      <div className="card">
        <h3>Where you get paid</h3>
        <p className="hint">
          Your account number is encrypted in the database. Paint Group only ever
          sees the last four digits.
        </p>

        {bankErr && <div className="err" style={{ marginTop: 12 }}>{bankErr}</div>}
        {bankMsg && <div className="ok" style={{ marginTop: 12 }}>{bankMsg}</div>}

        {contractor.bank_account_last4 && (
          <div className="frow" style={{ marginTop: 10 }}>
            <span className="l">On file</span>
            <span className="v green">
              {contractor.bank_bsb} · ···· {contractor.bank_account_last4}
            </span>
          </div>
        )}

        <label className="fl" htmlFor="bsb">BSB</label>
        <input
          id="bsb"
          type="text"
          value={bsb}
          onChange={(e) => setBsb(e.target.value)}
          placeholder="000-000"
          inputMode="numeric"
        />

        <label className="fl" htmlFor="account">Account number</label>
        <input
          id="account"
          type="text"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder={contractor.bank_account_last4 ? "Enter again to change" : "Account number"}
          inputMode="numeric"
          autoComplete="off"
        />

        <button type="button" className="btn cy" disabled={bankBusy} onClick={saveBank}>
          {bankBusy ? "Saving…" : contractor.bank_account_last4 ? "Update bank details" : "Save bank details"}
        </button>
      </div>

      {/* ---- compliance -------------------------------------------------- */}
      <div className="card">
        <h3>Insurance &amp; licences</h3>
        <p className="hint">
          A current public liability certificate is what unlocks job offers. Upload it
          with its expiry date — Paint Group check it, and once they&rsquo;ve confirmed
          it you&rsquo;re available for work. The portal warns you before it lapses.
        </p>

        {docErr && <div className="err" style={{ marginTop: 12 }}>{docErr}</div>}
        {docMsg && <div className="ok" style={{ marginTop: 12 }}>{docMsg}</div>}

        {docs.length === 0 ? (
          <div style={{ fontSize: "12.5px", color: "var(--muted)", margin: "12px 0" }}>
            Nothing uploaded yet.
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            {docs.map((d) => {
              const days = daysUntil(d.expires_on);
              const state = docState(d);
              // "Pending" covers two different situations for the contractor —
              // nothing uploaded, versus uploaded and waiting on Paint Group.
              const chip =
                state === "valid"
                  ? days !== null && days <= 45
                    ? { cls: "amb", text: `${days}d left` }
                    : { cls: "grn", text: "Valid" }
                  : state === "expired"
                    ? { cls: "cly", text: "Expired" }
                    : d.file_url && !d.verified_at
                      ? { cls: "amb", text: "Being checked" }
                      : { cls: "gry", text: "Pending" };
              return (
                <div key={d.id} className="doc">
                  <div className="dn">
                    <b>{DOC_LABEL[d.kind]}</b>
                    <small>
                      {d.name}
                      {d.expires_on ? ` · EXPIRES ${d.expires_on}` : " · NO EXPIRY"}
                    </small>
                  </div>
                  <span className={`chip ${chip.cls}`}>{chip.text}</span>
                  <button
                    type="button"
                    onClick={() => openDoc(d.file_url)}
                    style={{ background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", fontSize: "11.5px" }}
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => removeDoc(d.id)}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "11.5px" }}
                    aria-label={`Remove ${DOC_LABEL[d.kind]}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <label className="fl" htmlFor="dockind">Document type</label>
        <select
          id="dockind"
          value={docKind}
          onChange={(e) => setDocKind(e.target.value as ContractorDoc["kind"])}
        >
          <option value="insurance">Public liability insurance</option>
          <option value="licence">Painting licence</option>
          <option value="other">Other</option>
        </select>

        <label className="fl" htmlFor="docexp">Expires on</label>
        <input id="docexp" type="date" value={docExpiry} onChange={(e) => setDocExpiry(e.target.value)} />

        <button
          type="button"
          className="btn cy"
          disabled={docBusy}
          onClick={() => docInput.current?.click()}
        >
          {docBusy ? "Uploading…" : "Choose file and upload"}
        </button>
        <input
          ref={docInput}
          type="file"
          accept="application/pdf,image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadDoc(f);
          }}
        />
      </div>

      <form action={signout}>
        <button className="signout">Sign out</button>
      </form>
    </div>
  );
}
