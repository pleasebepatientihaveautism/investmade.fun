import request from "supertest";
import { describe, expect, it } from "vitest";
import {
	fillFeedPage,
	nextFeedExcludedAssetIds,
} from "../src/domain/feed-pagination.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import type { CandidateProvider } from "../src/server/adapters/types.js";
import { createApp, type AppDependencies } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { MemoryStateStore } from "../src/server/store.js";

function testApp(history?: AppDependencies["history"]) {
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
		history,
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

	it("returns demo history without calling Substreams", async () => {
		let calls = 0;
		const history = {
			history: async () => {
				calls += 1;
				return [];
			},
		} as unknown as AppDependencies["history"];
		const response = await request(testApp(history))
			.get("/api/assets/rh%3A4663%3AWETH/history")
			.expect(200);

		expect(calls).toBe(0);
		expect(response.body).toMatchObject({ period: "1M", source: "demo" });
		expect(response.body.points).toHaveLength(31);
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
		expect(feed.body.hasMore).toBe(true);
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

	it("enforces the selected DCA budget by total USDG, not asset count", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);

		await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				periodLimitUsd: 10,
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" },
					{ assetId: "rh:4663:AAPL", amountInBaseUnits: "10000000" },
				],
				slippageBps: 50,
			})
			.expect(422)
			.expect(({ body }) => expect(body.error).toBe("BUDGET_EXCEEDED"));
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

	it("shows community pool tokens only in degen mode", async () => {
		const app = testApp();
		const safeSession = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);
		const safeFeed = await request(app)
			.post(`/api/sessions/${safeSession.body.id}/feed`)
			.send({
				...onboardingPreferences,
				assetClasses: ["CRYPTO"],
				candidateLimit: 2,
			})
			.expect(200);
		expect(safeFeed.body.candidates.map((candidate: { symbol: string }) => candidate.symbol)).toEqual([
			"WETH",
		]);

		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "daily" })
			.expect(200);

		const feed = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				riskMode: "degen",
				assetClasses: ["CRYPTO"],
				candidateLimit: 2,
			})
			.expect(200);

		expect(feed.body.candidates.map((candidate: { symbol: string }) => candidate.symbol)).toEqual([
			"STEEL",
			"YOINK",
		]);
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

	it("continues the feed past ten cards without creating a new basket", async () => {
		const app = testApp();
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const first = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send(onboardingPreferences)
			.expect(200);
		const next = await request(app)
			.post(`/api/sessions/${opened.body.id}/feed`)
			.send({
				...onboardingPreferences,
				excludedAssetIds: first.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
			})
			.expect(200);

		expect(next.body.candidates).toHaveLength(2);
		expect(next.body.feed.cards).toHaveLength(2);
		expect(next.body.hasMore).toBe(false);
		expect(nextFeedExcludedAssetIds(first.body, ["selected"])).toEqual(
			first.body.candidates.map(
				(candidate: { assetId: string }) => candidate.assetId,
			),
		);
		expect(nextFeedExcludedAssetIds(next.body, ["selected"])).toEqual([
			"selected",
		]);
		const repeated = fillFeedPage(
			next.body.candidates as Array<{ assetId: string }>,
		);
		expect(repeated).toHaveLength(10);
		expect(repeated[8]?.assetId).toBe(
			(next.body.candidates[0] as { assetId: string }).assetId,
		);
		expect(
			new Set([
				...first.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
				...next.body.candidates.map(
					(candidate: { assetId: string }) => candidate.assetId,
				),
			]).size,
		).toBe(12);
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
			getCandidatesForExecution: (...args) =>
				provider.getCandidatesForExecution(...args),
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
				async getCandidatesForExecution(...args) {
					candidateRequests += 1;
					return provider.getCandidatesForExecution(...args);
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

	it("prepares only the selected assets and exposes stage timing", async () => {
		const provider = new DemoProvider();
		const executionRequests: string[][] = [];
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
				getCandidates: (...args) => provider.getCandidates(...args),
				async getCandidatesForExecution(wallet, assetIds, amount, now) {
					executionRequests.push(assetIds);
					return provider.getCandidatesForExecution(
						wallet,
						assetIds,
						amount,
						now,
					);
				},
			},
			inference: provider,
			execution: provider,
		});
		const opened = await request(app)
			.post("/api/sessions/open")
			.send({ cadence: "weekly" })
			.expect(200);
		const prepared = await request(app)
			.post("/api/executions/prepare")
			.send({
				sessionId: opened.body.id,
				chainId: 4663,
				inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
				selections: [
					{ assetId: "rh:4663:WETH", amountInBaseUnits: "100000" },
				],
				slippageBps: 50,
			})
			.expect(200);

		expect(executionRequests).toEqual([["rh:4663:WETH"]]);
		expect(prepared.body.plan.quotes).toHaveLength(1);
		expect(prepared.headers["server-timing"]).toMatch(
			/session;dur=.*candidates;dur=.*execution;dur=.*store;dur=.*total;dur=/,
		);
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
