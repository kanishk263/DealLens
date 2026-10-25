import { describe, expect, it } from "vitest";
import { canTransition, nextStates, PROTECTED_TARGETS, TRANSITIONS } from "@/lib/submissions/workflow";

describe("submission state machine", () => {
  it("lets company users submit a draft but not publish", () => {
    expect(canTransition("draft", "uploaded", "company_user")).toBe(true);
    expect(canTransition("reviewed", "published", "company_user")).toBe(false);
  });
  it("reserves processing outcomes for the system", () => {
    expect(nextStates("processing", "system").sort()).toEqual(["awaiting_review", "processing_failed"]);
    expect(canTransition("processing", "awaiting_review", "finance_analyst")).toBe(false);
  });
  it("requires review before publication", () => {
    expect(canTransition("in_analysis", "published", "finance_reviewer")).toBe(false);
    expect(canTransition("under_review", "published", "finance_reviewer")).toBe(false);
    expect(canTransition("reviewed", "published", "finance_reviewer")).toBe(true);
  });
  it("only reviewers approve", () => {
    expect(canTransition("under_review", "reviewed", "finance_analyst")).toBe(false);
    expect(canTransition("under_review", "reviewed", "finance_reviewer")).toBe(true);
  });
  it("protects publication-related targets from generic transitions", () => {
    for (const t of ["published", "reviewed", "under_review"] as const) expect(PROTECTED_TARGETS.has(t)).toBe(true);
  });
  it("has no duplicate transitions", () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}>${t.actor}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
