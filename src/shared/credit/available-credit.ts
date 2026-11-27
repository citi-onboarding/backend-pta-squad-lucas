export type CreditReceivableStatus = "PAID" | "OPEN" | "OVERDUE";

export interface CreditReceivable {
  amountCents: number;
  status: CreditReceivableStatus;
}

function assertWholeCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer number of cents.`);
  }
}

// RN-01: credit limit minus the receivables that are not paid (open and overdue).
// Works on integer cents only (RN-13). The result is not clamped: it is negative
// when unpaid receivables exceed the limit. It uses only the receivables it is
// given, and never the customer's status.
export function getAvailableCreditCents(
  creditLimitCents: number,
  receivables: readonly CreditReceivable[],
): number {
  assertWholeCents(creditLimitCents, "Credit limit");
  let unpaidCents = 0;
  for (const receivable of receivables) {
    assertWholeCents(receivable.amountCents, "Receivable amount");
    if (receivable.status !== "PAID") {
      unpaidCents += receivable.amountCents;
    }
  }
  return creditLimitCents - unpaidCents;
}
