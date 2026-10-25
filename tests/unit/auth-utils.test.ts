import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/redirect";
import { homePathFor } from "@/lib/authorization/roles";
import { safeErrorMessage } from "@/lib/errors";

describe("safeNextPath", () => {
  it.each([
    ["/submissions/123", "/submissions/123"],
    ["/analyst?tab=queue", "/analyst?tab=queue"],
  ])("accepts relative path %s", (input, expected) => expect(safeNextPath(input)).toBe(expected));

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null, "/ok\r\nSet-Cookie: x"])(
    "rejects %s",
    (input) => expect(safeNextPath(input as string | null)).toBe("/dashboard"),
  );
});

describe("homePathFor", () => {
  it("routes by role precedence", () => {
    expect(homePathFor(["finance_analyst"])).toBe("/analyst");
    expect(homePathFor(["company_user"])).toBe("/dashboard");
    expect(homePathFor(["superadmin"])).toBe("/admin");
    expect(homePathFor([])).toBe("/access-request");
  });
});

describe("safeErrorMessage", () => {
  it("passes through messages authored by DealLens database functions", () => {
    expect(safeErrorMessage({ code: "42501", message: "Insufficient role" })).toBe("Insufficient role");
  });
  it("hides unexpected database errors", () => {
    expect(safeErrorMessage({ code: "XX000", message: "internal stack detail" })).toBe("Something went wrong. Please try again.");
  });
  it("maps unique violations to a friendly message", () => {
    expect(safeErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toMatch(/already/);
  });
});
