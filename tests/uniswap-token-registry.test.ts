import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY } from "../src/domain/constants.js";
import { UNISWAP_ROBINHOOD_TOKENS } from "../src/domain/uniswap-robinhood-tokens.js";

describe("Uniswap Robinhood Chain registry", () => {
  it("admits every verified Robinhood Chain token plus the WETH route", () => {
    expect(UNISWAP_ROBINHOOD_TOKENS).toHaveLength(100);
    expect(Object.keys(ASSET_REGISTRY)).toHaveLength(101);
    expect(ASSET_REGISTRY.AAPL?.address).toBe("0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9");
    expect(ASSET_REGISTRY.WETH?.kind).toBe("CRYPTO");
  });
});
