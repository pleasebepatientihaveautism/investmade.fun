import { createPublicClient, http } from "viem";
import {
  ASSET_REGISTRY,
  DEFAULT_SLOT_BUDGET,
  FEED_PAGE_SIZE,
  isDegenCommunityAsset
} from "../../domain/constants.js";
import type { Candidate } from "../../domain/schemas.js";
import type { AppConfig } from "../config.js";
import type { CandidateDiscoveryOptions, CandidateProvider } from "./types.js";
import { UniswapProvider } from "./uniswap.js";

interface RobinhoodAsset {
  tokenSymbol: string;
  status: string;
  deployments: Array<{ chainId: number; contractAddress: string }>;
}

interface RobinhoodPrice {
  tokenSymbol: string;
  isTradingHalt: boolean;
  generatedAt: string;
}

const oraclePausedAbi = [
  {
    type: "function",
    name: "oraclePaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }]
  }
] as const;

const FEED_CONCURRENCY = 2;
const REGISTRY_CACHE_MS = 5 * 60_000;
const CONTRACT_CODE_CACHE_MS = 10 * 60_000;
const STOCK_ELIGIBILITY_CACHE_MS = 30_000;
const PERMISSION_CACHE_MS = 60_000;

export class LiveCandidateProvider implements CandidateProvider {
  private readonly uniswap: UniswapProvider;
  private readonly client;
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: AppConfig,
    private readonly options: { cryptoOnly?: boolean } = {}
  ) {
    if (!config.UNISWAP_API_KEY) throw new Error("UNISWAP_API_KEY_REQUIRED");
    this.uniswap = new UniswapProvider(config.UNISWAP_API_KEY);
    this.client = createPublicClient({ transport: http(config.ROBINHOOD_RPC_URL) });
  }

  async getCandidates(
    wallet: string,
    amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
    now = new Date(),
    requestedLimit = FEED_PAGE_SIZE,
    excludedAssetIds: string[] = [],
    discoveryOptions: CandidateDiscoveryOptions = {}
  ): Promise<Candidate[]> {
    const excluded = new Set(excludedAssetIds);
    const assets = Object.values(ASSET_REGISTRY)
      .filter((asset) =>
        (!this.options.cryptoOnly || asset.kind === "CRYPTO") &&
        (discoveryOptions.includeCommunity || !isDegenCommunityAsset(asset.assetId)) &&
        !excluded.has(asset.assetId)
      )
      .sort((left, right) =>
        Number(isDegenCommunityAsset(right.assetId)) - Number(isDegenCommunityAsset(left.assetId))
      );
    const hasStocks = assets.some((asset) => asset.kind === "STOCK_TOKEN");
    const [registry, stockEligible] = hasStocks
      ? await Promise.all([this.assetRegistry(), this.stockEligible(wallet)])
      : [undefined, false] as const;
    const target = Math.max(1, Math.min(requestedLimit, assets.length));
    const limit = this.config.localLiveExecution ? assets.length : target * 2;
    const candidates: Candidate[] = [];

    // Keep Uniswap work below its documented rate limit while avoiding a
    // full serial waterfall. Preserve registry order for deterministic feeds.
    for (let index = 0; index < limit && candidates.length < target; index += FEED_CONCURRENCY) {
      const batch = await Promise.all(
        assets.slice(index, index + FEED_CONCURRENCY).map((asset) =>
          this.resolveCandidate(
            asset,
            wallet,
            amountInBaseUnits,
            now,
            registry,
            stockEligible,
            true
          )
        )
      );
      for (const candidate of batch) {
        if (candidate) candidates.push(candidate);
      }
    }
    return candidates.slice(0, target);
  }

  async getCandidatesForExecution(
    wallet: string,
    assetIds: string[],
    amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
    now = new Date()
  ): Promise<Candidate[]> {
    const requested = new Set(assetIds);
    const assets = Object.values(ASSET_REGISTRY)
      .filter((asset) => requested.has(asset.assetId));
    const hasStocks = assets.some((asset) => asset.kind === "STOCK_TOKEN");
    const [registry, stockEligible] = hasStocks
      ? await Promise.all([this.assetRegistry(), this.stockEligible(wallet)])
      : [undefined, false] as const;
    const candidates: Candidate[] = [];
    // ponytail: execution refreshes are rare; serial requests avoid provider 429s.
    for (const asset of assets) {
      const candidate = await this.resolveCandidate(
        asset,
        wallet,
        amountInBaseUnits,
        now,
        registry,
        stockEligible,
        false
      );
      if (candidate) candidates.push(candidate);
    }
    return candidates;
  }

  private async resolveCandidate(
    asset: (typeof ASSET_REGISTRY)[string],
    wallet: string,
    amountInBaseUnits: string,
    now: Date,
    registry: { assets?: RobinhoodAsset[] } | undefined,
    stockEligible: boolean,
    includeQuote: boolean
  ): Promise<Candidate | undefined> {
    try {
      const contractCode = await this.cached(
        `code:${asset.address.toLowerCase()}`,
        CONTRACT_CODE_CACHE_MS,
        () => this.client.getCode({ address: asset.address as `0x${string}` })
      );
      if (!contractCode || contractCode === "0x") return;

      let marketHealthy = true;
      let eligible = true;
      let permissionAllowed = true;
      if (asset.kind === "STOCK_TOKEN") {
        if (!stockEligible) return;
        const rhAsset = registry?.assets?.find((item) => item.tokenSymbol === asset.symbol);
        const deployment = rhAsset?.deployments.find(
          (item) => item.chainId === 4663 && item.contractAddress.toLowerCase() === asset.address.toLowerCase()
        );
        if (rhAsset?.status !== "ASSET_STATUS_ACTIVE" || !deployment) return;
        const [priceResponse, oraclePaused] = await Promise.all([
          fetch(`https://api.robinhood.com/rhj/prices/${asset.symbol}`, { signal: AbortSignal.timeout(8_000) }),
          this.client.readContract({ address: asset.address as `0x${string}`, abi: oraclePausedAbi, functionName: "oraclePaused" })
        ]);
        if (!priceResponse.ok) return;
        const priceBody = (await priceResponse.json()) as { quotes?: RobinhoodPrice[] };
        const price = priceBody.quotes?.find((item) => item.tokenSymbol === asset.symbol);
        const ageMs = price ? now.getTime() - new Date(price.generatedAt).getTime() : Infinity;
        // Robinhood's equity-price feed is not continuously updated outside
        // market hours. A local-live session is explicitly a developer/demo
        // environment, so keep an active, non-halted, on-chain stock token in
        // the local preview even when that timestamp is stale. Production
        // continues to require a fresh price before an asset can pass policy.
        const priceIsFresh = ageMs >= 0 && ageMs <= 60_000;
        marketHealthy = Boolean(
          price &&
            !price.isTradingHalt &&
            oraclePaused === false &&
            (this.config.localLiveExecution || priceIsFresh)
        );
        permissionAllowed = await this.cached(
          `permission:${wallet.toLowerCase()}:${asset.address.toLowerCase()}`,
          PERMISSION_CACHE_MS,
          () => this.uniswap.permissionAllowed(wallet, asset.address)
        );
        eligible = stockEligible;
      }

      const seed: Candidate = {
        ...asset,
        contract: asset.address,
        eligible,
        marketHealthy,
        permissionAllowed,
        quote: {
          requestId: "pending",
          assetId: asset.assetId,
          tokenOut: asset.address,
          amountInBaseUnits,
          estimatedAmountOut: "1",
          minimumAmountOut: "1",
          unitPriceUsd: "10000000",
          priceImpactBps: 0,
          routing: "CLASSIC",
          quotedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString()
        },
        crowdScoreBps: 0,
        reason: "Canonical Uniswap-listed asset with healthy state and a fresh executable route.",
        evidenceIds: [`uni:list:${asset.symbol}`, `rh:state:${asset.symbol}`]
      };
      if (!includeQuote) return seed;
      const quote = await this.uniswap.quote(wallet, seed, amountInBaseUnits, 50);
      return { ...seed, quote, evidenceIds: [...seed.evidenceIds, `uni:${quote.requestId}`] };
    } catch {
      return;
    }
  }

  private async assetRegistry(): Promise<{ assets?: RobinhoodAsset[] }> {
    return this.cached("robinhood:assets", REGISTRY_CACHE_MS, async () => {
      const assetsResponse = await fetch("https://api.robinhood.com/rhj/assets", {
        signal: AbortSignal.timeout(8_000)
      });
      if (!assetsResponse.ok) throw new Error(`ROBINHOOD_ASSETS_${assetsResponse.status}`);
      return (await assetsResponse.json()) as { assets?: RobinhoodAsset[] };
    });
  }

  private async stockEligible(wallet: string): Promise<boolean> {
    // Local-live uses Uniswap's per-token permission response together with
    // Robinhood's active-asset and oracle checks. Production can additionally
    // require the configured jurisdiction/eligibility service.
    return this.cached(`stock-eligible:${wallet.toLowerCase()}`, STOCK_ELIGIBILITY_CACHE_MS, async () => {
      if (!this.config.STOCK_ELIGIBILITY_PROVIDER_URL) return this.config.localLiveExecution;
      const response = await fetch(this.config.STOCK_ELIGIBILITY_PROVIDER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.STOCK_ELIGIBILITY_API_KEY ?? ""}`
        },
        body: JSON.stringify({ wallet, product: "ROBINHOOD_STOCK_TOKENS", chainId: 4663 }),
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return false;
      const result = (await response.json()) as { eligible?: boolean };
      return result.eligible === true;
    });
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const request = load()
      .then((value) => {
        this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }
}
