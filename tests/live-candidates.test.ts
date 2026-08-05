import { describe, expect, it, vi } from "vitest";
import { LiveCandidateProvider } from "../src/server/adapters/live-candidates.js";
import { loadConfig } from "../src/server/config.js";

const wallet = "0x71f30000000000000000000000000000000009a2";
const txOrigin = "0x71f30000000000000000000000000000000009a3";
const addresses = {
	AAPL: "0x00000000000000000000000000000000000000a1",
	AAA: "0x00000000000000000000000000000000000000a2",
	BBB: "0x00000000000000000000000000000000000000b2",
	HALT: "0x00000000000000000000000000000000000000c1",
	STALE: "0x00000000000000000000000000000000000000d1",
	INACTIVE: "0x00000000000000000000000000000000000000e1",
	WRONG: "0x00000000000000000000000000000000000000f1",
	CASHCAT: "0x020bfC650A365f8BB26819deAAbF3E21291018b4",
	VIRTUAL: "0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31",
} as const;

function asset(
	symbol: keyof typeof addresses,
	status = "ASSET_STATUS_ACTIVE",
	chainId = 4663,
) {
	return {
		tokenSymbol: symbol,
		tokenName: `${symbol} Corp • Robinhood Token`,
		status,
		deployments: [{ chainId, contractAddress: addresses[symbol] }],
	};
}

function price(
	symbol: keyof typeof addresses,
	volume: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		tokenSymbol: symbol,
		deployments: [{ chainId: 4663, contractAddress: addresses[symbol] }],
		bid: "99",
		ask: "101",
		dailyTradingVolume: volume,
		mintBurnUsdVolume: volume,
		isTradingHalt: false,
		generatedAt: "2026-07-28T17:46:49.166Z",
		...overrides,
	};
}

