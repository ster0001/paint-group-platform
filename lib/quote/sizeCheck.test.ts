import { describe, expect, it } from "vitest";
import { checkRoomSize, checkSideSize, isSmallRoom, parseMetres } from "./sizeCheck";

const typical = { widthM: 3.2, lengthM: 3.6, heightM: 2.7 };

describe("C3 — a typed room size is checked, never clamped (D8 defaults)", () => {
  it("letters or a blank-with-garbage are refused with a message", () => {
    expect(checkRoomSize({ w: "abc", l: "", h: "" }, typical, "Bedroom 1")).toEqual({ kind: "invalid", message: "Numbers only, in metres — like 3.5." });
    expect(checkRoomSize({ w: "3,5", l: "", h: "" }, typical, "Lounge").kind).toBe("invalid");
    expect(checkRoomSize({ w: "0", l: "", h: "" }, typical, "Lounge").kind).toBe("invalid");
    expect(checkRoomSize({ w: "-2", l: "", h: "" }, typical, "Lounge").kind).toBe("invalid");
  });
  it("blank fields keep the typical; a plain number saves as typed", () => {
    expect(checkRoomSize({ w: "", l: "4", h: "" }, typical, "Lounge")).toEqual({ kind: "ok", dims: { widthM: 3.2, lengthM: 4, heightM: null } });
    expect(parseMetres(" 3.5 ")).toBe(3.5);
    expect(parseMetres("")).toBeNull();
  });
  it("over 10 m in any room asks first; the number is kept as typed", () => {
    const c = checkRoomSize({ w: "35", l: "", h: "" }, typical, "Lounge");
    expect(c.kind).toBe("confirm");
    if (c.kind === "confirm") { expect(c.message).toBe("That's larger than most rooms — is it right?"); expect(c.dims.widthM).toBe(35); }
    expect(checkRoomSize({ w: "10", l: "", h: "" }, typical, "Lounge").kind).toBe("ok");
  });
  it("over 6 m in a bedroom, bathroom, laundry or WC asks", () => {
    for (const name of ["Bedroom 2", "Main bathroom", "Ensuite", "Laundry", "WC", "Toilet", "Powder room"]) {
      expect(isSmallRoom(name), name).toBe(true);
      expect(checkRoomSize({ w: "", l: "7", h: "" }, typical, name).kind, name).toBe("confirm");
      expect(checkRoomSize({ w: "", l: "6", h: "" }, typical, name).kind, name).toBe("ok");
    }
    for (const name of ["Lounge", "Kitchen", "Hallway", "Garage"]) expect(isSmallRoom(name), name).toBe(false);
  });
  it("under 1 m asks too", () => {
    expect(checkRoomSize({ w: "0.6", l: "", h: "" }, typical, "Lounge")).toMatchObject({ kind: "confirm", message: "That's smaller than most rooms — is it right?" });
  });
  it("a ceiling outside the server's 2–6 m is refused; a high one asks", () => {
    expect(checkRoomSize({ w: "", l: "", h: "1.5" }, typical, "Lounge").kind).toBe("invalid");
    expect(checkRoomSize({ w: "", l: "", h: "7" }, typical, "Lounge").kind).toBe("invalid");
    expect(checkRoomSize({ w: "", l: "", h: "4.5" }, typical, "Lounge")).toMatchObject({ kind: "confirm", dims: { heightM: 4.5 } });
    expect(checkRoomSize({ w: "", l: "", h: "3" }, typical, "Lounge")).toEqual({ kind: "ok", dims: { widthM: 3.2, lengthM: 3.6, heightM: 3 } });
  });
});

describe("C3 — a typed side size is checked against the model's bounds, never clamped", () => {
  const t = { w: 11, h: 2.7 };
  it("letters are refused; blanks keep the typical", () => {
    expect(checkSideSize({ w: "abc", h: "" }, t).kind).toBe("invalid");
    expect(checkSideSize({ w: "", h: "3" }, t)).toEqual({ kind: "ok", dims: { w: 11, h: 3 } });
  });
  it("outside 1–60 across or 1–12 high is refused with the bounds in the message", () => {
    expect(checkSideSize({ w: "75", h: "" }, t)).toMatchObject({ kind: "invalid", message: /1–60 m across/ });
    expect(checkSideSize({ w: "", h: "14" }, t).kind).toBe("invalid");
    expect(checkSideSize({ w: "0.5", h: "" }, t).kind).toBe("invalid");
    expect(checkSideSize({ w: "12", h: "3" }, t)).toEqual({ kind: "ok", dims: { w: 12, h: 3 } });
  });
});
