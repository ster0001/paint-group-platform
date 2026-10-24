import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAINT_HOME_LOGO } from "./paintHomeLogo";

/** The design files are the source; this module is their copy. Any drift fails here. */
const read = (name: string) => readFileSync(`design/reference/${name}`, "utf8");
const pathsOf = (svg: string) => Object.fromEntries([...svg.matchAll(/<path id="([a-z]+)" fill="(#[0-9a-f]+)" fill-rule="evenodd" d="([^"]+)"\/>/g)].map((m) => [m[1], { fill: m[2], d: m[3] }]));

describe("the Paint Home mark is the supplied SVG, verbatim", () => {
  const dark = pathsOf(read("paint-home-logo-dark.svg"));
  const light = pathsOf(read("paint-home-logo-light.svg"));
  it("both files carry the same four paths; only the text fill differs", () => {
    for (const k of ["brush", "paint", "home", "tagline"] as const) {
      expect(dark[k].d).toBe(PAINT_HOME_LOGO.paths[k]);
      expect(light[k].d).toBe(PAINT_HOME_LOGO.paths[k]);
    }
    expect(dark.brush.fill).toBe(PAINT_HOME_LOGO.brush);
    expect(dark.home.fill).toBe(PAINT_HOME_LOGO.home);
    expect(dark.paint.fill).toBe(PAINT_HOME_LOGO.text.dark);
    expect(light.paint.fill).toBe(PAINT_HOME_LOGO.text.light);
    expect(light.tagline.fill).toBe(PAINT_HOME_LOGO.text.light);
  });
  it("the canvas is 840 × 221; the nav keeps the whole canvas (the brush runs below the words) and drops only the tagline path", () => {
    expect(read("paint-home-logo-dark.svg")).toContain(`viewBox="${PAINT_HOME_LOGO.viewBoxFull}"`);
    expect(PAINT_HOME_LOGO.viewBoxNav).toBe(PAINT_HOME_LOGO.viewBoxFull);
    // the brush's lowest point is below the 132 line the brief named
    const ys = [...PAINT_HOME_LOGO.paths.brush.matchAll(/[ML]\s*[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeGreaterThan(132);
  });
});
