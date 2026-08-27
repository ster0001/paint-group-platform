"use client";

import { useState } from "react";
import AddressField from "@/app/wizard/AddressField";
import { addAddressAction } from "../actions";

/** One screen (§3): the address, and whether it leads. The SHARED
 * AddressField does the Places lookup — picked fields land in the inputs
 * below, still editable; plain typing works without a pick. */
export default function AddAddressForm({ hasExisting }: { hasExisting: boolean }) {
  const [text, setText] = useState("");
  const [fields, setFields] = useState({ street: "", suburb: "", state: "", postcode: "" });
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form action={addAddressAction}>
      <label>Look the address up</label>
      <AddressField
        value={text}
        placeholder="Start typing the address…"
        onText={(t) => { setText(t); setFields((f) => ({ ...f, street: t })); }}
        onPick={(a) => {
          setText(a.formatted);
          setFields({ street: a.street, suburb: a.suburb, state: a.state, postcode: a.postcode });
        }}
      />

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="aa-street">Street address</label>
          <input id="aa-street" className="field" name="street" required value={fields.street} onChange={set("street")} />
        </div>
        <div>
          <label htmlFor="aa-suburb">Suburb</label>
          <input id="aa-suburb" className="field" name="suburb" value={fields.suburb} onChange={set("suburb")} />
        </div>
        <div>
          <label htmlFor="aa-postcode">Postcode</label>
          <input id="aa-postcode" className="field" name="postcode" inputMode="numeric" value={fields.postcode} onChange={set("postcode")} />
        </div>
      </div>
      <input type="hidden" name="state" value={fields.state} />

      {hasExisting && (
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "16px 0 0", fontSize: 16, color: "var(--text)" }}>
          <input type="checkbox" name="makePrimary" style={{ marginTop: 5 }} />
          <span>
            This replaces my old address as my main one
            <span className="note" style={{ display: "block", marginTop: 3 }}>
              Either way, everything from your other addresses stays in your account for good.
            </span>
          </span>
        </label>
      )}

      <div style={{ marginTop: 18 }}>
        <button className="btn btn-cyan" type="submit">Add this address</button>
      </div>
    </form>
  );
}
