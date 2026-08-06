import { encodeFunctionData, isAddress } from "viem";
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

const API_BASE = "https://api.0x.org";
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

type ZeroExIssues = {
	allowance?: { spender?: unknown; actual?: unknown } | null;
	balance?: { actual?: unknown; expected?: unknown } | null;
	simulationIncomplete?: unknown;
};

type ZeroExResponse = {
	zid?: unknown;
	chainId?: unknown;
	liquidityAvailable?: unknown;
	sellToken?: unknown;
	buyToken?: unknown;
	sellAmount?: unknown;
	buyAmount?: unknown;
	minBuyAmount?: unknown;
	estimatedPriceImpact?: unknown;
	allowanceTarget?: unknown;
	issues?: ZeroExIssues;
	fees?: Record<string, unknown>;
	transaction?: Record<string, unknown>;
};

export class ZeroExProvider implements ExecutionProvider {
	readonly id = "ZERO_EX" as const;
	readonly label = "0x";

	constructor(
		private readonly apiKey: string,
		private readonly fetcher: typeof fetch = fetch,
	) {
		if (!apiKey) throw new Error("ZERO_EX_API_KEY_REQUIRED");
	}

	async health() {
		return { available: true, status: "CONFIGURED" as const };
	}

	async prepareBasket(
		wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		txOrigin?: string,
	) {
		const actor = validateActor(wallet, txOrigin);
		const byId = new Map(
			candidates.map((candidate) => [candidate.assetId, candidate]),
		);
		const prepared: Array<{
			quote: Quote;
			spender: string;
			swap: WalletCall;
		}> = [];
		const unavailableAssetIds: string[] = [];

		for (const selection of request.selections) {
			const candidate = byId.get(selection.assetId);
			if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
			try {
				const body = await this.request(
					"quote",
					actor,
					USDG_ADDRESS,
					candidate.contract,
					selection.amountInBaseUnits,
					request.slippageBps,
				);
				const validated = validateResponse(body, {
					actor,
					sellToken: USDG_ADDRESS,
					buyToken: candidate.contract,
					sellAmount: selection.amountInBaseUnits,
					execution: true,
				});
				const quote = summarizeQuote(
					body,
					candidate,
					selection.amountInBaseUnits,
					candidate.contract,
				);
				rejectExcessiveImpact(candidate, quote);
				prepared.push({
					quote,
					spender: validated.spender,
					swap: {
						kind: "SWAP",
						assetId: candidate.assetId,
						transaction: validated.transaction,
					},
				});
			} catch (error) {
				if (isTokenAuthorizationRejection(error)) {
					unavailableAssetIds.push(candidate.assetId);
					continue;
				}
				throw error;
			}
		}

		if (unavailableAssetIds.length) {
			return {
				quotes: [],
				walletCalls: [],
				unavailableAssetIds,
			};
		}

		const spender = requireSharedSpender(prepared.map((item) => item.spender));
		const total = request.selections.reduce(
			(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
			0n,
		);
		return {
			quotes: prepared.map((item) => item.quote),
			walletCalls: [
				approvalCall(actor.wallet, USDG_ADDRESS, spender, total),
				...prepared.map((item) => item.swap),
			],
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
		txOrigin?: string,
	) {
		if (BigInt(amountInBaseUnits) <= 0n)
			throw new Error("EXIT_AMOUNT_REQUIRED");
		const actor = validateActor(wallet, txOrigin);
		const body = await this.request(
			"quote",
			actor,
			candidate.contract,
			USDG_ADDRESS,
			amountInBaseUnits,
			slippageBps,
		);
		const validated = validateResponse(body, {
			actor,
			sellToken: candidate.contract,
			buyToken: USDG_ADDRESS,
			sellAmount: amountInBaseUnits,
			execution: true,
		});
		const quote = summarizeQuote(
			body,
			candidate,
			amountInBaseUnits,
			USDG_ADDRESS,
		);
		rejectExcessiveImpact(candidate, quote);
		return {
			quote,
			walletCalls: [
				approvalCall(
					actor.wallet,
					candidate.contract,
					validated.spender,
					BigInt(amountInBaseUnits),
				),
				{
					kind: "SWAP" as const,
					assetId: candidate.assetId,
					transaction: validated.transaction,
				},
			],
		};
	}

	async price(
		wallet: string,
		txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		slippageBps: number,
	): Promise<Quote> {
		const actor = validateActor(wallet, txOrigin);
		const body = await this.request(
			"price",
			actor,
			USDG_ADDRESS,
			candidate.contract,
			amountInBaseUnits,
			slippageBps,
		);
		validateResponse(body, {
			actor,
			sellToken: USDG_ADDRESS,
			buyToken: candidate.contract,
			sellAmount: amountInBaseUnits,
			execution: false,
		});
		const quote = summarizeQuote(
			body,
			candidate,
			amountInBaseUnits,
			candidate.contract,
		);
		rejectExcessiveImpact(candidate, quote);
		return quote;
	}

	private async request(
		endpoint: "price" | "quote",
		actor: { wallet: string; txOrigin: string },
		sellToken: string,
		buyToken: string,
		sellAmount: string,
		slippageBps: number,
	): Promise<ZeroExResponse> {
		const query = new URLSearchParams({
			chainId: String(ROBINHOOD_CHAIN_ID),
			sellToken,
			buyToken,
			sellAmount,
			taker: actor.wallet,
			recipient: actor.wallet,
			txOrigin: actor.txOrigin,
			slippageBps: String(slippageBps),
		});
		const response = await this.fetcher(
			`${API_BASE}/swap/allowance-holder/${endpoint}?${query}`,
			{
				headers: {
					"0x-api-key": this.apiKey,
					"0x-version": "v2",
				},
				signal: AbortSignal.timeout(endpoint === "quote" ? 12_000 : 8_000),
			},
		);
		const body = (await response.json()) as ZeroExResponse & {
			reason?: unknown;
			message?: unknown;
		};
		if (!response.ok) {
			const reason = safeErrorSuffix(body.reason ?? body.message);
			const rawReason = String(body.reason ?? body.message ?? "");
			console.error(
				JSON.stringify({
					event: "execution_provider_error",
					provider: this.id,
					endpoint,
					status: response.status,
					reason: rawReason,
				}),
			);
			throw normalizeZeroExError(response.status, rawReason, reason);
		}
		return body;
	}
}

function isTokenAuthorizationRejection(error: unknown) {
	return (
		error instanceof ExecutionProviderError &&
		error.code === "TOKEN_UNAUTHORIZED"
	);
}

function validateActor(wallet: string, txOrigin?: string) {
	if (!isAddress(wallet) || !txOrigin || !isAddress(txOrigin)) {
		throw new Error("ZERO_EX_INVALID_ACTOR");
	}
	return { wallet: wallet.toLowerCase(), txOrigin: txOrigin.toLowerCase() };
}

function validateResponse(
	body: ZeroExResponse,
	expected: {
		actor: { wallet: string; txOrigin: string };
		sellToken: string;
		buyToken: string;
		sellAmount: string;
		execution: boolean;
	},
): { spender: string; transaction: WalletCall["transaction"] } {
	if (body.liquidityAvailable !== true) {
		throw new Error("ZERO_EX_LIQUIDITY_UNAVAILABLE");
	}
	if (
		body.chainId !== undefined &&
		Number(body.chainId) !== ROBINHOOD_CHAIN_ID
	) {
		throw new Error("ZERO_EX_WRONG_CHAIN");
	}
	validateToken(body.sellToken, expected.sellToken, "SELL");
	validateToken(body.buyToken, expected.buyToken, "BUY");
	if (
		body.sellAmount !== undefined &&
		String(body.sellAmount) !== expected.sellAmount
	) {
		throw new Error("ZERO_EX_WRONG_SELL_AMOUNT");
	}
	requirePositiveInteger(body.buyAmount, "ZERO_EX_ZERO_OUTPUT");
	requirePositiveInteger(body.minBuyAmount, "ZERO_EX_ZERO_MIN_OUTPUT");

	if (expected.execution) {
		const balance = body.issues?.balance;
		if (
			balance &&
			parseUnsigned(balance.actual) < parseUnsigned(balance.expected)
		) {
			throw new Error("ZERO_EX_BALANCE_DEFICIENCY");
		}
		if (body.issues?.simulationIncomplete === true) {
			throw new Error("ZERO_EX_SIMULATION_INCOMPLETE");
		}
	}

	const allowanceSpender = optionalAddress(body.issues?.allowance?.spender);
	const allowanceTarget = optionalAddress(body.allowanceTarget);
	if (
		allowanceSpender &&
		allowanceTarget &&
		allowanceSpender.toLowerCase() !== allowanceTarget.toLowerCase()
	) {
		throw new Error("ZERO_EX_ALLOWANCE_TARGET_MISMATCH");
	}
	const spender = allowanceSpender ?? allowanceTarget;
	if (!spender) throw new Error("ZERO_EX_ALLOWANCE_TARGET_MISSING");

	if (!expected.execution) {
		return {
			spender,
			transaction: emptyTransaction(expected.actor.wallet),
		};
	}
	return {
		spender,
		transaction: validateTransaction(body.transaction, expected.actor.wallet),
	};
}

function validateTransaction(
	raw: Record<string, unknown> | undefined,
	wallet: string,
): WalletCall["transaction"] {
	const to = optionalAddress(raw?.to);
	const data = typeof raw?.data === "string" ? raw.data : "";
	const value = String(raw?.value ?? "0");
	const responseChainId = raw?.chainId;
	if (
		!to ||
		!/^0x(?:[0-9a-fA-F]{2})+$/.test(data) ||
		!/^[0-9]+$/.test(value) ||
		value !== "0" ||
		(responseChainId !== undefined &&
			Number(responseChainId) !== ROBINHOOD_CHAIN_ID)
	) {
		throw new Error("ZERO_EX_MALFORMED_TRANSACTION");
	}
	return {
		to,
		from: wallet,
		data,
		value,
		chainId: ROBINHOOD_CHAIN_ID,
		gasLimit: optionalUnsigned(raw?.gas),
		gasPrice: optionalUnsigned(raw?.gasPrice),
		maxFeePerGas: optionalUnsigned(raw?.maxFeePerGas),
		maxPriorityFeePerGas: optionalUnsigned(raw?.maxPriorityFeePerGas),
	};
}

function summarizeQuote(
	body: ZeroExResponse,
	candidate: Candidate,
	amountInBaseUnits: string,
	tokenOut: string,
): Quote {
	const estimatedAmountOut = String(body.buyAmount);
	const minimumAmountOut = String(body.minBuyAmount);
	const now = new Date();
	return {
		requestId: String(body.zid ?? crypto.randomUUID()),
		provider: "ZERO_EX",
		chain: "ROBINHOOD",
		assetId: candidate.assetId,
		tokenOut,
		amountInBaseUnits,
		estimatedAmountOut,
		minimumAmountOut,
		unitPriceUsd: unitPriceUsdFromQuote(
			amountInBaseUnits,
			estimatedAmountOut,
			candidate.decimals,
		),
		priceImpactBps: priceImpactBps(body.estimatedPriceImpact),
		routing: "ZERO_EX",
		fees: normalizeFees(body.fees),
		providerEvidence: {
			requestId: String(body.zid ?? ""),
			flow: "ALLOWANCE_HOLDER",
		},
		quotedAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
	};
}

function normalizeZeroExError(
	status: number,
	rawReason: string,
	safeReason: string,
) {
	const normalized = rawReason.toLowerCase();
	if (normalized.includes("not authorized") || normalized.includes("unauthorized")) {
		return new ExecutionProviderError(
			"ZERO_EX",
			"TOKEN_UNAUTHORIZED",
			`ZERO_EX_TOKEN_UNAUTHORIZED${safeReason}`,
			rawReason,
		);
	}
	if (status === 404 || normalized.includes("liquidity")) {
		return new ExecutionProviderError(
			"ZERO_EX",
			"INSUFFICIENT_LIQUIDITY",
			`ZERO_EX_INSUFFICIENT_LIQUIDITY${safeReason}`,
			rawReason,
		);
	}
	if (normalized.includes("chain")) {
		return new ExecutionProviderError(
			"ZERO_EX",
			"UNSUPPORTED_CHAIN",
			`ZERO_EX_UNSUPPORTED_CHAIN${safeReason}`,
			rawReason,
		);
	}
	if (normalized.includes("token") || status === 400) {
		return new ExecutionProviderError(
			"ZERO_EX",
			"INVALID_TOKEN",
			`ZERO_EX_INVALID_TOKEN${safeReason}`,
			rawReason,
		);
	}
	return new ExecutionProviderError(
		"ZERO_EX",
		"PROVIDER_UNAVAILABLE",
		`ZERO_EX_PROVIDER_UNAVAILABLE_${status}`,
		rawReason,
	);
}

function approvalCall(
	wallet: string,
	token: string,
	spender: string,
	amount: bigint,
): WalletCall {
	if (amount <= 0n || !isAddress(token) || !isAddress(spender)) {
		throw new Error("ZERO_EX_INVALID_APPROVAL");
	}
	return {
		kind: "APPROVAL",
		transaction: {
			to: token,
			from: wallet,
			data: encodeFunctionData({
				abi: erc20ApproveAbi,
				functionName: "approve",
				args: [spender, amount],
			}),
			value: "0",
			chainId: ROBINHOOD_CHAIN_ID,
		},
	};
}

function requireSharedSpender(spenders: string[]): string {
	const first = spenders[0];
	if (!first) throw new Error("ZERO_EX_ALLOWANCE_TARGET_MISSING");
	if (
		spenders.some((spender) => spender.toLowerCase() !== first.toLowerCase())
	) {
		throw new Error("ZERO_EX_MISMATCHED_ALLOWANCE_TARGETS");
	}
	return first;
}

function rejectExcessiveImpact(candidate: Candidate, quote: Quote) {
	const limit = isDegenCommunityAsset(candidate.assetId)
		? MAX_DEGEN_PRICE_IMPACT_BPS
		: MAX_PRICE_IMPACT_BPS;
	if (quote.priceImpactBps > limit) {
		throw new Error("ZERO_EX_EXCESSIVE_PRICE_IMPACT");
	}
}

function priceImpactBps(value: unknown): number {
	if (value === null || value === undefined || value === "") return 0;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error("ZERO_EX_INVALID_PRICE_IMPACT");
	}
	return Math.round(parsed * 10_000);
}

function normalizeFees(
	fees: Record<string, unknown> | undefined,
): Quote["fees"] {
	if (!fees) return [];
	return Object.entries(fees).flatMap(([type, raw]) => {
		if (!raw || typeof raw !== "object") return [];
		const fee = raw as Record<string, unknown>;
		const token = optionalAddress(fee.token);
		const amount = optionalUnsigned(fee.amount);
		return token && amount ? [{ type, token, amount }] : [];
	});
}

function validateToken(value: unknown, expected: string, side: "SELL" | "BUY") {
	if (
		typeof value !== "string" ||
		value.toLowerCase() !== expected.toLowerCase()
	) {
		throw new Error(`ZERO_EX_WRONG_${side}_TOKEN`);
	}
}

function requirePositiveInteger(value: unknown, error: string) {
	if (parseUnsigned(value) <= 0n) throw new Error(error);
}

function parseUnsigned(value: unknown): bigint {
	const normalized = String(value ?? "");
	if (!/^[0-9]+$/.test(normalized)) throw new Error("ZERO_EX_INVALID_AMOUNT");
	return BigInt(normalized);
}

function optionalUnsigned(value: unknown): string | undefined {
	if (value === undefined || value === null) return;
	const normalized = String(value);
	return /^[0-9]+$/.test(normalized) ? normalized : undefined;
}

function optionalAddress(value: unknown): string | undefined {
	return typeof value === "string" && isAddress(value) ? value : undefined;
}

function emptyTransaction(wallet: string): WalletCall["transaction"] {
	return {
		to: wallet,
		from: wallet,
		data: "0x00",
		value: "0",
		chainId: ROBINHOOD_CHAIN_ID,
	};
}

function safeErrorSuffix(value: unknown): string {
	if (typeof value !== "string") return "";
	const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
	return safe ? `_${safe}` : "";
}