describe("live Robinhood catalog", () => {
	it("discovers active assets and uses only an exact provider quote for feed cards", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/rhj/assets")) {
				return Response.json({
					assets: [
						asset("AAPL"),
						asset("BBB"),
						asset("AAA"),
						asset("HALT"),
						asset("STALE"),
						asset("INACTIVE", "ASSET_STATUS_INACTIVE"),
						asset("WRONG", "ASSET_STATUS_ACTIVE", 1),
					],
				});
			}
			if (url.endsWith("/rhj/prices")) {
				return Response.json({
					quotes: [
						price("AAPL", "100"),
						price("AAA", "50"),
						price("BBB", "50"),
						price("HALT", "1000", { isTradingHalt: true }),
						price("STALE", "900", {
							deployments: [
								{
									chainId: 4663,
									contractAddress: "0x0000000000000000000000000000000000009999",
								},
							],
						}),
					],
				});
			}
			throw new Error(`Unexpected URL ${url}`);
		}) as typeof fetch;
		const priceCheck = vi.fn(
			async (
				_wallet: string,
				_txOrigin: string,
				candidate: {
					assetId: string;
					contract: string;
					decimals: number;
				},
				amountInBaseUnits: string,
			) => {
				expect(amountInBaseUnits).toBe("2500000");
				return {
					requestId: `quote-${candidate.assetId}`,
					chain: "ROBINHOOD" as const,
					assetId: candidate.assetId,
					tokenOut: candidate.contract,
					amountInBaseUnits,
					estimatedAmountOut: "1000000000000000000",
					minimumAmountOut: "990000000000000000",
					unitPriceUsd: "2.50",
					priceImpactBps: 10,
					routing: "ZERO_EX" as const,
					provider: "ZERO_EX" as const,
					quotedAt: "2026-07-28T17:46:49.166Z",
					expiresAt: "2026-07-28T17:47:19.166Z",
					providerEvidence: { route: "test" },
				};
			},
		);
		const getCode = vi.fn(async () => "0x");
		const readContract = vi.fn(async () => {
			throw new Error("feed must not read the stock oracle");
		});
		const provider = new LiveCandidateProvider(
			loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PRIVY_APP_ID: "test",
				PRIVY_APP_SECRET: "test",
			}),
			{ id: "ZERO_EX", label: "0x", price: priceCheck },
			{
				fetcher,
				client: {
					getCode,
					readContract,
				},
			},
		);

		const ranking = await provider.getRankingCandidates(20);
		expect(
			ranking
				.filter((candidate) => candidate.kind === "CRYPTO")
				.map((candidate) => candidate.symbol),
		).toEqual(["STEEL", "WETH", "YOINK"]);
		expect(
			ranking
				.filter((candidate) => candidate.kind === "STOCK_TOKEN")
				.map((candidate) => candidate.symbol),
		).toEqual(["HALT", "STALE", "AAPL", "AAA", "BBB"]);
		expect(ranking.some((candidate) => candidate.symbol === "INACTIVE")).toBe(
			false,
		);
		expect(ranking.some((candidate) => candidate.symbol === "WRONG")).toBe(
			false,
		);

		const cards = await provider.getCandidatesForFeed(
			wallet,
			["rh:4663:AAPL"],
			"2500000",
			new Date(),
			1,
			txOrigin,
		);
		expect(cards).toHaveLength(1);
		expect(cards[0]).toMatchObject({
			assetId: "rh:4663:AAPL",
			contract: addresses.AAPL,
			marketHealthy: true,
			permissionAllowed: true,
			marketDataSource: "0x",
		});
		expect(cards[0]).not.toHaveProperty("quote");
		expect(cards[0]?.evidenceIds).toContain("zero_ex:quote-rh:4663:AAPL");
		expect(priceCheck).toHaveBeenCalledWith(
			wallet,
			txOrigin,
			expect.objectContaining({ assetId: "rh:4663:AAPL" }),
			"2500000",
			50,
		);
		expect(getCode).not.toHaveBeenCalled();
		expect(readContract).not.toHaveBeenCalled();
	});

	it("discovers and deduplicates Uniswap pool tokens without filtering thin pools", async () => {
		const geckoCalls: string[] = [];
		const poolResponse = (
			dex: string,
			pool: string,
			token: {
				address: string;
				name: string;
				symbol: string;
				coingeckoId?: string;
			},
			reserve: string,
			volume: string,
		) =>
			Response.json({
				data: [
					{
						attributes: {
							address: "0x00000000000000000000000000000000000000ff",
							reserve_in_usd: "999",
							volume_usd: { h24: "999" },
						},
						relationships: {
							base_token: { data: { id: "robinhood_missing" } },
							quote_token: { data: { id: "robinhood_missing_quote" } },
							dex: { data: { id: dex } },
						},
					},
					{
						attributes: {
							address: pool,
							base_token_price_usd: "0.50",
							quote_token_price_usd: "2000",
							reserve_in_usd: reserve,
							volume_usd: { h24: volume },
							price_change_percentage: { h24: "12.5" },
						},
						relationships: {
							base_token: { data: { id: `robinhood_${token.address}` } },
							quote_token: {
								data: {
									id: `robinhood_0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
								},
							},
							dex: { data: { id: dex } },
						},
					},
				],
				included: [
					{
						id: `robinhood_${token.address}`,
						attributes: {
							address: token.address,
							name: token.name,
							symbol: token.symbol,
							decimals: 18,
							coingecko_coin_id: token.coingeckoId ?? null,
						},
					},
					{
						id: `robinhood_0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
						attributes: {
							address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
							name: "Wrapped Ether",
							symbol: "WETH",
							decimals: 18,
							coingecko_coin_id: "weth",
						},
					},
				],
			});
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/rhj/assets")) return Response.json({ assets: [] });
			if (url.endsWith("/rhj/prices")) return Response.json({ quotes: [] });
			if (url.includes("/uniswap-v2-robinhood/pools")) {
				geckoCalls.push(url);
				return poolResponse(
					"uniswap-v2-robinhood",
					"0x0000000000000000000000000000000000000101",
					{
						address: addresses.CASHCAT,
						name: "Cash Cat",
						symbol: "CASHCAT",
						coingeckoId: "cash-cat",
					},
					"100",
					"10",
				);
			}
			if (url.includes("/uniswap-v3-robinhood/pools")) {
				geckoCalls.push(url);
				return poolResponse(
					"uniswap-v3-robinhood",
					"0x0000000000000000000000000000000000000102",
					{
						address: addresses.CASHCAT.toLowerCase(),
						name: "Cash Cat",
						symbol: "CASHCAT",
						coingeckoId: "cash-cat",
					},
					"50",
					"5",
				);
			}
			if (url.includes("/uniswap-v4-robinhood/pools")) {
				geckoCalls.push(url);
				return poolResponse(
					"uniswap-v4-robinhood",
					"0x0000000000000000000000000000000000000103",
					{
						address: addresses.VIRTUAL,
						name: "Virtuals Protocol",
						symbol: "VIRTUAL",
					},
					"0",
					"0",
				);
			}
			throw new Error(`Unexpected URL ${url}`);
		}) as typeof fetch;
		const provider = new LiveCandidateProvider(
			loadConfig({
				NODE_ENV: "test",
				INVESTMADE_DEMO_MODE: "true",
				PRIVY_APP_ID: "test",
				PRIVY_APP_SECRET: "test",
				COINGECKO_API_KEY: "demo-key",
			}),
			{ id: "UNISWAP", label: "Uniswap", price: vi.fn() },
			{
				fetcher,
				client: {
					getCode: async () => "0x6000",
					readContract: async () => false,
				},
			},
		);

		const ranking = await provider.getRankingCandidates(20);
		await provider.getRankingCandidates(20);

		expect(geckoCalls).toHaveLength(3);
		expect(ranking).toContainEqual(
			expect.objectContaining({
				symbol: "CASHCAT",
				contract: addresses.CASHCAT,
				liquidityUsd: 150,
				volume24hUsd: 15,
				discoveryProvider: "UNISWAP",
				providerVolumeRank: 2,
				providerVolumeRankTotal: 2,
				coingeckoId: "cash-cat",
				primaryClassification: "CRYPTO",
				marketDataSource: "geckoterminal",
			}),
		);
		expect(ranking).toContainEqual(
			expect.objectContaining({
				symbol: "VIRTUAL",
				contract: addresses.VIRTUAL,
				liquidityUsd: 0,
				volume24hUsd: 0,
				primaryClassification: "UNKNOWN",
			}),
		);
		expect(
			ranking.filter((candidate) => candidate.symbol === "CASHCAT"),
		).toHaveLength(1);
	});
});
