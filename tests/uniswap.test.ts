import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";
import { USDG_ADDRESS } from "../src/domain/constants.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import { UniswapProvider } from "../src/server/adapters/uniswap.js";
import { ExecutionProviderError } from "../src/server/adapters/types.js";

const wallet = "0x71f30000000000000000000000000000000009a2";
const permit2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const router = "0x8876789976decbfcbbbe364623c63652db8c0904";
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

function transaction(to: string, data = "0x12") {
	return { to, from: wallet, data, value: "0", chainId: 4663 };
}

function quoteResponse(tokenOut: string) {
	return {
		requestId: "uniswap-quote-1",
		routing: "CLASSIC",
		quote: {
			output: { token: tokenOut, amount: "1000000000000000", minimumAmount: "990000000000000" },
			priceImpact: 0.1,
		},
		permitTransaction: transaction(permit2, "0x1234"),
	};
}

async function demoCandidate() {
	const [candidate] = await new DemoProvider("UNISWAP").getCandidatesForExecution(
		wallet,
		["rh:4663:WETH"],
	);
	if (!candidate) throw new Error("TEST_CANDIDATE_REQUIRED");
	return candidate;
}

describe("Uniswap Trading API execution", () => {
	it("isolates Permit2 approval and Universal Router calls in atomic order", async () => {
		const candidate = await demoCandidate();
		const requests: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const endpoint = String(input).split("/").at(-1) ?? "";
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			requests.push({ endpoint, body });
			if (endpoint === "check_approval") {
				return Response.json({
					approval: transaction(
						USDG_ADDRESS,
						encodeFunctionData({
							abi: approveAbi,
							functionName: "approve",
							args: [permit2, 10_000_000n],
						}),
					),
				});
			}
			if (endpoint === "quote") return Response.json(quoteResponse(candidate.contract));
			if (endpoint === "swap") return Response.json({ swap: transaction(router, "0xabcd") });
			throw new Error(`UNEXPECTED_ENDPOINT_${endpoint}`);
		}) as typeof fetch;
		const provider = new UniswapProvider("server-uniswap-secret", fetcher);
		const prepared = await provider.prepareBasket(
			wallet,
			{
				sessionId: "session-1",
				chainId: 4663,
				inputToken: USDG_ADDRESS,
				periodLimitUsd: 100,
				selections: [{ assetId: candidate.assetId, amountInBaseUnits: "10000000" }],
				slippageBps: 50,
			},
			[candidate],
		);

		expect(prepared.quotes[0]).toMatchObject({
			provider: "UNISWAP",
			routing: "CLASSIC",
			providerEvidence: { router, routerVersion: "2.1.1" },
		});
		expect(prepared.walletCalls.map((call) => call.kind)).toEqual([
			"APPROVAL",
			"PERMIT",
			"SWAP",
		]);
		expect(prepared.walletCalls.map((call) => call.transaction.to.toLowerCase())).toEqual([
			USDG_ADDRESS.toLowerCase(),
			permit2,
			router,
		]);
		expect(requests.map((request) => request.endpoint)).toEqual([
			"check_approval",
			"quote",
			"swap",
		]);
		expect(JSON.stringify(requests)).not.toContain("server-uniswap-secret");
	});

	it("prepares reverse exits with token approval isolated from the swap router", async () => {
		const candidate = await demoCandidate();
		const quoteBodies: Record<string, unknown>[] = [];
		const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const endpoint = String(input).split("/").at(-1);
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			if (endpoint === "check_approval") {
				return Response.json({
					approval: transaction(
						candidate.contract,
						encodeFunctionData({
							abi: approveAbi,
							functionName: "approve",
							args: [permit2, 1_000n],
						}),
					),
				});
			}
			if (endpoint === "quote") {
				quoteBodies.push(body);
				return Response.json(quoteResponse(USDG_ADDRESS));
			}
			if (endpoint === "swap") return Response.json({ swap: transaction(router, "0xabcd") });
			throw new Error(`UNEXPECTED_ENDPOINT_${endpoint}`);
		}) as typeof fetch;

		const result = await new UniswapProvider("server-secret", fetcher).prepareExit(
			wallet,
			candidate,
			"1000",
			50,
		);
		expect(result.quote).toMatchObject({
			provider: "UNISWAP",
			tokenOut: USDG_ADDRESS,
		});
		expect(quoteBodies[0]).toMatchObject({
			tokenIn: candidate.contract,
			tokenOut: USDG_ADDRESS,
			tokenInChainId: 4663,
			tokenOutChainId: 4663,
		});
		expect(result.walletCalls.map((call) => call.kind)).toEqual([
			"APPROVAL",
			"PERMIT",
			"SWAP",
		]);
	});

	it("rejects approval calldata that targets anything other than Permit2", async () => {
		const candidate = await demoCandidate();
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			const endpoint = String(input).split("/").at(-1);
			if (endpoint !== "check_approval") throw new Error("SHOULD_NOT_CONTINUE");
			return Response.json({
				approval: transaction(
					USDG_ADDRESS,
					encodeFunctionData({
						abi: approveAbi,
						functionName: "approve",
						args: [router, 10_000_000n],
					}),
				),
			});
		}) as typeof fetch;
		await expect(
			new UniswapProvider("server-secret", fetcher).prepareBasket(
				wallet,
				{
					sessionId: "session-1",
					chainId: 4663,
					inputToken: USDG_ADDRESS,
					periodLimitUsd: 100,
					selections: [{ assetId: candidate.assetId, amountInBaseUnits: "10000000" }],
					slippageBps: 50,
				},
				[candidate],
			),
		).rejects.toThrow("UNISWAP_UNSAFE_APPROVAL");
	});

	it("normalizes upstream no-route errors without returning the upstream payload", async () => {
		const candidate = await demoCandidate();
		const fetcher = vi.fn(async () =>
			Response.json(
				{ detail: "No route with sufficient liquidity for this token" },
				{ status: 404 },
			),
		) as typeof fetch;
		const error = await new UniswapProvider("server-secret", fetcher)
			.price(wallet, wallet, candidate, "10000000", 50)
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(ExecutionProviderError);
		expect(error).toMatchObject({
			provider: "UNISWAP",
			code: "INSUFFICIENT_LIQUIDITY",
			message: "UNISWAP_INSUFFICIENT_LIQUIDITY",
		});
	});
});
