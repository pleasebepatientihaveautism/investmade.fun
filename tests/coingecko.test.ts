import { describe, expect, it } from "vitest";
import { CoinGeckoIconProvider } from "../src/server/adapters/coingecko.js";

describe("CoinGeckoIconProvider", () => {
  it("combines local Forge stock icons with CoinGecko crypto icons and caches the result", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify([{ id: "weth", image: "https://coin-images.coingecko.com/weth.png" }]));
    const provider = new CoinGeckoIconProvider("test-key", fetcher as typeof fetch);

    const icons = await provider.getIcons();
    expect(icons).toMatchObject({
      CBRS: "/assets/forge/cbrs.webp",
      CRCL: "/assets/forge/crcl.webp",
      CRWV: "/assets/forge/crwv.webp",
      RDDT: "/assets/forge/rddt.webp",
      SPCX: "/assets/forge/spcx.webp",
      WETH: "https://coin-images.coingecko.com/weth.png"
    });
    await expect(provider.getIcons()).resolves.toEqual(icons);
  });

  it("does not make a request when no server-side API key is configured", async () => {
    const provider = new CoinGeckoIconProvider(undefined, (() => {
      throw new Error("fetch should not run");
    }) as typeof fetch);

    await expect(provider.getIcons()).resolves.toMatchObject({
      CBRS: "/assets/forge/cbrs.webp",
      SPCX: "/assets/forge/spcx.webp"
    });
  });
});
