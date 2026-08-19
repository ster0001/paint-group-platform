import { describe, expect, it } from "vitest";
import { incomingPrefix, isOwnIncomingPath, makeIncomingPath } from "./incoming";

const me = "11111111-1111-1111-1111-111111111111";
const them = "22222222-2222-2222-2222-222222222222";

describe("isOwnIncomingPath", () => {
  it("accepts a path this module itself generated", () => {
    const p = makeIncomingPath(me, 0, "1755500000000-abcd1234");
    expect(isOwnIncomingPath(p, me)).toBe(true);
  });

  it("refuses another user's staging prefix", () => {
    const p = makeIncomingPath(them, 0, "1755500000000-abcd1234");
    expect(isOwnIncomingPath(p, me)).toBe(false);
  });

  it("refuses traversal and absolute or nested tricks", () => {
    for (const p of [
      `incoming/${me}/../${them}/file`,
      `incoming/${me}/..`,
      `/incoming/${me}/file`,
      `incoming/${me}//file`,
      `incoming/${me}/a/b`,
      `incoming/${me}/a\\b`,
      `estimates/123/original.pdf`,
      "",
    ]) {
      expect(isOwnIncomingPath(p, me)).toBe(false);
    }
  });

  it("refuses hostile segment characters", () => {
    expect(isOwnIncomingPath(`${incomingPrefix(me)}ok_name-1.bin`, me)).toBe(true);
    expect(isOwnIncomingPath(`${incomingPrefix(me)}bad name`, me)).toBe(false);
    expect(isOwnIncomingPath(`${incomingPrefix(me)}bad%2Fname`, me)).toBe(false);
  });
});
