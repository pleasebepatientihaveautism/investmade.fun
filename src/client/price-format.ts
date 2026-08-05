const standardUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

const smallUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 2
});

export function formatUsdPrice(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0 || Math.abs(value) >= 0.01) return standardUsdFormatter.format(value);
  return smallUsdFormatter.format(value);
}
