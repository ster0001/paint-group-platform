import { describe, it, expect } from "vitest";
import { rankShowcaseJobs } from "./rank";

const job = (id: string, property_type: "home" | "business", over: Partial<{ featured_rank: number | null; featured_rank_business: number | null; completed_on: string; published: boolean }> = {}) =>
  ({ id, property_type, featured_rank: null, featured_rank_business: null, completed_on: "2026-06-01", published: true, ...over });

describe("homepage card ranking per audience (session 8 §4, ⚑ D4)", () => {
  const homes = [job("h1", "home", { featured_rank: 1 }), job("h2", "home", { featured_rank: 2 }), job("h3", "home", { featured_rank: 3 }), job("h4", "home")];
  it("home: ranked home jobs only, in rank order", () => {
    expect(rankShowcaseJobs([...homes, job("b1", "business", { featured_rank_business: 1 })], "home").map((j) => j.id)).toEqual(["h1", "h2", "h3"]);
  });
  it("0 business jobs: the business site falls back to the home cards", () => {
    expect(rankShowcaseJobs(homes, "business").map((j) => j.id)).toEqual(["h1", "h2", "h3"]);
  });
  it("2 business jobs: both, then one home card", () => {
    const jobs = [...homes, job("b1", "business", { featured_rank_business: 2 }), job("b2", "business", { completed_on: "2026-07-01" })];
    expect(rankShowcaseJobs(jobs, "business").map((j) => j.id)).toEqual(["b1", "b2", "h1"]);
  });
  it("3 business jobs: never a home card", () => {
    const jobs = [...homes, job("b1", "business"), job("b2", "business", { completed_on: "2026-08-01" }), job("b3", "business", { featured_rank_business: 1 })];
    expect(rankShowcaseJobs(jobs, "business").map((j) => j.id)).toEqual(["b3", "b2", "b1"]);
  });
  it("5 business jobs: ranks first, then newest; drafts never count", () => {
    const jobs = [...homes,
      job("b1", "business", { completed_on: "2026-01-01" }), job("b2", "business", { completed_on: "2026-09-01" }),
      job("b3", "business", { featured_rank_business: 2 }), job("b4", "business", { featured_rank_business: 1 }),
      job("b5", "business", { completed_on: "2026-12-01", published: false })];
    expect(rankShowcaseJobs(jobs, "business").map((j) => j.id)).toEqual(["b4", "b3", "b2"]);
  });
});
