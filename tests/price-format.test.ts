import { describe, expect, it } from "vitest";
import { formatUsdPrice } from "../src/client/price-format.js";

describe("USD price formatting", () => {
  it("keeps standard prices at two decimal places", () => {
    expect(formatUsdPrice(37.43)).toBe("$37.43");
    expect(formatUsdPrice(0)).toBe("$0.00");
  });

  it("shows two significant digits for prices below one cent", () => {
    expect(formatUsdPrice(0.004732)).toBe("$0.0047");
    expect(formatUsdPrice(0.0000001)).toBe("$0.00000010");
  });
});
