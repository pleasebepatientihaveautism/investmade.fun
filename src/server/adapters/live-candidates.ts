import { createPublicClient, http } from "viem";
import { ASSET_REGISTRY, SLOT_BUDGET } from "../../domain/constants.js";
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

  constructor(private readonly config: AppConfig) {
    if (!config.UNISWAP_API_KEY) throw new Error("UNISWAP_API_KEY_REQUIRED");
    this.uniswap = new UniswapProvider(config.UNISWAP_API_KEY);
    this.client = createPublicClient({ transport: http(config.ROBINHOOD_RPC_URL) });
  }

  async getCandidates(wallet: string, now = new Date()): Promise<Candidate[]> {
    const assetsResponse = await fetch("https://api.robinhood.com/rhj/assets", {
      signal: AbortSignal.timeout(8_000)
    });
    if (!assetsResponse.ok) throw new Error(`ROBINHOOD_ASSETS_${assetsResponse.status}`);
    const registry = (await assetsResponse.json()) as { assets?: RobinhoodAsset[] };
    const stockEligible = await this.stockEligible(wallet);

    const candidates = await Promise.all(
      Object.values(ASSET_REGISTRY).map(async (asset) => {
        try {
          const contractCode = await this.client.getCode({
            address: asset.address as `0x${string}`
          });
          if (!contractCode || contractCode === "0x") return undefined;

          let marketHealthy = true;
          let eligible = true;
          let permissionAllowed = true;
          if (asset.kind === "STOCK_TOKEN") {
            if (!stockEligible) return undefined;
            const rhAsset = registry.assets?.find((item) => item.tokenSymbol === asset.symbol);
            const deployment = rhAsset?.deployments.find(
              (item) => item.chainId === 4663 && item.contractAddress.toLowerCase() === asset.address.toLowerCase()
            );
            if (rhAsset?.status !== "ASSET_STATUS_ACTIVE" || !deployment) return undefined;
            const [priceResponse, oraclePaused] = await Promise.all([
              fetch(`https://api.robinhood.com/rhj/prices/${asset.symbol}`, {
                signal: AbortSignal.timeout(8_000)
              }),
              this.client.readContract({
                address: asset.address as `0x${string}`,
                abi: oraclePausedAbi,
                functionName: "oraclePaused"
              })
            ]);
            if (!priceResponse.ok) return undefined;
            const priceBody = (await priceResponse.json()) as { quotes?: RobinhoodPrice[] };
            const price = priceBody.quotes?.find((item) => item.tokenSymbol === asset.symbol);
            const ageMs = price ? now.getTime() - new Date(price.generatedAt).getTime() : Infinity;
            marketHealthy = Boolean(price && !price.isTradingHalt && oraclePaused === false && ageMs >= 0 && ageMs <= 60_000);
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
              amountInBaseUnits: SLOT_BUDGET.toString(),
              estimatedAmountOut: "1",
              minimumAmountOut: "1",
              priceImpactBps: 0,
              routing: "CLASSIC",
              quotedAt: now.toISOString(),
              expiresAt: new Date(now.getTime() + 60_000).toISOString()
            },
            crowdScoreBps: 0,
            reason: "Canonical asset with healthy state and a fresh executable route.",
            evidenceIds: [`rh:registry:${asset.symbol}`, `rh:state:${asset.symbol}`]
          };
          const quote = await this.uniswap.quote(wallet, seed, SLOT_BUDGET.toString(), 50);
          return {
            ...seed,
            quote,
            evidenceIds: [...seed.evidenceIds, `uni:${quote.requestId}`]
          };
        } catch {
          return undefined;
        }
      })
    );
    return candidates.filter((candidate): candidate is Candidate => Boolean(candidate));
  }

  private async stockEligible(wallet: string): Promise<boolean> {
    if (!this.config.STOCK_ELIGIBILITY_PROVIDER_URL) return false;
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
