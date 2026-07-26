import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY, COINGECKO_COIN_IDS } from "../src/domain/constants.js";
import { CoinGeckoIconProvider } from "../src/server/adapters/coingecko.js";

describe("CoinGeckoIconProvider", () => {
  it("combines local Forge stock icons with CoinGecko crypto icons and caches the result", async () => {
    const fetcher = async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("ids")).toContain("yoink-4");
      expect(url.searchParams.get("ids")).toContain("steel-2");
      expect(url.searchParams.get("ids")).toContain("apple-robinhood-tokenized-stock");
      expect(url.searchParams.get("per_page")).toBe("250");
      return new Response(JSON.stringify([
        {
          id: "robinhood-wrapped-eth-robinhood-chain",
          image: "https://coin-images.coingecko.com/weth.png"
        },
        {
          id: "yoink-4",
          image: "https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png?1783361029"
        }
      ]));
    };
    const provider = new CoinGeckoIconProvider("test-key", fetcher as typeof fetch);

    const icons = await provider.getIcons();
    expect(icons).toMatchObject({
      CBRS: "/assets/forge/cbrs.webp",
      CRCL: "/assets/forge/crcl.webp",
      CRWV: "/assets/forge/crwv.webp",
      RDDT: "/assets/forge/rddt.webp",
      SPCX: "/assets/forge/spcx.webp",
      WETH: "https://coin-images.coingecko.com/weth.png",
      YOINK: "https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png?1783361029"
    });
    await expect(provider.getIcons()).resolves.toEqual(icons);
  });

  it("maps every CoinGecko-listed registry asset and documents the five unavailable symbols", () => {
    expect(
      Object.keys(ASSET_REGISTRY).filter((symbol) => !COINGECKO_COIN_IDS[symbol])
    ).toEqual(["ARM", "DRAM", "NASA", "NOK", "RVI"]);
    expect(COINGECKO_COIN_IDS).toMatchObject({
      ETH: "ethereum",
      USDG: "global-dollar",
      WETH: "robinhood-wrapped-eth-robinhood-chain",
      STEEL: "steel-2",
      YOINK: "yoink-4"
    });
  });

  it("uses CoinGecko anonymously when no API key is configured", async () => {
    const provider = new CoinGeckoIconProvider(undefined, (async (_input, init) => {
      expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify([
        {
          id: "yoink-4",
          image: "https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png"
        }
      ]));
    }) as typeof fetch);

    await expect(provider.getIcons()).resolves.toMatchObject({
      CBRS: "/assets/forge/cbrs.webp",
      SPCX: "/assets/forge/spcx.webp",
      YOINK: "https://assets.coingecko.com/coins/images/102174349/small/yoink_400x400.png"
    });
  });
});
