import { randomUUID } from "node:crypto";
import { ASSET_REGISTRY, SLOT_BUDGET } from "../../domain/constants.js";
import { sha256 } from "../../domain/canonical.js";
import type { Candidate, ExecutionRequest, FeedInput, FeedOutput } from "../../domain/schemas.js";
import type {
  CandidateProvider,
  ExecutionProvider,
  PrivateInferenceProvider
} from "./types.js";

const outputs: Record<string, string> = {
  WETH: "3113000000000000",
  AAPL: "60420000000000000",
  TSLA: "26750000000000000"
};
const demoMeta: Record<string, { priceImpactBps: number; crowdScoreBps: number; reason: string }> = {
  WETH: {
    priceImpactBps: 19,
    crowdScoreBps: 6_100,
    reason: "Positive crypto breadth and an executable low-impact route."
  },
  AAPL: {
    priceImpactBps: 38,
    crowdScoreBps: 5_781,
    reason: "Healthy market state, strong crowd preference, and a fresh low-impact route."
  },
  TSLA: {
    priceImpactBps: 31,
    crowdScoreBps: 5_340,
    reason: "Active market state and a fresh route within the policy limit."
  }
};

export class DemoProvider
  implements CandidateProvider, PrivateInferenceProvider, ExecutionProvider
{
  async getCandidates(_wallet: string, now = new Date()): Promise<Candidate[]> {
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    return Object.values(ASSET_REGISTRY).map((asset) => {
      const estimated = outputs[asset.symbol];
      const meta = demoMeta[asset.symbol];
      if (!estimated || !meta) throw new Error(`DEMO_FIXTURE_MISSING_${asset.symbol}`);
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
          amountInBaseUnits: SLOT_BUDGET.toString(),
          estimatedAmountOut: estimated,
          minimumAmountOut: minimum,
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
    const cards = candidates.map((candidate, index) => ({
      assetId: candidate.assetId,
      action: "BUY" as const,
      rank: index + 1,
      amountInBaseUnits: SLOT_BUDGET.toString(),
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
    const current = await this.getCandidates("demo");
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
        estimatedAmountOut: SLOT_BUDGET.toString(),
        minimumAmountOut: ((SLOT_BUDGET * 995n) / 1000n).toString(),
        priceImpactBps: demoMeta[candidate.symbol]?.priceImpactBps ?? 0,
        routing: "CLASSIC" as const,
        quotedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 60_000).toISOString()
      },
      walletCalls: []
    };
  }
}
