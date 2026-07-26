import { COINGECKO_COIN_IDS, FORGE_STOCK_ICONS } from "../../domain/constants.js";

const COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets";
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;

export interface AssetIconProvider {
  getIcons(): Promise<Record<string, string>>;
}

export class CoinGeckoIconProvider implements AssetIconProvider {
  private cached: Record<string, string> = { ...FORGE_STOCK_ICONS };
  private expiresAt = 0;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async getIcons(): Promise<Record<string, string>> {
    if (!this.apiKey) return { ...FORGE_STOCK_ICONS };
    if (Date.now() < this.expiresAt) return this.cached;

    const ids = [...new Set(Object.values(COINGECKO_COIN_IDS))];
    const response = await this.fetcher(
      `${COINGECKO_MARKETS_URL}?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}`,
      {
        headers: { "x-cg-demo-api-key": this.apiKey },
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!response.ok) throw new Error(`COINGECKO_ICONS_${response.status}`);

    const rows = (await response.json()) as Array<{ id?: string; image?: string }>;
    const iconById = new Map(
      rows.flatMap((row) => (row.id && row.image ? [[row.id, row.image] as const] : []))
    );
    this.cached = {
      ...FORGE_STOCK_ICONS,
      ...Object.fromEntries(
        Object.entries(COINGECKO_COIN_IDS).flatMap(([symbol, id]) => {
          const image = iconById.get(id);
          return image ? [[symbol, image]] : [];
        })
      )
    };
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.cached;
  }
}
