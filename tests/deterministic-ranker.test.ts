import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import { rankingInputSchema } from "../src/domain/schemas.js";
import { DeterministicRanker } from "../src/server/adapters/deterministic-ranker.js";
import { DemoProvider } from "../src/server/adapters/demo.js";

async function inputWithRanks() {
	const candidates = (await new DemoProvider().getRankingCandidates(3)).map(
		(candidate, index) => ({
			...candidate,
			liquidityUsd: 1_000_000,
			volume24hUsd: 500_000,
			organicScore: 70,
			verified: true,
			marketCapRank: index === 0 ? 400 : index === 1 ? 10 : undefined,
			marketCapRankSource: index < 2 ? ("coingecko" as const) : undefined,
		}),
	);
	const unsigned = {
		schemaVersion: "investmade-ranking-input/v1" as const,
		sessionId: "deterministic-session",
		epochId: "2026-W31",
		policyVersion: "investmade-policy/v1" as const,
		budget: {
			periodBudgetBaseUnits: "100000000",
			slotBudgetBaseUnits: "10000000",
			maxCards: 10,
		},
		preferences: {
			cadence: "weekly" as const,
			ticketSizeUsd: 10,
			riskMode: "balanced" as const,
			assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const,
			feedRankingProvider: "DETERMINISTIC" as const,
		},
		candidates,
	};
	return rankingInputSchema.parse({
		...unsigned,
		inputCommitment: sha256(unsigned),
	});
}

describe("deterministic ranking", () => {
	it("uses CoinGecko rank as a bounded signal and records the effective provider", async () => {
		const input = await inputWithRanks();
		const result = await new DeterministicRanker().rank(input);

		expect(result.output.assets[0]?.assetId).toBe(input.candidates[1]?.assetId);
		expect(result.output.assets[0]?.reason).toContain(
			"CoinGecko market-cap rank #10",
		);
		expect(result.receipt).toMatchObject({
			requestedProvider: "DETERMINISTIC",
			effectiveProvider: "DETERMINISTIC",
			teeVerified: false,
		});
	});

	it("treats a missing CoinGecko rank as unknown rather than rejecting the asset", async () => {
		const input = await inputWithRanks();
		const result = await new DeterministicRanker().rank(input);
		expect(result.output.assets.map((asset) => asset.assetId)).toContain(
			input.candidates[2]?.assetId,
		);
	});
});
