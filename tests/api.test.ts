import request from "supertest";
import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/server/adapters/demo.js";
import type { CandidateProvider } from "../src/server/adapters/types.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { MemoryStateStore } from "../src/server/store.js";

function testApp() {
	const provider = new DemoProvider();
	return createApp({
		config: loadConfig({
			NODE_ENV: "test",
			INVESTMADE_DEMO_MODE: "true",
			PUBLIC_ORIGIN: "http://localhost:5173",
			SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
			PRIVY_APP_ID: "test-privy-app-id",
			PRIVY_APP_SECRET: "test-privy-app-secret",
		}),
		store: new MemoryStateStore(),
		candidates: provider,
		inference: provider,
		execution: provider,
	});
}

const onboardingPreferences = {
	cadence: "weekly",
	ticketSizeUsd: 10,
	riskMode: "balanced",
	assetClasses: ["CRYPTO", "STOCK_TOKEN"],
	riskDisclosureAccepted: true,
};

describe("core API flow", () => {
	it("exposes only safe icon URLs, never the CoinGecko API key", async () => {
		const response = await request(testApp())
			.get("/api/assets/icons")
			.expect(200);
		expect(response.body).toEqual({ icons: {} });
	});

	it("opens repeatable demo baskets, generates a bounded feed, and reserves execution once", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const second = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		expect(second.body.id).not.toBe(opened.body.id);

		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		expect(feed.body.feed.cards).toHaveLength(10);
		expect(feed.body.candidates).toHaveLength(10);
		expect(feed.body.candidates[0].quote.unitPriceUsd).toBe("3212.335367");
		expect(feed.body.proof.teeVerified).toBe(false);

		const body = {
			sessionId: opened.body.id,
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			selections: [{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" }],
			slippageBps: 50,
		};
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		const retry = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		expect(retry.body.plan.executionId).toBe(prepared.body.plan.executionId);

		const settled = await request(app)
			.post(`/api/executions/${prepared.body.plan.executionId}/demo-settle`)
			.expect(200);
		expect(settled.body.status).toBe("SETTLED");
		expect(settled.body.transactionHashes).toHaveLength(1);
		expect(settled.body.settledOutputs).toEqual([
			expect.objectContaining({
				assetId: "rh:4663:WETH",
				amountOutBaseUnits: "3113000000000000",
				status: "success",
			}),
		]);

		const nextFeed = await request(app)
			.post(`/api/sessions/${second.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		const nextPrepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				...body,
				sessionId: second.body.id,
				selections: [
					{
						assetId: nextFeed.body.candidates[0].assetId,
						amountInBaseUnits: "10000000",
					},
				],
			})
			.expect(200);
		expect(nextPrepared.body.plan.executionId).not.toBe(
			prepared.body.plan.executionId,
		);
	});

	it("filters the feed using validated onboarding preferences", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				cadence: "daily",
				ticketSizeUsd: 10,
				riskMode: "conservative",
				assetClasses: ["STOCK_TOKEN"],
			})
			.expect(200);

		expect(feed.body.candidates).toHaveLength(9);
		expect(
			feed.body.candidates.every(
				(candidate: { kind: string }) => candidate.kind === "STOCK_TOKEN",
			),
		).toBe(true);
		expect(feed.body.feed.cards[0].amountInBaseUnits).toBe("10000000");
		expect(feed.body.candidates[0].quote.amountInBaseUnits).toBe("10000000");

		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(200);
		expect(prepared.body.plan.totalInputBaseUnits).toBe("10000000");
		expect(prepared.body.plan.quotes[0].amountInBaseUnits).toBe("10000000");
	});

	it("stops candidate work at the requested feed size", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, candidateLimit: 5 })
			.expect(200);

		expect(feed.body.candidates).toHaveLength(5);
		expect(feed.body.feed.cards).toHaveLength(5);
	});

	it("drops a quote that expired during candidate discovery before inference", async () => {
		const provider = new DemoProvider();
		const candidates: CandidateProvider = {
			async getCandidates(...args) {
				const generated = await provider.getCandidates(...args);
				const first = generated[0];
				if (!first) return generated;
				return [
					{
						...first,
						quote: {
							...first.quote,
							quotedAt: new Date(Date.now() - 61_000).toISOString(),
						},
					},
					...generated.slice(1),
				];
			},
		};
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates,
			inference: provider,
			execution: provider,
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);

		expect(feed.body.candidates).toHaveLength(9);
		expect(
			feed.body.candidates.some(
				(candidate: { assetId: string }) =>
					candidate.assetId === "rh:4663:WETH",
			),
		).toBe(false);
	});

	it("bounds a higher ticket-size feed within the fixed period budget", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "monthly" })
			.expect(200);
		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, cadence: "monthly", ticketSizeUsd: 25 })
			.expect(200);

		expect(feed.body.candidates).toHaveLength(4);
		expect(feed.body.feed.cards).toHaveLength(4);
		expect(
			feed.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "25000000",
			),
		).toBe(true);
	});

	it("supports $0.10 and $0.25 USDG ticket sizes with exact base units", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);

		const tenth = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, ticketSizeUsd: 0.1 })
			.expect(200);
		expect(tenth.body.feed.cards).toHaveLength(10);
		expect(
			tenth.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "100000",
			),
		).toBe(true);

		const quarter = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({ ...onboardingPreferences, ticketSizeUsd: 0.25 })
			.expect(200);
		expect(quarter.body.feed.cards).toHaveLength(10);
		expect(
			quarter.body.feed.cards.every(
				(card: { amountInBaseUnits: string }) =>
					card.amountInBaseUnits === "250000",
			),
		).toBe(true);
	});

	it("rejects a non-canonical selection", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const response = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:SCAM", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(422);
		expect(response.body.error).toBe("ASSET_NOT_ELIGIBLE");
	});

	it("rejects a terminal epoch before candidate or execution preparation", async () => {
		const provider = new DemoProvider();
		let candidateRequests = 0;
		let executionPreparations = 0;
		const app = createApp({
			config: loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PUBLIC_ORIGIN: "http://localhost:5173",
				SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
				PRIVY_APP_ID: "test-privy-app-id",
				PRIVY_APP_SECRET: "test-privy-app-secret",
			}),
			store: new MemoryStateStore(),
			candidates: {
				async getCandidates(...args) {
					candidateRequests += 1;
					return provider.getCandidates(...args);
				},
			},
			inference: provider,
			execution: {
				async prepare(...args) {
					executionPreparations += 1;
					return provider.prepare(...args);
				},
				prepareExit: (...args) => provider.prepareExit(...args),
			},
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const body = {
			sessionId: opened.body.id,
			chainId: 4663,
			inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
			selections: [{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" }],
			slippageBps: 50,
		};
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(200);
		await request(app)
			.post(`/api/executions/${prepared.body.plan.executionId}/demo-settle`)
			.expect(200);
		const requestsBeforeRetry = candidateRequests;
		const preparationsBeforeRetry = executionPreparations;

		const conflict = await request(app)
			.post("/api/executions/prepare")
			.send(body)
			.expect(409);

		expect(conflict.body).toEqual(
			expect.objectContaining({
				error: "EXECUTION_TERMINAL",
				executionId: prepared.body.plan.executionId,
				status: "SETTLED",
			}),
		);
		expect(candidateRequests).toBe(requestsBeforeRetry);
		expect(executionPreparations).toBe(preparationsBeforeRetry);
	});

	it("keeps a supported exit reachable outside the weekly execution path", async () => {
		const app = testApp();
		const response = await request(app)
			.post("/api/positions/rh%3A4663%3AWETH/exit/quote")
			.send({ amountInBaseUnits: "1000000000000000" })
			.expect(200);
		expect(response.body.asset.symbol).toBe("WETH");
		expect(response.body.quote.tokenOut).toBe(
			"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
		);
		expect(response.body.walletCalls).toEqual([]);
	});
});
