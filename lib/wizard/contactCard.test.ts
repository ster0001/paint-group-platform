import { test } from "vitest";
import assert from "node:assert/strict";
import { builderContactFrom } from "./contactCard";

test("the wizard's contact becomes the builder's Contact card: first/last name, lower-case email, address parts", () => {
  const c = builderContactFrom({
    name: "  Tom  Roman ", email: "Tom@Example.COM", phone: "0400 000 111",
    address: { street: "14 Murrumbeena Rd", suburb: "Murrumbeena", state: "VIC", postcode: "3163" },
  });
  assert.equal(c.first_name, "Tom");
  assert.equal(c.last_name, "Roman");
  assert.equal(c.email, "tom@example.com");
  assert.equal(c.phone, "0400 000 111");
  assert.equal(c.address, "14 Murrumbeena Rd");
  assert.equal(c.city, "Murrumbeena");
  assert.equal(c.postal, "3163");
});

test("a single name and no address still make a usable card", () => {
  const c = builderContactFrom({ name: "Cher", email: "c@example.com", phone: "" });
  assert.equal(c.first_name, "Cher");
  assert.equal(c.last_name, "");
  assert.equal(c.address, "");
  assert.equal(c.city, "");
});
