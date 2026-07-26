import { describe, expect, it } from "vitest";
import { sha256 } from "../src/domain/canonical.js";
import { executionIntent } from "../src/domain/execution-intent.js";
import {
	formatTicketSizeUsd,
	ticketSizeToBaseUnits,
} from "../src/domain/schemas.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import {
	executionMatchesReviewBasket,
	executionPlanHashMatchesReviewBasket,
	type ReviewBasket,
	type ReviewExecutionRecord,
} from "../src/client/review-safety.js";

describe("review signing safety", () => {
	it("formats three ten-cent allocations as exact money", () => {
		expect(formatTicketSizeUsd(0.1 * 3)).toBe("0.30");
	});

	it("blocks signing after prepare then removing the prepared asset", async () => {
		const provider = new DemoProvider();
		const [candidate] = await provider.getCandidates(
			"0x71f30000000000000000000000000000000009a2",
		);
		if (!candidate) throw new Error("TEST_CANDIDATE_REQUIRED");
		const basket: ReviewBasket = {
			sessionId: "session-1",
			epochId: "2026-W30:basket:test",
			selected: [candidate],
			ticketSizeUsd: 0.1,
			wallet: "0x71f30000000000000000000000000000000009a2",
		};
		const amountInBaseUnits = ticketSizeToBaseUnits(
			basket.ticketSizeUsd,
		).toString();
		const request = {
			sessionId: basket.sessionId,
			chainId: 4663 as const,
			inputToken:
				"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
			selections: [{ assetId: candidate.assetId, amountInBaseUnits }],
			slippageBps: 50,
		};
		const record: ReviewExecutionRecord = {
			plan: {
				executionId: "execution-1",
				sessionId: basket.sessionId,
				epochId: basket.epochId,
				chainId: 4663,
				inputToken: request.inputToken,
				totalInputBaseUnits: amountInBaseUnits,
				authorizedPlanHash: sha256(
					executionIntent(
						{ id: basket.sessionId, epochId: basket.epochId },
						request,
					),
				),
				policyHash: `sha256:${"b".repeat(64)}`,
				callCommitments: [`sha256:${"c".repeat(64)}`],
				quotes: [{ ...candidate.quote, amountInBaseUnits }],
				generatedAt: new Date().toISOString(),
			},
			status: "PREPARED",
			walletCalls: [
				{
					transaction: {
						from: basket.wallet,
					},
				},
			],
		};

		expect(executionMatchesReviewBasket(record, basket)).toBe(true);
		expect(await executionPlanHashMatchesReviewBasket(record, basket)).toBe(true);

		const afterRemoval = { ...basket, selected: [] };
		expect(executionMatchesReviewBasket(record, afterRemoval)).toBe(false);
		expect(
			await executionPlanHashMatchesReviewBasket(record, afterRemoval),
		).toBe(false);
	});
});
