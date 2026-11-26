const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError("Amount in cents must be a safe integer.");
  }
  return brlFormatter.format(cents / 100);
}
