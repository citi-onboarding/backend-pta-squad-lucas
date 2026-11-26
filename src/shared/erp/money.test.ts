import { describe, expect, it } from "vitest";

import { formatCents } from "./money.js";

// The pt-BR locale separates "R$" from the digits with a non-breaking space.
const nbsp = " ";

describe("formatCents", () => {
  it("formats 123456 cents as R$ 1.234,56", () => {
    expect(formatCents(123_456)).toBe(`R$${nbsp}1.234,56`);
  });

  it("formats zero and small amounts with two decimal places", () => {
    expect(formatCents(0)).toBe(`R$${nbsp}0,00`);
    expect(formatCents(5)).toBe(`R$${nbsp}0,05`);
  });

  it("formats a negative amount as negative", () => {
    expect(formatCents(-100)).toBe(`-R$${nbsp}1,00`);
  });

  it.each([
    ["a fractional value", 10.5],
    ["NaN", Number.NaN],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s", (_label, value) => {
    expect(() => formatCents(value)).toThrow();
  });
});
