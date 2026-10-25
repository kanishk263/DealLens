import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS } from "@/lib/financial/taxonomy";

describe("category taxonomy", () => {
  it("matches the Python worker taxonomy exactly", () => {
    const src = readFileSync(path.resolve(__dirname, "../../processing/deallens_worker/normalization/taxonomy.py"), "utf8");
    const block = src.split("CATEGORIES =")[0];
    const keys = [...block.matchAll(/"([a-z_]+)":\s*"/g)].map((m) => m[1]);
    expect(new Set(Object.keys(CATEGORY_LABELS))).toEqual(new Set(keys));
  });
});
