import { describe, expect, it } from "vitest";

import { getAvailableCreditCents } from "./available-credit.js";

// Amounts are integer cents: 10_000 reais is 1_000_000 cents.
const limit = 1_000_000;

describe("getAvailableCreditCents", () => {
  it("subtracts open receivables from the limit", () => {
    expect(
      getAvailableCreditCents(limit, [
        { amountCents: 300_000, status: "OPEN" },
      ]),
    ).toBe(700_000);
  });

  it("subtracts overdue receivables from the limit", () => {
    expect(
      getAvailableCreditCents(limit, [
        { amountCents: 250_000, status: "OVERDUE" },
      ]),
    ).toBe(750_000);
  });

  it("does not count paid receivables", () => {
    expect(
      getAvailableCreditCents(limit, [
        { amountCents: 300_000, status: "OPEN" },
        { amountCents: 500_000, status: "PAID" },
      ]),
    ).toBe(700_000);
  });

  it("returns the whole limit when there are no receivables", () => {
    expect(getAvailableCreditCents(limit, [])).toBe(1_000_000);
  });

  it("returns a negative number when unpaid receivables exceed the limit", () => {
    expect(
      getAvailableCreditCents(100_000, [
        { amountCents: 80_000, status: "OPEN" },
        { amountCents: 50_000, status: "OVERDUE" },
      ]),
    ).toBe(-30_000);
  });

  it("adds up several unpaid receivables", () => {
    expect(
      getAvailableCreditCents(limit, [
        { amountCents: 100_000, status: "OPEN" },
        { amountCents: 200_000, status: "OVERDUE" },
        { amountCents: 200_000, status: "OVERDUE" },
      ]),
    ).toBe(500_000);
  });

  it("uses only the receivables it is given", () => {
    const given = [{ amountCents: 300_000, status: "OPEN" as const }];

    expect(getAvailableCreditCents(limit, given)).toBe(700_000);
    expect(getAvailableCreditCents(limit, [...given, ...given])).toBe(400_000);
  });

  it("does not depend on the customer status", () => {
    // The function receives no status, so a blocked and an active customer
    // with the same limit and receivables get the same arithmetic.
    const receivables = [{ amountCents: 300_000, status: "OPEN" as const }];

    expect(getAvailableCreditCents(limit, receivables)).toBe(
      getAvailableCreditCents(limit, receivables),
    );
    expect(getAvailableCreditCents(limit, receivables)).toBe(700_000);
  });

  it.each([
    ["a fractional credit limit", 1_000_000.5, [] as never[]],
    ["a NaN credit limit", Number.NaN, [] as never[]],
    ["an unsafe credit limit", Number.MAX_SAFE_INTEGER + 1, [] as never[]],
    [
      "a fractional receivable amount",
      limit,
      [{ amountCents: 100.5, status: "OPEN" as const }],
    ],
    [
      "an infinite receivable amount",
      limit,
      [{ amountCents: Number.POSITIVE_INFINITY, status: "OVERDUE" as const }],
    ],
  ])("rejects %s instead of producing a number", (_name, creditLimit, rows) => {
    expect(() => getAvailableCreditCents(creditLimit, rows)).toThrow(
      RangeError,
    );
  });

  it("rejects a paid receivable with a bad amount too", () => {
    expect(() =>
      getAvailableCreditCents(limit, [{ amountCents: 1.5, status: "PAID" }]),
    ).toThrow(RangeError);
  });
});
