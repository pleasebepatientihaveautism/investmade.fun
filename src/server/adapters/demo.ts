import { randomUUID } from "node:crypto";
import { sha256 } from "../../domain/canonical.js";
import {
	ASSET_REGISTRY,
	DEFAULT_SLOT_BUDGET,
	FEED_PAGE_SIZE,
	isDegenCommunityAsset,
} from "../../domain/constants.js";
import { unitPriceUsdFromQuote } from "../../domain/price.js";
import type {
	Candidate,
	ExecutionProviderId,
	ExecutionRequest,
	FeedInput,
	FeedOutput,
	RankingCandidate,
	RankingInput,
	RankingOutput,
} from "../../domain/schemas.js";
import type {
	CandidateDiscoveryOptions,
	CandidateProvider,
	ExecutionProvider,
	PrivateInferenceProvider,
} from "./types.js";

const outputs: Record<string, string> = {
	WETH: "3113000000000000",
	GME: "468000000000000000",
	NVDA: "48070000000000000",
	SPCX: "89300000000000000",
	MSTR: "89000000000000000",
	GOOGL: "31460000000000000",
	AAPL: "29780000000000000",
	RDDT: "47890000000000000",
	MSFT: "22200000000000000",
	TSLA: "30780000000000000",
	COST: "10000000000000000",
	MU: "200000000000000000",
	STEEL: "200000000000000000",
	YOINK: "1000000000000000000000",
};

function demoRouting(id: ExecutionProviderId): "ZERO_EX" | "CLASSIC" {
	return id === "ZERO_EX" ? "ZERO_EX" : "CLASSIC";
}
const demoMeta: Record<
	string,
	{ priceImpactBps: number; crowdScoreBps: number; reason: string }
> = {
	WETH: {
		priceImpactBps: 19,
		crowdScoreBps: 6_100,
		reason: "Positive crypto breadth and an executable low-impact route.",
	},
	GME: {
		priceImpactBps: 38,
		crowdScoreBps: 5_781,
		reason: "Strong market activity and a fresh Robinhood Chain token route.",
	},
	NVDA: {
		priceImpactBps: 31,
		crowdScoreBps: 5_340,
		reason: "Healthy market state and a current route within the policy limit.",
	},
	SPCX: {
		priceImpactBps: 24,
		crowdScoreBps: 5_120,
		reason:
			"Fresh tokenized market exposure with a low estimated route impact.",
	},
	MSTR: {
		priceImpactBps: 28,
		crowdScoreBps: 5_010,
		reason: "Active market state and a fresh route within the policy limit.",
	},
	GOOGL: {
		priceImpactBps: 26,
		crowdScoreBps: 4_920,
		reason: "Healthy market state and a fresh executable route.",
	},
	AAPL: {
		priceImpactBps: 33,
		crowdScoreBps: 4_810,
		reason: "Strong crowd signal with acceptable estimated route impact.",
	},
	RDDT: {
		priceImpactBps: 21,
		crowdScoreBps: 4_700,
		reason: "Fresh tokenized stock route within the execution guardrails.",
	},
	MSFT: {
		priceImpactBps: 41,
		crowdScoreBps: 4_590,
		reason: "Steady crowd preference and a low-impact tokenized stock route.",
	},
	TSLA: {
		priceImpactBps: 18,
		crowdScoreBps: 4_480,
		reason: "Active market state and a fresh route within the policy limit.",
	},
	COST: {
		priceImpactBps: 22,
		crowdScoreBps: 4_370,
		reason: "Eligible consumer exposure with a current executable route.",
	},
	MU: {
		priceImpactBps: 25,
		crowdScoreBps: 4_260,
		reason: "Eligible semiconductor exposure with a current executable route.",
	},
	STEEL: {
		priceImpactBps: 85,
		crowdScoreBps: 8_200,
		reason:
			"Degen community token with a fresh executable route and elevated volatility.",
	},
	YOINK: {
		priceImpactBps: 92,
		crowdScoreBps: 8_050,
		reason:
			"Degen community token with a fresh executable route and elevated volatility.",
	},
};

