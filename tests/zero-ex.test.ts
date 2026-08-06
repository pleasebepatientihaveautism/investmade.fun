import { decodeFunctionData } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { USDG_ADDRESS } from "../src/domain/constants.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import { ZeroExProvider } from "../src/server/adapters/zero-ex.js";

const wallet = "0x71f30000000000000000000000000000000009a2";
const txOrigin = "0x71f30000000000000000000000000000000009a3";
const spender = "0x0000000000001fF3684f28c67538d4D072C22734";
const settler = "0x0000000000000000000000000000000000001234";
const approveAbi = [
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

afterEach(() => vi.restoreAllMocks());

async function candidates() {
	return (
		await new DemoProvider().getCandidatesForExecution(wallet, [
			"rh:4663:WETH",
			"rh:4663:AAPL",
		])
	).slice(0, 2);
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("TEST_FIXTURE_MISSING");
	return value;
}

function quoteResponse(buyToken: string, index = 1, allowanceTarget = spender) {
	return {
		zid: `0x-zid-${index}`,
		liquidityAvailable: true,
		sellToken: USDG_ADDRESS,
		buyToken,
		sellAmount: "10000000",
		buyAmount: "1000000000000000000",
		minBuyAmount: "995000000000000000",
		estimatedPriceImpact: "0.0005",
		allowanceTarget,
		issues: {
			allowance: { spender: allowanceTarget, actual: "0" },
			balance: null,
			simulationIncomplete: false,
		},
		fees: {
			zeroExFee: {
				type: "volume",
				token: USDG_ADDRESS,
				amount: "1000",
			},
			integratorFee: null,
		},
		transaction: {
			to: settler,
			data: index === 1 ? "0x1234" : "0x5678",
			value: "0",
			gas: "200000",
			gasPrice: "1",
		},
	};
}

describe("0x AllowanceHolder execution", () => {
	it("uses authenticated actor parameters and builds one exact approval before atomic swaps", async () => {
		const assets = await candidates();
		const requests: Array<{ url: URL; init?: RequestInit }> = [];
		let index = 0;
		const fetcher = vi.fn(
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(String(input));
				requests.push({ url, init });
				const candidate = assets[index];
				index += 1;
				return Response.json(
					quoteResponse(required(candidate).contract, index),
				);
			},
		) as typeof fetch;
		const provider = new ZeroExProvider("server-secret", fetcher);

		const result = await provider.prepare(
			wallet,
			{
				sessionId: "session",
				chainId: 4663,
				inputToken: USDG_ADDRESS,
				periodLimitUsd: 100,
				selections: assets.map((asset) => ({
					assetId: asset.assetId,
					amountInBaseUnits: "10000000",
				})),
				slippageBps: 50,
			},
			assets,
			txOrigin,
		);

		expect(requests).toHaveLength(2);
		for (const { url, init } of requests) {
			expect(url.pathname).toBe("/swap/allowance-holder/quote");
			expect(url.searchParams.get("chainId")).toBe("4663");
			expect(url.searchParams.get("taker")).toBe(wallet);
			expect(url.searchParams.get("recipient")).toBe(wallet);
			expect(url.searchParams.get("txOrigin")).toBe(txOrigin);
			expect(url.searchParams.get("slippageBps")).toBe("50");
			expect(new Headers(init?.headers).get("0x-api-key")).toBe(
				"server-secret",
			);
			expect(new Headers(init?.headers).get("0x-version")).toBe("v2");
		}
		expect(result.quotes[0]).toMatchObject({
			requestId: "0x-zid-1",
			routing: "ZERO_EX",
			priceImpactBps: 5,
			fees: [{ type: "zeroExFee", token: USDG_ADDRESS, amount: "1000" }],
		});
		const firstQuote = required(result.quotes[0]);
		expect(
			new Date(firstQuote.expiresAt).getTime() -
				new Date(firstQuote.quotedAt).getTime(),
		).toBe(30_000);
		expect(result.walletCalls.map((call) => call.kind)).toEqual([
			"APPROVAL",
			"SWAP",
			"SWAP",
		]);
		const approval = required(result.walletCalls[0]);
		expect(approval.transaction.to).toBe(USDG_ADDRESS);
		expect(approval.transaction.to).not.toBe(settler);
		const decoded = decodeFunctionData({
			abi: approveAbi,
			data: approval.transaction.data as `0x${string}`,
		});
		expect(decoded.functionName).toBe("approve");
		expect(decoded.args).toEqual([spender, 20_000_000n]);
		expect(
			result.walletCalls.slice(1).map((call) => call.transaction.to),
		).toEqual([settler, settler]);
	});

	it("approves the exact stock amount and quotes the reverse stock-to-USDG exit", async () => {
		const candidate = required((await candidates())[1]);
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			expect(url.searchParams.get("sellToken")).toBe(candidate.contract);
			expect(url.searchParams.get("buyToken")).toBe(USDG_ADDRESS);
			return Response.json({
				...quoteResponse(USDG_ADDRESS),
				sellToken: candidate.contract,
				buyToken: USDG_ADDRESS,
				sellAmount: "123",
				buyAmount: "1000000",
				minBuyAmount: "995000",
			});
		}) as typeof fetch;

		const result = await new ZeroExProvider(
			"server-secret",
			fetcher,
		).prepareExit(wallet, candidate, "123", 50, txOrigin);
		expect(result.walletCalls.map((call) => call.kind)).toEqual([
			"APPROVAL",
			"SWAP",
		]);
		const approval = required(result.walletCalls[0]);
		expect(approval.transaction.to).toBe(candidate.contract);
		const decoded = decodeFunctionData({
			abi: approveAbi,
			data: approval.transaction.data as `0x${string}`,
		});
		expect(decoded.args).toEqual([spender, 123n]);
	});

	it("fails closed when basket quotes use different allowance spenders", async () => {
		const assets = await candidates();
		let index = 0;
		const fetcher = vi.fn(async () => {
			const candidate = required(assets[index]);
			const target =
				index++ === 0 ? spender : "0x0000000000000000000000000000000000004567";
			return Response.json(quoteResponse(candidate.contract, index, target));
		}) as typeof fetch;
		await expect(
			new ZeroExProvider("server-secret", fetcher).prepare(
				wallet,
				{
					sessionId: "session",
					chainId: 4663,
					inputToken: USDG_ADDRESS,
					periodLimitUsd: 100,
					selections: assets.map((asset) => ({
						assetId: asset.assetId,
						amountInBaseUnits: "10000000",
					})),
					slippageBps: 50,
				},
				assets,
				txOrigin,
			),
		).rejects.toThrow("ZERO_EX_MISMATCHED_ALLOWANCE_TARGETS");
	});

	it("identifies an unauthorized basket leg without preparing a partial transaction", async () => {
		const assets = await candidates();
		let index = 0;
		const fetcher = vi.fn(async () => {
			const candidate = required(assets[index]);
			index += 1;
			if (index === 2) {
				return Response.json(
					{
						reason:
							"The buy token is not authorized for trade due to legal restrictions",
					},
					{ status: 422 },
				);
			}
			return Response.json(quoteResponse(candidate.contract, index));
		}) as typeof fetch;

		const result = await new ZeroExProvider("server-secret", fetcher).prepare(
			wallet,
			{
				sessionId: "session",
				chainId: 4663,
				inputToken: USDG_ADDRESS,
				periodLimitUsd: 100,
				selections: assets.map((asset) => ({
					assetId: asset.assetId,
					amountInBaseUnits: "10000000",
				})),
				slippageBps: 50,
			},
			assets,
			txOrigin,
		);

		expect(result).toEqual({
			quotes: [],
			walletCalls: [],
			unavailableAssetIds: [required(assets[1]).assetId],
		});
	});

	it("rejects malformed transactions and never substitutes transaction.to as spender", async () => {
		const candidate = required((await candidates())[0]);
		const malformed = {
			...quoteResponse(candidate.contract),
			transaction: { to: settler, data: "0x", value: "0" },
		};
		const fetcher = vi.fn(async () => Response.json(malformed)) as typeof fetch;
		await expect(
			new ZeroExProvider("server-secret", fetcher).prepare(
				wallet,
				{
					sessionId: "session",
					chainId: 4663,
					inputToken: USDG_ADDRESS,
					periodLimitUsd: 100,
					selections: [
						{ assetId: candidate.assetId, amountInBaseUnits: "10000000" },
					],
					slippageBps: 50,
				},
				[candidate],
				txOrigin,
			),
		).rejects.toThrow("ZERO_EX_MALFORMED_TRANSACTION");
	});

	it("ignores browsing-only balance and allowance warnings but rejects them for execution", async () => {
		const candidate = required((await candidates())[0]);
		const warned = {
			...quoteResponse(candidate.contract),
			issues: {
				allowance: { spender, actual: "0" },
				balance: { actual: "0", expected: "10000000" },
				simulationIncomplete: true,
			},
		};
		const fetcher = vi.fn(async () => Response.json(warned)) as typeof fetch;
		const provider = new ZeroExProvider("server-secret", fetcher);
		await expect(
			provider.price(wallet, txOrigin, candidate, "10000000", 50),
		).resolves.toMatchObject({ routing: "ZERO_EX" });
		await expect(
			provider.prepare(
				wallet,
				{
					sessionId: "session",
					chainId: 4663,
					inputToken: USDG_ADDRESS,
					periodLimitUsd: 100,
					selections: [
						{ assetId: candidate.assetId, amountInBaseUnits: "10000000" },
					],
					slippageBps: 50,
				},
				[candidate],
				txOrigin,
			),
		).rejects.toThrow("ZERO_EX_BALANCE_DEFICIENCY");
	});

	it("rejects a response that does not prove the requested token pair", async () => {
		const candidate = required((await candidates())[0]);
		const fetcher = vi.fn(async () =>
			Response.json({
				...quoteResponse(candidate.contract),
				buyToken: "0x0000000000000000000000000000000000009999",
			}),
		) as typeof fetch;
		await expect(
			new ZeroExProvider("server-secret", fetcher).price(
				wallet,
				txOrigin,
				candidate,
				"10000000",
				50,
			),
		).rejects.toThrow("ZERO_EX_WRONG_BUY_TOKEN");
	});
});
