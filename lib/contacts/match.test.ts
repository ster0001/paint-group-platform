import { describe, expect, it } from "vitest";
import { matchContacts } from "./match";

const list = [
  { id: "a", first_name: "Zelda", last_name: "Fitzgerald", company: "", email: "zelda@example.com", phone: "0400 111 222", city: "Brunswick" },
  { id: "b", first_name: "Harcourts", last_name: "", company: "Harcourts Northcote", email: "sales@harcourts.example", phone: "03 9481 0000", city: "Northcote" },
  { id: "c", first_name: "Ford", last_name: "Prefect", company: "", email: "ford@example.com", phone: "0400 333 444", landline: "03 9555 1234", city: "Fitzroy" },
];

describe("matchContacts", () => {
  it("is empty for a blank query", () => {
    expect(matchContacts(list, "")).toEqual([]);
    expect(matchContacts(list, "   ")).toEqual([]);
  });
  it("matches name, company, email and suburb, case-insensitively", () => {
    expect(matchContacts(list, "zel").map((c) => c.id)).toEqual(["a"]);
    expect(matchContacts(list, "NORTHCOTE").map((c) => c.id)).toEqual(["b"]);
    expect(matchContacts(list, "ford@").map((c) => c.id)).toEqual(["c"]);
    expect(matchContacts(list, "fitz").map((c) => c.id)).toEqual(["a", "c"]); // Fitzgerald + Fitzroy
  });
  it("matches a phone with or without its spaces, and the landline too", () => {
    expect(matchContacts(list, "0400111").map((c) => c.id)).toEqual(["a"]);
    expect(matchContacts(list, "0400 111 2").map((c) => c.id)).toEqual(["a"]);
    expect(matchContacts(list, "9555 1234").map((c) => c.id)).toEqual(["c"]);
  });
  it("never treats one or two digits as a phone search", () => {
    expect(matchContacts(list, "04")).toEqual([]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), first_name: "Sam", last_name: `Same${i}` }));
    expect(matchContacts(many, "sam")).toHaveLength(8);
    expect(matchContacts(many, "sam", 3)).toHaveLength(3);
  });
});