export class DemoProvider
	implements CandidateProvider, PrivateInferenceProvider, ExecutionProvider
{
	readonly label: string;

	constructor(readonly id: ExecutionProviderId = "ZERO_EX") {
		this.label = id === "ZERO_EX" ? "0x demo" : "Uniswap demo";
	}

	async health() {
		return { available: true, status: "CONFIGURED" as const };
	}

	async getRankingCandidates(
		limit: number,
		excludedAssetIds: string[] = [],
		discoveryOptions: CandidateDiscoveryOptions = {},
	): Promise<RankingCandidate[]> {
		const excluded = new Set(excludedAssetIds);
		return Object.values(ASSET_REGISTRY)
			.filter(
				(asset) =>
					Boolean(outputs[asset.symbol] && demoMeta[asset.symbol]) &&
					(discoveryOptions.includeCommunity ||
						!isDegenCommunityAsset(asset.assetId)) &&
					!excluded.has(asset.assetId),
			)
			.sort(
				(left, right) =>
					Number(isDegenCommunityAsset(right.assetId)) -
					Number(isDegenCommunityAsset(left.assetId)),
			)
			.slice(0, limit)
			.map((asset, index) => ({
				chain: "ROBINHOOD" as const,
				assetId: asset.assetId,
				symbol: asset.symbol,
				name: asset.name,
				kind: asset.kind,
				contract: asset.address,
				decimals: asset.decimals,
				discoveryRank: index + 1,
				primaryClassification:
					asset.kind === "STOCK_TOKEN"
						? ("TOKENIZED_STOCK" as const)
						: ("CRYPTO" as const),
				classificationConfidence: "HIGH" as const,
				tags: [asset.kind === "STOCK_TOKEN" ? "stock" : "crypto"],
				riskFlags: [],
				classificationEvidence: [`demo:registry:${asset.symbol}`],
				marketDataSource: "demo" as const,
			}));
	}

	async getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const candidates = await this.getCandidates(
			wallet,
			amountInBaseUnits,
			now,
			Object.keys(outputs).length,
			[],
			{ includeCommunity: true },
		);
		const byId = new Map(
			candidates.map((candidate) => [candidate.assetId, candidate]),
		);
		return rankedAssetIds
			.flatMap((assetId) => byId.get(assetId) ?? [])
			.slice(0, limit)
			.map(({ quote: _quote, ...candidate }) => candidate);
	}

	async getCandidates(
		_wallet: string,
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		limit = FEED_PAGE_SIZE,
		excludedAssetIds: string[] = [],
		discoveryOptions: CandidateDiscoveryOptions = {},
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const excluded = new Set(excludedAssetIds);
		const expiresAt = new Date(now.getTime() + 60_000).toISOString();
		const amount = BigInt(amountInBaseUnits);
		return Object.values(ASSET_REGISTRY)
			.filter(
				(asset) =>
					Boolean(outputs[asset.symbol] && demoMeta[asset.symbol]) &&
					(discoveryOptions.includeCommunity ||
						!isDegenCommunityAsset(asset.assetId)) &&
					!excluded.has(asset.assetId),
			)
			.sort(
				(left, right) =>
					Number(isDegenCommunityAsset(right.assetId)) -
					Number(isDegenCommunityAsset(left.assetId)),
			)
			.slice(0, limit)
			.map((asset) => {
				const baseEstimate = outputs[asset.symbol];
				const meta = demoMeta[asset.symbol];
				if (!baseEstimate || !meta)
					throw new Error(`DEMO_FIXTURE_MISSING_${asset.symbol}`);
				const estimated = (
					(BigInt(baseEstimate) * amount) /
					DEFAULT_SLOT_BUDGET
				).toString();
				const minimum = ((BigInt(estimated) * 995n) / 1000n).toString();
				const unitPriceUsd = unitPriceUsdFromQuote(
					amountInBaseUnits,
					estimated,
					asset.decimals,
				);
				return {
					...asset,
					chain: "ROBINHOOD" as const,
					contract: asset.address,
					eligible: true,
					marketHealthy: true,
					permissionAllowed: true,
					marketPriceUsd: Number(unitPriceUsd),
					marketDataSource: "demo" as const,
					quote: {
						requestId: `demo-quote-${asset.symbol.toLowerCase()}-${randomUUID()}`,
						provider: this.id,
						chain: "ROBINHOOD" as const,
						assetId: asset.assetId,
						tokenOut: asset.address,
						amountInBaseUnits,
						estimatedAmountOut: estimated,
						minimumAmountOut: minimum,
						unitPriceUsd,
						priceImpactBps: meta.priceImpactBps,
						routing: demoRouting(this.id),
						quotedAt: now.toISOString(),
						expiresAt,
					},
					crowdScoreBps: meta.crowdScoreBps,
					reason: meta.reason,
					evidenceIds: [
						`demo:market:${asset.symbol}`,
						`demo:crowd:${asset.symbol}`,
						`demo:quote:${asset.symbol}`,
					],
				};
			});
	}

	async getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		_txOrigin?: string,
	): Promise<Candidate[]> {
		const selected = new Set(assetIds);
		return (
			await this.getCandidates(
				wallet,
				amountInBaseUnits,
				now,
				Object.keys(outputs).length,
			)
		).filter((candidate) => selected.has(candidate.assetId));
	}

	async rank(input: RankingInput) {
		const assets = input.candidates.map((candidate, index) => ({
			assetId: candidate.assetId,
			rank: index + 1,
			scoreBps: 7_420 - index * 410,
			reason: `Demo preference match for ${candidate.symbol}.`,
		}));
		const output: RankingOutput = {
			schemaVersion: "investmade-ranking-output/v1",
			sessionId: input.sessionId,
			inputCommitment: input.inputCommitment,
			policyVersion: "investmade-policy/v1",
			regime: "CRYPTO_BULLISH",
			assets,
			warnings: [
				"Demo evidence is deterministic and cannot be used for mainnet execution.",
			],
		};
		return {
			output,
			receipt: {
				network: "LOCAL_DEMO",
				model: "deterministic-fixture/v1",
				provider: "local",
				teeVerified: false,
				inputCommitment: input.inputCommitment,
				outputCommitment: sha256(output),
			},
		};
	}

	async generate(input: FeedInput, candidates: Candidate[]) {
		const output: FeedOutput = {
			schemaVersion: "investmade-feed-output/v1",
			sessionId: input.sessionId,
			inputCommitment: input.inputCommitment,
			policyVersion: "investmade-policy/v1",
			regime: "CRYPTO_BULLISH",
			cards: candidates.map((candidate, index) => ({
				assetId: candidate.assetId,
				action: "BUY",
				rank: index + 1,
				amountInBaseUnits: input.budget.slotBudgetBaseUnits,
				scoreBps: 7_420 - index * 410,
				evidenceIds: candidate.evidenceIds,
				reason: candidate.reason,
			})),
			warnings: [
				"Demo evidence is deterministic and cannot be used for mainnet execution.",
			],
		};
		return {
			output,
			receipt: {
				network: "LOCAL_DEMO",
				model: "deterministic-fixture/v1",
				provider: "local",
				teeVerified: false,
				inputCommitment: input.inputCommitment,
				outputCommitment: sha256(output),
			},
		};
	}

	async prepareBasket(
		_wallet: string,
		request: ExecutionRequest,
		candidates: Candidate[],
		_txOrigin?: string,
	) {
		const selected = new Set(
			request.selections.map((selection) => selection.assetId),
		);
		return {
			quotes: candidates
				.filter((candidate) => selected.has(candidate.assetId))
				.flatMap((candidate) => candidate.quote ?? []),
			walletCalls: [],
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

	async price(
		wallet: string,
		_txOrigin: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		_slippageBps: number,
	) {
		const priced = await this.getCandidatesForExecution(
			wallet,
			[candidate.assetId],
			amountInBaseUnits,
		);
		const quote = priced[0]?.quote;
		if (!quote) throw new Error("DEMO_QUOTE_UNAVAILABLE");
		return quote;
	}

	async prepareExit(
		_wallet: string,
		candidate: Candidate,
		amountInBaseUnits: string,
		_slippageBps: number,
		_txOrigin?: string,
	) {
		const now = new Date();
		return {
			quote: {
				requestId: `demo-exit-${candidate.symbol.toLowerCase()}-${randomUUID()}`,
				provider: this.id,
				chain: "ROBINHOOD" as const,
				assetId: candidate.assetId,
				tokenOut: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const,
				amountInBaseUnits,
				estimatedAmountOut: DEFAULT_SLOT_BUDGET.toString(),
				minimumAmountOut: ((DEFAULT_SLOT_BUDGET * 995n) / 1000n).toString(),
				unitPriceUsd: "1",
				priceImpactBps: demoMeta[candidate.symbol]?.priceImpactBps ?? 0,
				routing: demoRouting(this.id),
				quotedAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + 60_000).toISOString(),
			},
			walletCalls: [],
		};
	}
}
