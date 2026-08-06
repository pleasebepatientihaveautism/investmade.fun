import { decodeFunctionData, isAddress } from "viem";
import {
	isDegenCommunityAsset,
	MAX_DEGEN_PRICE_IMPACT_BPS,
	MAX_PRICE_IMPACT_BPS,
	ROBINHOOD_CHAIN_ID,
	USDG_ADDRESS,
} from "../../domain/constants.js";
import { unitPriceUsdFromQuote } from "../../domain/price.js";
import type {
	Candidate,
	ExecutionRequest,
	Quote,
} from "../../domain/schemas.js";
import {
	ExecutionProviderError,
	type ExecutionProvider,
	type WalletCall,
} from "./types.js";

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const ROUTER_VERSION = "2.1.1";
const ROBINHOOD_UNIVERSAL_ROUTER =
	"0x8876789976decbfcbbbe364623c63652db8c0904";
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const QUOTE_TTL_MS = 30_000;
const erc20ApproveAbi = [
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

type UniswapQuoteResponse = {
	requestId?: unknown;
	routing?: unknown;
	quote?: Record<string, unknown>;
	permitData?: unknown;
	permitTransaction?: unknown;
};

export class UniswapProvider implements ExecutionProvider {
	readonly id = "UNISWAP" as const;
	readonly label = "Uniswap";

	constructor(
		private readonly apiKey: string,
		private readonly fetcher: typeof fetch = fetch,
	) {
		if (!apiKey) throw new Error("UNISWAP_API_KEY_REQUIRED");
	}

	async price(
		wallet: string,
		_txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
	) {
		const body = await this.quotePair(
			wallet,
			USDG_ADDRESS,
			candidate.contract,
			amountInBaseUnits,
			slippageBps,
			false,
		);
		return summarizeQuote(body, candidate, amountInBaseUnits, candidate.contract);
	}

	async health() {
		return { available: true, status: "CONFIGURED" as const };
	}

	async prepareBasket(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		_txOrigin?: string,
	) {
		const actor = validateWallet(wallet);
		const byId = new Map(
			candidates.map((candidate) => [candidate.assetId, candidate]),
		);
		const total = request.selections.reduce(
			(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
			0n,
		);
		const approvalCalls = await this.approvalCalls(
			actor,
			USDG_ADDRESS,
			total,
		);
		const quotes: Quote[] = [];
		const permits: WalletCall[] = [];
		const swaps: WalletCall[] = [];

		// ponytail: serial preparation avoids provider bursts and preserves call order.
		for (const selection of request.selections) {
			const candidate = byId.get(selection.assetId);
			if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
			const quoteResponse = await this.quotePair(
				actor,
				USDG_ADDRESS,
				candidate.contract,
				selection.amountInBaseUnits,
				request.slippageBps,
				true,
			);
			requireClassicRoute(quoteResponse);
			const permit = validatePermitTransaction(
				quoteResponse.permitTransaction,
				actor,
			);
			if (permit) permits.push({ kind: "PERMIT", transaction: permit });
			const swap = await this.swap(quoteResponse);
			quotes.push(
				summarizeQuote(
					quoteResponse,
					candidate,
					selection.amountInBaseUnits,
					candidate.contract,
				),
			);
			swaps.push({
				kind: "SWAP",
				assetId: candidate.assetId,
				transaction: validateSwapTransaction(swap.swap, actor),
			});
		}
		return {
			quotes,
			walletCalls: [...approvalCalls, ...dedupeCalls(permits), ...swaps],
		};
	}

	async prepare(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		txOrigin?: string,
	) {
		return this.prepareBasket(wallet, request, candidates, txOrigin);
	}

	async prepareExit(
		wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
		_txOrigin?: string,
	) {
		if (BigInt(amountInBaseUnits) <= 0n)
			throw new Error("EXIT_AMOUNT_REQUIRED");
		const actor = validateWallet(wallet);
		const approvalCalls = await this.approvalCalls(
			actor,
			candidate.contract,
			BigInt(amountInBaseUnits),
		);
		const quoteResponse = await this.quotePair(
			actor,
			candidate.contract,
			USDG_ADDRESS,
			amountInBaseUnits,
			slippageBps,
			true,
		);
		requireClassicRoute(quoteResponse);
		const permit = validatePermitTransaction(
			quoteResponse.permitTransaction,
			actor,
		);
		const swap = await this.swap(quoteResponse);
		return {
			quote: summarizeQuote(
				quoteResponse,
				candidate,
				amountInBaseUnits,
				USDG_ADDRESS,
			),
			walletCalls: [
				...approvalCalls,
				...(permit ? [{ kind: "PERMIT" as const, transaction: permit }] : []),
				{
					kind: "SWAP" as const,
					assetId: candidate.assetId,
					transaction: validateSwapTransaction(swap.swap, actor),
				},
			],
		};
	}

	private async quotePair(
		wallet: string,
		tokenIn: string,
		tokenOut: string,
		amount: string,
		slippageBps: number,
		forExecution: boolean,
	): Promise<UniswapQuoteResponse> {
		return this.request("quote", {
			type: "EXACT_INPUT",
			amount,
			tokenInChainId: ROBINHOOD_CHAIN_ID,
			tokenOutChainId: ROBINHOOD_CHAIN_ID,
			tokenIn,
			tokenOut,
			swapper: wallet,
			slippageTolerance: slippageBps / 100,
			routingPreference: "BEST_PRICE",
			protocols: ["V2", "V3", "V4"],
			...(forExecution
				? { generatePermitAsTransaction: true, permitAmount: "FULL" }
				: {}),
		});
	}

	private async approvalCalls(
		wallet: string,
		token: string,
		amount: bigint,
	): Promise<WalletCall[]> {
		const body = await this.request("check_approval", {
			walletAddress: wallet,
			token,
			amount: amount.toString(),
			chainId: ROBINHOOD_CHAIN_ID,
		});
		return [
			...(body.cancel
				? [
						{
							kind: "CANCEL_APPROVAL" as const,
							transaction: validateApprovalTransaction(
								body.cancel,
								wallet,
								token,
								0n,
							),
						},
					]
				: []),
			...(body.approval
				? [
						{
							kind: "APPROVAL" as const,
							transaction: validateApprovalTransaction(
								body.approval,
								wallet,
								token,
								amount,
							),
						},
					]
				: []),
		];
	}

	private async swap(quoteResponse: UniswapQuoteResponse) {
		const quote = quoteResponse.quote;
		if (!quote) throw new Error("UNISWAP_QUOTE_PAYLOAD_MISSING");
		return this.request("swap", {
			quote,
			...(quoteResponse.permitData
				? { permitData: quoteResponse.permitData }
				: {}),
			safetyMode: "SAFE",
			deadline: Math.floor(Date.now() / 1000) + 30,
		});
	}

	private async request(
		endpoint: "quote" | "check_approval" | "swap",
		payload: Record<string, unknown>,
	): Promise<Record<string, any>> {
		const response = await this.fetcher(`${API_BASE}/${endpoint}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-api-key": this.apiKey,
				"x-universal-router-version": ROUTER_VERSION,
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(endpoint === "quote" ? 12_000 : 10_000),
		});
		const body = (await response.json()) as Record<string, any>;
		if (!response.ok) {
			const rawReason = String(body.detail ?? body.message ?? body.error ?? "");
			console.error(
				JSON.stringify({
					event: "execution_provider_error",
					provider: this.id,
					endpoint,
					status: response.status,
					reason: rawReason,
				}),
			);
			throw normalizeUniswapError(response.status, rawReason);
		}
		return body;
	}
}

function summarizeQuote(
	body: UniswapQuoteResponse,
	candidate: Candidate,
	amountInBaseUnits: string,
	tokenOut: string,
): Quote {
	requireClassicRoute(body);
	const quote = body.quote ?? {};
	const output = quote.output as Record<string, unknown> | undefined;
	const aggregated = Array.isArray(quote.aggregatedOutputs)
		? (quote.aggregatedOutputs[0] as Record<string, unknown> | undefined)
		: undefined;
	const estimated = String(output?.amount ?? quote.amountOut ?? "0");
	const minimum = String(
		output?.minimumAmount ??
			aggregated?.minAmount ??
			quote.amountOutMinimum ??
			"0",
	);
	if (!/^[0-9]+$/.test(estimated) || BigInt(estimated) <= 0n) {
		throw new ExecutionProviderError(
			"UNISWAP",
			"INSUFFICIENT_LIQUIDITY",
			"UNISWAP_ZERO_OUTPUT",
		);
	}
	if (!/^[0-9]+$/.test(minimum) || BigInt(minimum) <= 0n) {
		throw new ExecutionProviderError(
			"UNISWAP",
			"INSUFFICIENT_LIQUIDITY",
			"UNISWAP_ZERO_MINIMUM_OUTPUT",
		);
	}
	const now = new Date();
	const result: Quote = {
		requestId: String(body.requestId ?? crypto.randomUUID()),
		provider: "UNISWAP",
		chain: "ROBINHOOD",
		assetId: candidate.assetId,
		tokenOut,
		amountInBaseUnits,
		estimatedAmountOut: estimated,
		minimumAmountOut: minimum,
		unitPriceUsd: unitPriceUsdFromQuote(
			amountInBaseUnits,
			estimated,
			candidate.decimals,
		),
		priceImpactBps: normalizePriceImpact(quote.priceImpact),
		routing: "CLASSIC",
		providerEvidence: {
			requestId: String(body.requestId ?? ""),
			router: ROBINHOOD_UNIVERSAL_ROUTER,
			routerVersion: ROUTER_VERSION,
		},
		quotedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
	};
	const maximumImpact = isDegenCommunityAsset(candidate.assetId)
		? MAX_DEGEN_PRICE_IMPACT_BPS
		: MAX_PRICE_IMPACT_BPS;
	if (result.priceImpactBps > maximumImpact) {
		throw new ExecutionProviderError(
			"UNISWAP",
			"INSUFFICIENT_LIQUIDITY",
			"UNISWAP_EXCESSIVE_PRICE_IMPACT",
		);
	}
	return result;
}

function validateApprovalTransaction(
	raw: unknown,
	wallet: string,
	token: string,
	minimumAmount: bigint,
) {
	const transaction = validateTransaction(raw, wallet);
	if (transaction.to.toLowerCase() !== token.toLowerCase()) {
		throw new Error("UNISWAP_APPROVAL_TOKEN_MISMATCH");
	}
	const decoded = decodeFunctionData({
		abi: erc20ApproveAbi,
		data: transaction.data as `0x${string}`,
	});
	if (
		decoded.functionName !== "approve" ||
		decoded.args[0].toLowerCase() !== PERMIT2 ||
		decoded.args[1] < minimumAmount
	) {
		throw new Error("UNISWAP_UNSAFE_APPROVAL");
	}
	return transaction;
}

function validatePermitTransaction(raw: unknown, wallet: string) {
	if (!raw) return;
	const transaction = validateTransaction(raw, wallet);
	if (transaction.to.toLowerCase() !== PERMIT2) {
		throw new Error("UNISWAP_UNSAFE_PERMIT_TARGET");
	}
	return transaction;
}

function validateSwapTransaction(raw: unknown, wallet: string) {
	const transaction = validateTransaction(raw, wallet);
	if (transaction.to.toLowerCase() !== ROBINHOOD_UNIVERSAL_ROUTER) {
		throw new Error("UNISWAP_UNSAFE_ROUTER_TARGET");
	}
	return transaction;
}

function validateTransaction(
	raw: unknown,
	wallet: string,
): WalletCall["transaction"] {
	const value = raw as Record<string, unknown> | undefined;
	const to = typeof value?.to === "string" ? value.to : "";
	const from = typeof value?.from === "string" ? value.from : "";
	const data = typeof value?.data === "string" ? value.data : "";
	const nativeValue = unsignedDecimal(value?.value ?? "0");
	if (
		!isAddress(to) ||
		!isAddress(from) ||
		from.toLowerCase() !== wallet.toLowerCase() ||
		!/^0x(?:[0-9a-fA-F]{2})+$/.test(data) ||
		nativeValue === undefined ||
		nativeValue !== "0" ||
		Number(value?.chainId) !== ROBINHOOD_CHAIN_ID
	) {
		throw new Error("INVALID_UNISWAP_TRANSACTION");
	}
	return {
		to,
		from,
		data,
		value: nativeValue,
		chainId: ROBINHOOD_CHAIN_ID,
		gasLimit: optionalUnsigned(value?.gasLimit),
		maxFeePerGas: optionalUnsigned(value?.maxFeePerGas),
		maxPriorityFeePerGas: optionalUnsigned(value?.maxPriorityFeePerGas),
		gasPrice: optionalUnsigned(value?.gasPrice),
	};
}

function requireClassicRoute(body: UniswapQuoteResponse) {
	if (body.routing !== "CLASSIC") {
		throw new ExecutionProviderError(
			"UNISWAP",
			"INSUFFICIENT_LIQUIDITY",
			`UNISWAP_ATOMIC_ROUTE_UNAVAILABLE_${String(body.routing ?? "UNKNOWN")}`,
		);
	}
}

function normalizeUniswapError(status: number, reason: string) {
	const normalized = reason.toLowerCase();
	if (
		normalized.includes("unsupported token") ||
		normalized.includes("permission") ||
		normalized.includes("unauthorized")
	) {
		return new ExecutionProviderError(
			"UNISWAP",
			"TOKEN_UNAUTHORIZED",
			"UNISWAP_TOKEN_UNAUTHORIZED",
			reason,
		);
	}
	if (
		status === 404 ||
		normalized.includes("no quote") ||
		normalized.includes("no route") ||
		normalized.includes("liquidity")
	) {
		return new ExecutionProviderError(
			"UNISWAP",
			"INSUFFICIENT_LIQUIDITY",
			"UNISWAP_INSUFFICIENT_LIQUIDITY",
			reason,
		);
	}
	if (normalized.includes("chain")) {
		return new ExecutionProviderError(
			"UNISWAP",
			"UNSUPPORTED_CHAIN",
			"UNISWAP_UNSUPPORTED_CHAIN",
			reason,
		);
	}
	if (status === 400 && normalized.includes("token")) {
		return new ExecutionProviderError(
			"UNISWAP",
			"INVALID_TOKEN",
			"UNISWAP_INVALID_TOKEN",
			reason,
		);
	}
	return new ExecutionProviderError(
		"UNISWAP",
		"PROVIDER_UNAVAILABLE",
		`UNISWAP_PROVIDER_UNAVAILABLE_${status}`,
		reason,
	);
}

function validateWallet(wallet: string) {
	if (!isAddress(wallet)) throw new Error("UNISWAP_INVALID_ACTOR");
	return wallet.toLowerCase();
}

function normalizePriceImpact(value: unknown) {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed < 0)
		throw new Error("UNISWAP_INVALID_PRICE_IMPACT");
	return Math.round(parsed * 100);
}

function optionalUnsigned(value: unknown) {
	if (value === undefined || value === null) return;
	return unsignedDecimal(value);
}

function unsignedDecimal(value: unknown) {
	const normalized = String(value);
	if (/^[0-9]+$/.test(normalized)) return BigInt(normalized).toString();
	if (/^0x[0-9a-fA-F]+$/.test(normalized)) return BigInt(normalized).toString();
	return;
}

function dedupeCalls(calls: WalletCall[]) {
	const seen = new Set<string>();
	return calls.filter((call) => {
		const key = `${call.transaction.to.toLowerCase()}:${call.transaction.data.toLowerCase()}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
