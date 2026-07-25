import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/server/adapters/demo.js";
import { sha256 } from "../src/domain/canonical.js";
import { DEFAULT_BUDGET, feedInputSchema, feedOutputSchema } from "../src/domain/schemas.js";
import { PolicyError, eligibleCandidates, validateFeed } from "../src/domain/policy.js";

describe("deterministic feed policy", () => {
  it("accepts only fresh, registered, executable candidates", async () => {
    const now = new Date("2026-07-25T12:00:00.000Z");
    const candidates = await new DemoProvider().getCandidates("0x0", "10000000", now);
    expect(eligibleCandidates(candidates, now)).toHaveLength(10);

    const firstCandidate = candidates[0];
    if (!firstCandidate) throw new Error("Expected a demo candidate");
    firstCandidate.quote.expiresAt = new Date(now.getTime() - 1).toISOString();
    expect(eligibleCandidates(candidates, now)).toHaveLength(9);
  });

  it("rejects an invented asset returned by the model", async () => {
    const candidates = await new DemoProvider().getCandidates("0x0");
    const unsigned = {
      schemaVersion: "investmade-feed-input/v1" as const,
      sessionId: "session-1",
      epochId: "2026-W30",
      policyVersion: "investmade-policy/v1" as const,
      budget: DEFAULT_BUDGET,
      preferences: {
        cadence: "weekly" as const,
        ticketSizeUsd: 10,
        riskMode: "balanced" as const,
        assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const
      },
      candidates
    };
    const input = feedInputSchema.parse({
      ...unsigned,
      inputCommitment: sha256(unsigned)
    });
    const generated = await new DemoProvider().generate(input, candidates);
    const firstCard = generated.output.cards[0];
    if (!firstCard) throw new Error("Expected a demo card");
    firstCard.assetId = "rh:4663:INVENTED";
    expect(() => validateFeed(generated.output, input, candidates)).toThrowError(
      new PolicyError(
        "ASSET_NOT_ELIGIBLE",
        "Asset rh:4663:INVENTED did not pass the candidate gate."
      )
    );
  });

  it("rejects a commitment mismatch", async () => {
    const candidates = await new DemoProvider().getCandidates("0x0");
    const unsigned = {
      schemaVersion: "investmade-feed-input/v1" as const,
      sessionId: "session-1",
      epochId: "2026-W30",
      policyVersion: "investmade-policy/v1" as const,
      budget: DEFAULT_BUDGET,
      preferences: {
        cadence: "weekly" as const,
        ticketSizeUsd: 10,
        riskMode: "balanced" as const,
        assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const
      },
      candidates
    };
    const input = feedInputSchema.parse({
      ...unsigned,
      inputCommitment: sha256(unsigned)
    });
    const generated = await new DemoProvider().generate(input, candidates);
    generated.output.inputCommitment = `sha256:${"0".repeat(64)}`;
    expect(() => validateFeed(generated.output, input, candidates)).toThrowError(
      /commitment/
    );
  });

  it("rejects more than ten model cards at the schema boundary", () => {
    const card = {
      assetId: "rh:4663:WETH",
      action: "BUY",
      rank: 1,
      amountInBaseUnits: "10000000",
      scoreBps: 7000,
      evidenceIds: ["evidence"],
      reason: "Bounded reason."
    };
    const result = feedOutputSchema.safeParse({
      schemaVersion: "investmade-feed-output/v1",
      sessionId: "session",
      inputCommitment: `sha256:${"1".repeat(64)}`,
      policyVersion: "investmade-policy/v1",
      regime: "CRYPTO_NEUTRAL",
      cards: Array.from({ length: 11 }, (_, index) => ({ ...card, rank: index + 1 })),
      warnings: []
    });
    expect(result.success).toBe(false);
  });
});
