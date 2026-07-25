import { createPublicClient, http } from "viem";
import { ASSET_REGISTRY, DEFAULT_SLOT_BUDGET, LOCAL_DEMO_CANDIDATE_LIMIT, MAX_CARDS } from "../../domain/constants.js";
import type { Candidate } from "../../domain/schemas.js";
import type { AppConfig } from "../config.js";
import type { CandidateProvider } from "./types.js";
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

export class LiveCandidateProvider implements CandidateProvider {
  private readonly uniswap: UniswapProvider;
  private readonly client;

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
    now = new Date()
  ): Promise<Candidate[]> {
    const registry = this.options.cryptoOnly
      ? undefined
      : await this.assetRegistry();
    const stockEligible = this.options.cryptoOnly ? false : await this.stockEligible(wallet);

    const assets = Object.values(ASSET_REGISTRY)
      .filter((asset) => !this.options.cryptoOnly || asset.kind === "CRYPTO");
    const limit = this.config.localLiveExecution ? assets.length : MAX_CARDS * 2;
    const candidates: Candidate[] = [];

    // Quotes are serial to respect the Uniswap Trading API's rate limit. We
    // stop once the feed has three genuinely executable assets.
    for (const asset of assets.slice(0, limit)) {
      const candidate = await this.resolveCandidate(
        asset,
        wallet,
        amountInBaseUnits,
        now,
        registry,
        stockEligible
      );
      if (candidate) candidates.push(candidate);
      if (candidates.length === (this.config.localLiveExecution ? LOCAL_DEMO_CANDIDATE_LIMIT : MAX_CARDS)) break;
    }
    return candidates;
  }

  private async resolveCandidate(
    asset: (typeof ASSET_REGISTRY)[string],
    wallet: string,
    amountInBaseUnits: string,
    now: Date,
    registry: { assets?: RobinhoodAsset[] } | undefined,
    stockEligible: boolean
  ): Promise<Candidate | undefined> {
    try {
      const contractCode = await this.client.getCode({ address: asset.address as `0x${string}` });
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
        // the three-card preview even when that timestamp is stale. Production
        // continues to require a fresh price before an asset can pass policy.
        const priceIsFresh = ageMs >= 0 && ageMs <= 60_000;
        marketHealthy = Boolean(
          price &&
            !price.isTradingHalt &&
            oraclePaused === false &&
            (this.config.localLiveExecution || priceIsFresh)
        );
        permissionAllowed = await this.uniswap.permissionAllowed(wallet, asset.address);
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
      const quote = await this.uniswap.quote(wallet, seed, amountInBaseUnits, 50);
      return { ...seed, quote, evidenceIds: [...seed.evidenceIds, `uni:${quote.requestId}`] };
    } catch {
      return;
    }
  }

  private async assetRegistry(): Promise<{ assets?: RobinhoodAsset[] }> {
    const assetsResponse = await fetch("https://api.robinhood.com/rhj/assets", {
      signal: AbortSignal.timeout(8_000)
    });
    if (!assetsResponse.ok) throw new Error(`ROBINHOOD_ASSETS_${assetsResponse.status}`);
    return (await assetsResponse.json()) as { assets?: RobinhoodAsset[] };
  }

  private async stockEligible(wallet: string): Promise<boolean> {
    // Local-live uses Uniswap's per-token permission response together with
    // Robinhood's active-asset and oracle checks. Production can additionally
    // require the configured jurisdiction/eligibility service.
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
  }
}
