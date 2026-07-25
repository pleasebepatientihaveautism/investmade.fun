import { describe, expect, it } from "vitest";
import { CoinGeckoIconProvider } from "../src/server/adapters/coingecko.js";

describe("CoinGeckoIconProvider", () => {
  it("maps CoinGecko images to the supported crypto symbols and caches the result", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify([{ id: "weth", image: "https://coin-images.coingecko.com/weth.png" }]));
    const provider = new CoinGeckoIconProvider("test-key", fetcher as typeof fetch);

    await expect(provider.getIcons()).resolves.toEqual({
      WETH: "https://coin-images.coingecko.com/weth.png"
    });
    await expect(provider.getIcons()).resolves.toEqual({
      WETH: "https://coin-images.coingecko.com/weth.png"
    });
  });

  it("does not make a request when no server-side API key is configured", async () => {
    const provider = new CoinGeckoIconProvider(undefined, (() => {
      throw new Error("fetch should not run");
    }) as typeof fetch);

    await expect(provider.getIcons()).resolves.toEqual({});
  });
});
