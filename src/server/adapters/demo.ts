import { randomUUID } from "node:crypto";
import { ASSET_REGISTRY, DEFAULT_SLOT_BUDGET, MAX_CARDS } from "../../domain/constants.js";
import { sha256 } from "../../domain/canonical.js";
import { unitPriceUsdFromQuote } from "../../domain/price.js";
import type { Candidate, ExecutionRequest, FeedInput, FeedOutput } from "../../domain/schemas.js";
import type {
  CandidateProvider,
  ExecutionProvider,
  PrivateInferenceProvider
} from "./types.js";

const outputs: Record<string, string> = {
  WETH: "3113000000000000",
  GME: "468000000000000000",
  NVDA: "48070000000000000",
  SPCX: "89300000000000000",
  MSTR: "89000000000000000",
  GOOGL: "31460000000000000",
  AAPL: "29780000000000000",
  RDDT: "47890000000000000",
  MSFT: "22200000000000000",
  TSLA: "30780000000000000"
};
const demoMeta: Record<string, { priceImpactBps: number; crowdScoreBps: number; reason: string }> = {
  WETH: {
    priceImpactBps: 19,
    crowdScoreBps: 6_100,
    reason: "Positive crypto breadth and an executable low-impact route."
  },
  GME: {
    priceImpactBps: 38,
    crowdScoreBps: 5_781,
    reason: "Strong market activity and a fresh Robinhood Chain token route."
  },
  NVDA: {
    priceImpactBps: 31,
    crowdScoreBps: 5_340,
    reason: "Healthy market state and a current route within the policy limit."
  },
  SPCX: {
    priceImpactBps: 24,
    crowdScoreBps: 5_120,
    reason: "Fresh tokenized market exposure with a low estimated route impact."
  },
  MSTR: {
    priceImpactBps: 28,
    crowdScoreBps: 5_010,
    reason: "Active market state and a fresh route within the policy limit."
  },
  GOOGL: {
    priceImpactBps: 26,
    crowdScoreBps: 4_920,
    reason: "Healthy market state and a fresh executable route."
  },
  AAPL: {
    priceImpactBps: 33,
    crowdScoreBps: 4_810,
    reason: "Strong crowd signal with acceptable estimated route impact."
  },
  RDDT: {
    priceImpactBps: 21,
    crowdScoreBps: 4_700,
    reason: "Fresh tokenized stock route within the execution guardrails."
  },
  MSFT: {
    priceImpactBps: 41,
    crowdScoreBps: 4_590,
    reason: "Steady crowd preference and a low-impact tokenized stock route."
  },
  TSLA: {
    priceImpactBps: 18,
    crowdScoreBps: 4_480,
    reason: "Active market state and a fresh route within the policy limit."
  }
};

export class DemoProvider
  implements CandidateProvider, PrivateInferenceProvider, ExecutionProvider
{
  async getCandidates(
    _wallet: string,
    amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
    now = new Date(),
    limit = MAX_CARDS
  ): Promise<Candidate[]> {
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const amount = BigInt(amountInBaseUnits);
    return Object.values(ASSET_REGISTRY)
      .filter((asset) => Boolean(outputs[asset.symbol] && demoMeta[asset.symbol]))
      .slice(0, limit)
      .map((asset) => {
      const baseEstimate = outputs[asset.symbol];
      const meta = demoMeta[asset.symbol];
      if (!baseEstimate || !meta) throw new Error(`DEMO_FIXTURE_MISSING_${asset.symbol}`);
      const estimated = (
        (BigInt(baseEstimate) * amount) /
        DEFAULT_SLOT_BUDGET
      ).toString();
      const minimum = ((BigInt(estimated) * 995n) / 1000n).toString();
      return {
        ...asset,
        contract: asset.address,
        eligible: true,
        marketHealthy: true,
        permissionAllowed: true,
        quote: {
          requestId: `demo-quote-${asset.symbol.toLowerCase()}-${randomUUID()}`,
          assetId: asset.assetId,
          tokenOut: asset.address,
          amountInBaseUnits,
          estimatedAmountOut: estimated,
          minimumAmountOut: minimum,
          unitPriceUsd: unitPriceUsdFromQuote(amountInBaseUnits, estimated, asset.decimals),
          priceImpactBps: meta.priceImpactBps,
          routing: "CLASSIC" as const,
          quotedAt: now.toISOString(),
          expiresAt
        },
        crowdScoreBps: meta.crowdScoreBps,
        reason: meta.reason,
        evidenceIds: [
          `demo:market:${asset.symbol}`,
          `demo:crowd:${asset.symbol}`,
          `demo:quote:${asset.symbol}`
        ]
      };
    });
  }

  async generate(input: FeedInput, candidates: Candidate[]) {
    const cards = candidates.slice(0, MAX_CARDS).map((candidate, index) => ({
      assetId: candidate.assetId,
      action: "BUY" as const,
      rank: index + 1,
      amountInBaseUnits: input.budget.slotBudgetBaseUnits,
      scoreBps: 7_420 - index * 410,
      evidenceIds: candidate.evidenceIds,
      reason: candidate.reason
    }));
    const output: FeedOutput = {
      schemaVersion: "investmade-feed-output/v1",
      sessionId: input.sessionId,
      inputCommitment: input.inputCommitment,
      policyVersion: "investmade-policy/v1",
      regime: "CRYPTO_BULLISH",
      cards,
      warnings: ["Demo evidence is deterministic and cannot be used for mainnet execution."]
    };
    return {
      output,
      receipt: {
        network: "LOCAL_DEMO",
        model: "deterministic-fixture/v1",
        provider: "local",
        teeVerified: false,
        inputCommitment: input.inputCommitment,
        outputCommitment: sha256(output)
      }
    };
  }

  async prepare(_wallet: string, request: ExecutionRequest, _candidates: Candidate[]) {
    const amountInBaseUnits = request.selections[0]?.amountInBaseUnits;
    const current = await this.getCandidates("demo", amountInBaseUnits);
    const selected = new Set(request.selections.map((selection) => selection.assetId));
    return {
      quotes: current
      .filter((candidate) => selected.has(candidate.assetId))
      .map((candidate) => candidate.quote),
      walletCalls: []
    };
  }

  async prepareExit(
    _wallet: string,
    candidate: Candidate,
    amountInBaseUnits: string,
    _slippageBps: number
  ) {
    const now = new Date();
    return {
      quote: {
        requestId: `demo-exit-${candidate.symbol.toLowerCase()}-${randomUUID()}`,
        assetId: candidate.assetId,
        tokenOut: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
        amountInBaseUnits,
        estimatedAmountOut: DEFAULT_SLOT_BUDGET.toString(),
        minimumAmountOut: ((DEFAULT_SLOT_BUDGET * 995n) / 1000n).toString(),
        unitPriceUsd: "1",
        priceImpactBps: demoMeta[candidate.symbol]?.priceImpactBps ?? 0,
        routing: "CLASSIC" as const,
        quotedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString()
      },
      walletCalls: []
    };
  }
}
