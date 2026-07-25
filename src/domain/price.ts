import { USDG_DECIMALS } from "./constants.js";

/**
 * Derives the USD value of one output-token unit from an exact USDG input quote.
 * USDG has a fixed 6-decimal representation, so this avoids an additional price
 * oracle while keeping the displayed price tied to the executable quote.
 */
export function unitPriceUsdFromQuote(
  amountInBaseUnits: string,
  amountOutBaseUnits: string,
  outputDecimals: number
): string {
  const amountOut = BigInt(amountOutBaseUnits);
  if (amountOut <= 0n) throw new Error("QUOTE_PRICE_UNAVAILABLE");

  const outputScale = 10n ** BigInt(outputDecimals);
  const usdScale = 10n ** BigInt(USDG_DECIMALS);
  const priceBaseUnits = (BigInt(amountInBaseUnits) * outputScale) / amountOut;
  const whole = priceBaseUnits / usdScale;
  const fractional = (priceBaseUnits % usdScale)
    .toString()
    .padStart(USDG_DECIMALS, "0")
    .replace(/0+$/, "");

  return fractional ? `${whole}.${fractional}` : whole.toString();
}
