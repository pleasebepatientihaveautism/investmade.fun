import { createPublicClient, http } from "viem";
import {
	AI_RANKING_POOL_SIZE,
	ASSET_REGISTRY,
	DEFAULT_SLOT_BUDGET,
	FEED_PAGE_SIZE,
	isDegenCommunityAsset,
	type RegistryAsset,
	ROBINHOOD_CHAIN_ID,
	USDG_ADDRESS,
} from "../../domain/constants.js";
import type { Candidate, RankingCandidate } from "../../domain/schemas.js";
import type { AppConfig } from "../config.js";
import type {
	CandidateDiscoveryOptions,
	CandidateProvider,
	ExecutionProvider,
} from "./types.js";
import { ExecutionProviderError } from "./types.js";

interface RobinhoodAsset {
	tokenSymbol: string;
	tokenName: string;
	status: string;
	deployments: Array<{ chainId: number; contractAddress: string }>;
}

interface RobinhoodPrice {
	tokenSymbol: string;
	deployments?: Array<{ chainId: number; contractAddress: string }>;
	bid?: string;
	ask?: string;
	dailyTradingVolume?: string;
	mintBurnUsdVolume?: string;
	isTradingHalt: boolean;
	generatedAt: string;
}

type GeckoPool = {
	attributes?: {
		address?: string;
		pool_created_at?: string;
		base_token_price_usd?: string | null;
		quote_token_price_usd?: string | null;
		reserve_in_usd?: string | null;
		volume_usd?: { h24?: string | null };
		price_change_percentage?: { h24?: string | null };
	};
	relationships?: {
		base_token?: { data?: { id?: string } };
		quote_token?: { data?: { id?: string } };
		dex?: { data?: { id?: string } };
	};
};

type GeckoToken = {
	id?: string;
	attributes?: {
		address?: string;
		name?: string;
		symbol?: string;
		decimals?: number;
		coingecko_coin_id?: string | null;
	};
};

type DiscoveredAsset = {
	asset: RegistryAsset;
	coingeckoId?: string;
	liquidityUsd: number;
	volume24hUsd: number;
	primaryPoolVolume24hUsd: number;
	providerVolumeRank: number;
	providerVolumeRankTotal: number;
	priceUsd?: number;
	priceChange24hPct?: number;
	dexes: string[];
	pools: string[];
};

const oraclePausedAbi = [
	{
		type: "function",
		name: "oraclePaused",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "bool" }],
	},
] as const;

const erc20MetadataAbi = [
	{
		type: "function",
		name: "symbol",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "string" }],
	},
	{
		type: "function",
		name: "decimals",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint8" }],
	},
] as const;

type CandidateClient = {
	getCode: (input: {
		address: `0x${string}`;
	}) => Promise<string | undefined>;
	readContract: (
		input:
			| {
					address: `0x${string}`;
					abi: typeof oraclePausedAbi;
					functionName: "oraclePaused";
			  }
			| {
					address: `0x${string}`;
					abi: typeof erc20MetadataAbi;
					functionName: "symbol" | "decimals";
			  },
	) => Promise<unknown>;
};

const FEED_CONCURRENCY = 2;
const REGISTRY_CACHE_MS = 5 * 60_000;
const CONTRACT_CODE_CACHE_MS = 10 * 60_000;
const LIQUIDITY_CACHE_MS = 30_000;
const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";
const ROBINHOOD_UNISWAP_DEXES = [
	"uniswap-v2-robinhood",
	"uniswap-v3-robinhood",
	"uniswap-v4-robinhood",
] as const;

export class LiveCandidateProvider implements CandidateProvider {
	private readonly client: CandidateClient;
	private readonly fetcher: typeof fetch;
	private readonly cache = new Map<
		string,
		{ expiresAt: number; value: unknown }
	>();
	private readonly inFlight = new Map<string, Promise<unknown>>();
	private readonly coingeckoApiKey: string | undefined;

	constructor(
		config: AppConfig,
		private readonly execution: Pick<
			ExecutionProvider,
			"id" | "label" | "price"
		>,
		private readonly options: {
			cryptoOnly?: boolean;
			client?: CandidateClient;
			fetcher?: typeof fetch;
		} = {},
	) {
		this.client =
			options.client ??
			(createPublicClient({
				transport: http(config.ROBINHOOD_RPC_URL),
			}) as unknown as CandidateClient);
		this.fetcher = options.fetcher ?? fetch;
		this.coingeckoApiKey = config.COINGECKO_API_KEY;
	}

	async getAsset(assetId: string): Promise<RegistryAsset | undefined> {
		const staticAsset = staticCryptoAssets().find(
			(asset) => asset.assetId === assetId,
		);
		if (staticAsset) return staticAsset;
		const [{ assets }, discovered] = await Promise.all([
			this.robinhoodCatalog(),
			this.uniswapAssets().catch(() => []),
		]);
		return [
			...assets,
			...discovered.map(({ asset, coingeckoId }) => ({ ...asset, coingeckoId })),
		].find(
			(asset) => asset.assetId === assetId,
		);
	}

	async getRankingCandidates(
		limit = AI_RANKING_POOL_SIZE,
		excludedAssetIds: string[] = [],
		_discoveryOptions: CandidateDiscoveryOptions = {},
	): Promise<RankingCandidate[]> {
		const excluded = new Set(excludedAssetIds);
		const [{ assets, prices }, poolAssets] = await Promise.all([
			this.robinhoodCatalog(),
			this.uniswapAssets().catch(() => []),
		]);
		const knownAddresses = new Set(
			[...staticCryptoAssets(), ...assets].map((asset) =>
				asset.address.toLowerCase(),
			),
		);
		const discovered = poolAssets.filter(
			({ asset }) =>
				!knownAddresses.has(asset.address.toLowerCase()) &&
				!excluded.has(asset.assetId),
		);
		const stocks = this.options.cryptoOnly
			? []
			: assets
					.map((asset) => ({ asset, price: prices.get(asset.symbol) }))
					.sort(
						(left, right) =>
							marketVolume(right.price) - marketVolume(left.price) ||
							left.asset.symbol.localeCompare(right.asset.symbol),
					);
		const crypto = staticCryptoAssets()
			.filter((asset) => !excluded.has(asset.assetId))
			.sort((left, right) => left.symbol.localeCompare(right.symbol));
		return [
			...crypto.map((asset) => ({
				chain: "ROBINHOOD" as const,
				assetId: asset.assetId,
				symbol: asset.symbol,
				name: asset.name,
				kind: asset.kind,
				contract: asset.address,
				decimals: asset.decimals,
				primaryClassification: "CRYPTO" as const,
				classificationConfidence: "HIGH" as const,
				tags: ["crypto"],
				riskFlags: [],
				classificationEvidence: [`robinhood:registry:${asset.symbol}`],
			})),
			...discovered.map((item) => ({
				chain: "ROBINHOOD" as const,
				assetId: item.asset.assetId,
				symbol: item.asset.symbol,
				name: item.asset.name,
				kind: item.asset.kind,
				contract: item.asset.address,
				decimals: item.asset.decimals,
				priceUsd: item.priceUsd,
				volume24hUsd: item.volume24hUsd,
				priceChange24hPct: item.priceChange24hPct,
				liquidityUsd: item.liquidityUsd,
				discoveryProvider: "UNISWAP" as const,
				providerVolumeRank: item.providerVolumeRank,
				providerVolumeRankTotal: item.providerVolumeRankTotal,
				coingeckoId: item.coingeckoId,
				primaryClassification: item.coingeckoId
					? ("CRYPTO" as const)
					: ("UNKNOWN" as const),
				classificationConfidence: item.coingeckoId
					? ("HIGH" as const)
					: ("LOW" as const),
				tags: ["uniswap", ...item.dexes],
				riskFlags: [],
				classificationEvidence: [
					...item.pools.map((pool) => `geckoterminal:pool:${pool}`),
					...(item.coingeckoId ? [`coingecko:coin:${item.coingeckoId}`] : []),
				],
				marketDataSource: "geckoterminal" as const,
			})),
			...stocks.map(({ asset, price }) => ({
				chain: "ROBINHOOD" as const,
				assetId: asset.assetId,
				symbol: asset.symbol,
				name: asset.name,
				kind: asset.kind,
				contract: asset.address,
				decimals: asset.decimals,
				priceUsd: price ? marketPrice(price) : undefined,
				volume24hUsd: marketVolume(price),
				primaryClassification: "TOKENIZED_STOCK" as const,
				classificationConfidence: "HIGH" as const,
				tags: ["stock"],
				riskFlags: [],
				classificationEvidence: [`robinhood:catalog:${asset.symbol}`],
				marketDataSource: price ? ("robinhood" as const) : undefined,
			})),
		]
			.filter((asset) => !excluded.has(asset.assetId))
			.slice(0, limit)
			.map((asset, index) => ({ ...asset, discoveryRank: index + 1 }));
	}

	async getCandidatesForFeed(
		wallet: string,
		rankedAssetIds: string[],
		amountInBaseUnits: string,
		now: Date,
		limit: number,
		txOrigin?: string,
	): Promise<Candidate[]> {
		const [catalog, discovered] = await Promise.all([
			this.robinhoodCatalog(),
			this.uniswapAssets().catch(() => []),
		]);
		const byId = new Map(
			[
				...staticCryptoAssets(),
				...catalog.assets,
				...discovered.map(({ asset }) => asset),
			].map((asset) => [asset.assetId, asset]),
		);
		const assets = rankedAssetIds.flatMap((assetId) => byId.get(assetId) ?? []);
		const candidates = await this.resolvePage(
			assets,
			wallet,
			txOrigin,
			amountInBaseUnits,
			now,
			limit,
			catalog,
			false,
			true,
		);
		return candidates.map(({ quote: _quote, ...candidate }) => candidate);
	}

	async getCandidates(
		wallet: string,
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		requestedLimit = FEED_PAGE_SIZE,
		excludedAssetIds: string[] = [],
		discoveryOptions: CandidateDiscoveryOptions = {},
		txOrigin?: string,
	): Promise<Candidate[]> {
		const [catalog, discovered] = await Promise.all([
			this.robinhoodCatalog(),
			this.uniswapAssets().catch(() => []),
		]);
		const excluded = new Set(excludedAssetIds);
		const assets = [
			...(this.options.cryptoOnly ? [] : catalog.assets),
			...staticCryptoAssets(),
			...discovered.map(({ asset }) => asset),
		].filter(
			(asset) =>
				(discoveryOptions.includeCommunity ||
					!isDegenCommunityAsset(asset.assetId)) &&
				!excluded.has(asset.assetId),
		);
		return this.resolvePage(
			assets,
			wallet,
			txOrigin,
			amountInBaseUnits,
			now,
			requestedLimit,
			catalog,
			true,
			true,
		);
	}

	async getCandidatesForExecution(
		wallet: string,
		assetIds: string[],
		amountInBaseUnits = DEFAULT_SLOT_BUDGET.toString(),
		now = new Date(),
		txOrigin?: string,
	): Promise<Candidate[]> {
		const [catalog, discovered] = await Promise.all([
			this.robinhoodCatalog(),
			this.uniswapAssets().catch(() => []),
		]);
		const byId = new Map(
			[
			...staticCryptoAssets(),
			...catalog.assets,
			...discovered.map(({ asset }) => asset),
			].map((asset) => [asset.assetId, asset]),
		);
		for (const assetId of assetIds) {
			if (byId.has(assetId)) continue;
			const asset = await this.addressAsset(assetId);
			if (asset) byId.set(assetId, asset);
		}
		const assets = assetIds.flatMap((assetId) => byId.get(assetId) ?? []);
		const candidates: Candidate[] = [];
		for (const asset of assets) {
			const candidate = await this.resolveCandidate(
				asset,
				wallet,
				txOrigin,
				amountInBaseUnits,
				now,
				catalog,
				false,
			);
			if (candidate) candidates.push(candidate);
		}
		return candidates;
	}

	private async addressAsset(assetId: string): Promise<RegistryAsset | undefined> {
		const address = /^rh:4663:(0x[a-fA-F0-9]{40})$/.exec(assetId)?.[1];
		if (!address) return;
		try {
			const [symbol, decimals] = await Promise.all([
				this.client.readContract({
					address: address as `0x${string}`,
					abi: erc20MetadataAbi,
					functionName: "symbol",
				}),
				this.client.readContract({
					address: address as `0x${string}`,
					abi: erc20MetadataAbi,
					functionName: "decimals",
				}),
			]);
			if (
				typeof symbol !== "string" ||
				!symbol.trim() ||
				typeof decimals !== "number" ||
				!Number.isInteger(decimals) ||
				decimals < 0 ||
				decimals > 255
			) {
				return;
			}
			return {
				assetId,
				symbol: symbol.trim(),
				name: symbol.trim(),
				kind: "CRYPTO",
				address,
				decimals,
			};
		} catch {
			return;
		}
	}

	private async resolvePage(
		assets: RegistryAsset[],
		wallet: string,
		txOrigin: string | undefined,
		amountInBaseUnits: string,
		now: Date,
		requestedLimit: number,
		catalog: RobinhoodCatalog,
		includeQuote: boolean,
		feedOnly = false,
	): Promise<Candidate[]> {
		const target = Math.max(1, Math.min(requestedLimit, assets.length));
		const candidates: Candidate[] = [];
		for (
			let index = 0;
			index < assets.length && candidates.length < target;
			index += FEED_CONCURRENCY
		) {
			const batch = await Promise.all(
				assets
					.slice(index, index + FEED_CONCURRENCY)
					.map((asset) =>
						this.resolveCandidate(
							asset,
							wallet,
							txOrigin,
							amountInBaseUnits,
							now,
							catalog,
							includeQuote,
							feedOnly,
						),
					),
			);
			for (const candidate of batch) {
				if (candidate) candidates.push(candidate);
			}
		}
		return candidates.slice(0, target);
	}

	private async resolveCandidate(
		asset: RegistryAsset,
		wallet: string,
		txOrigin: string | undefined,
		amountInBaseUnits: string,
		_now: Date,
		catalog: RobinhoodCatalog,
		includeQuote: boolean,
		feedOnly = false,
	): Promise<Candidate | undefined> {
		try {
			let marketPriceUsd: number | undefined;
			let marketDataSource: Candidate["marketDataSource"];
			if (!feedOnly) {
				const contractCode = await this.cached(
					`code:${asset.address.toLowerCase()}`,
					CONTRACT_CODE_CACHE_MS,
					() => this.client.getCode({ address: asset.address as `0x${string}` }),
				);
				if (!contractCode || contractCode === "0x") return;
			}

			if (!feedOnly && asset.kind === "STOCK_TOKEN") {
				const sourceAsset = catalog.sourceAssets.get(asset.symbol);
				const price = catalog.prices.get(asset.symbol);
				const assetDeployment = canonicalDeployment(sourceAsset?.deployments);
				const priceDeployment = canonicalDeployment(price?.deployments);
				if (
					sourceAsset?.status !== "ASSET_STATUS_ACTIVE" ||
					!assetDeployment ||
					assetDeployment.contractAddress.toLowerCase() !==
						asset.address.toLowerCase() ||
					!price ||
					price.isTradingHalt ||
					!validGeneratedAt(price.generatedAt) ||
					(priceDeployment &&
						priceDeployment.contractAddress.toLowerCase() !==
							asset.address.toLowerCase())
				) {
					return;
				}
				const oraclePaused = await this.client.readContract({
					address: asset.address as `0x${string}`,
					abi: oraclePausedAbi,
					functionName: "oraclePaused",
				});
				if (oraclePaused !== false) return;
				marketPriceUsd = marketPrice(price);
				if (!(marketPriceUsd > 0)) return;
				marketDataSource = "robinhood";
			}

			const seed: Candidate = {
				...asset,
				chain: "ROBINHOOD",
				contract: asset.address,
				eligible: true,
				marketHealthy: true,
				permissionAllowed: true,
				marketPriceUsd,
				marketDataSource,
				crowdScoreBps: 0,
				reason: `Robinhood Chain asset. Execution is checked by ${this.execution.label}.`,
				evidenceIds: [`rh:asset:${asset.address.toLowerCase()}`],
			};
			if (!includeQuote) return seed;
			if (!txOrigin) throw new Error("EXECUTION_TX_ORIGIN_REQUIRED");
			const quote = await this.cached(
				`${this.execution.id}:price:${wallet.toLowerCase()}:${txOrigin.toLowerCase()}:${asset.address.toLowerCase()}:${amountInBaseUnits}`,
				LIQUIDITY_CACHE_MS,
				() =>
					this.execution.price(wallet, txOrigin, seed, amountInBaseUnits, 50),
			);
			return {
				...seed,
				chain: "ROBINHOOD" as const,
				quote,
				marketPriceUsd: seed.marketPriceUsd ?? Number(quote.unitPriceUsd),
				marketDataSource:
					seed.marketDataSource ??
					(this.execution.id === "ZERO_EX" ? "0x" : "uniswap"),
				evidenceIds: [
					...seed.evidenceIds,
					`${this.execution.id.toLowerCase()}:${quote.requestId}`,
				],
			};
		} catch (error) {
			if (error instanceof ExecutionProviderError) {
				console.warn(
					JSON.stringify({
						event: "candidate_excluded",
						provider: error.provider,
						assetId: asset.assetId,
						reason: error.code,
					}),
				);
			}
			return;
		}
	}

	private async robinhoodCatalog(): Promise<RobinhoodCatalog> {
		return this.cached("robinhood:catalog", REGISTRY_CACHE_MS, async () => {
			const [assetsResponse, pricesResponse] = await Promise.all([
				this.fetcher("https://api.robinhood.com/rhj/assets", {
					signal: AbortSignal.timeout(8_000),
				}),
				this.fetcher("https://api.robinhood.com/rhj/prices", {
					signal: AbortSignal.timeout(8_000),
				}),
			]);
			if (!assetsResponse.ok) {
				throw new Error(`ROBINHOOD_ASSETS_${assetsResponse.status}`);
			}
			if (!pricesResponse.ok) {
				throw new Error(`ROBINHOOD_PRICES_${pricesResponse.status}`);
			}
			const assetBody = (await assetsResponse.json()) as {
				assets?: RobinhoodAsset[];
			};
			const priceBody = (await pricesResponse.json()) as {
				quotes?: RobinhoodPrice[];
			};
			const sourceAssets = new Map(
				(assetBody.assets ?? []).map((asset) => [asset.tokenSymbol, asset]),
			);
			const prices = new Map(
				(priceBody.quotes ?? []).map((price) => [price.tokenSymbol, price]),
			);
			const assets = (assetBody.assets ?? []).flatMap((asset) => {
				const deployment = canonicalDeployment(asset.deployments);
				if (
					asset.status !== "ASSET_STATUS_ACTIVE" ||
					!deployment ||
					!/^0x[a-fA-F0-9]{40}$/.test(deployment.contractAddress)
				) {
					return [];
				}
				return [
					{
						assetId: `rh:${ROBINHOOD_CHAIN_ID}:${asset.tokenSymbol}`,
						symbol: asset.tokenSymbol,
						name:
							asset.tokenName
								?.replace(/\s*[•·-]\s*Robinhood Token\s*$/i, "")
								.trim() || `${asset.tokenSymbol} stock token`,
						kind: "STOCK_TOKEN" as const,
						address: deployment.contractAddress,
						decimals: 18,
					},
				];
			});
			return { assets, sourceAssets, prices };
		});
	}

	private async uniswapAssets(): Promise<DiscoveredAsset[]> {
		return this.cached(
			"geckoterminal:robinhood:uniswap",
			REGISTRY_CACHE_MS,
			async () => {
				const responses = await Promise.all(
					ROBINHOOD_UNISWAP_DEXES.map((dex) =>
						this.fetcher(
							`${COINGECKO_API_URL}/onchain/networks/robinhood/dexes/${dex}/pools?include=base_token,quote_token,dex&sort=h24_volume_usd_desc&page=1`,
							{
								headers: this.coingeckoApiKey
									? { "x-cg-demo-api-key": this.coingeckoApiKey }
									: undefined,
								signal: AbortSignal.timeout(10_000),
							},
						),
					),
				);
				const payloads = await Promise.all(
					responses.map(async (response, index) => {
						if (!response.ok) {
							throw new Error(
								`GECKOTERMINAL_${ROBINHOOD_UNISWAP_DEXES[index]}_${response.status}`,
							);
						}
						return (await response.json()) as {
							data?: GeckoPool[];
							included?: GeckoToken[];
						};
					}),
				);
				const byAddress = new Map<string, DiscoveredAsset>();
				for (const payload of payloads) {
					const providerVolumeRankTotal = payload.data?.length ?? 0;
					const tokens = new Map(
						(payload.included ?? []).flatMap((token) =>
							token.id ? [[token.id, token.attributes] as const] : [],
						),
					);
					for (const [poolIndex, pool] of (payload.data ?? []).entries()) {
						const poolAddress = pool.attributes?.address;
						const dex = pool.relationships?.dex?.data?.id;
						for (const [side, relationship] of [
							["base", pool.relationships?.base_token],
							["quote", pool.relationships?.quote_token],
						] as const) {
							const token = relationship?.data?.id
								? tokens.get(relationship.data.id)
								: undefined;
							if (
								!token?.address ||
								!/^0x[a-fA-F0-9]{40}$/.test(token.address) ||
								token.address.toLowerCase() === USDG_ADDRESS.toLowerCase() ||
								staticCryptoAssets().some(
									(asset) =>
										asset.address.toLowerCase() ===
										token.address?.toLowerCase(),
								)
							) {
								continue;
							}
							const address = token.address.toLowerCase();
							const current = byAddress.get(address);
							const priceUsd = positiveNumber(
								side === "base"
									? pool.attributes?.base_token_price_usd
									: pool.attributes?.quote_token_price_usd,
							);
							const liquidityUsd = positiveNumber(
								pool.attributes?.reserve_in_usd,
							);
							const volume24hUsd = positiveNumber(
								pool.attributes?.volume_usd?.h24,
							);
							const priceChange24hPct = finiteNumber(
								pool.attributes?.price_change_percentage?.h24,
							);
							if (current) {
								current.liquidityUsd += liquidityUsd ?? 0;
								current.volume24hUsd += volume24hUsd ?? 0;
								if (
									(volume24hUsd ?? 0) > current.primaryPoolVolume24hUsd
								) {
									current.primaryPoolVolume24hUsd = volume24hUsd ?? 0;
									current.providerVolumeRank = poolIndex + 1;
									current.providerVolumeRankTotal = providerVolumeRankTotal;
								}
								current.priceUsd ??= priceUsd;
								current.priceChange24hPct ??= priceChange24hPct;
								if (dex && !current.dexes.includes(dex))
									current.dexes.push(dex);
								if (poolAddress && !current.pools.includes(poolAddress)) {
									current.pools.push(poolAddress);
								}
								continue;
							}
							const symbol = token.symbol?.trim();
							const name = token.name?.trim();
							if (!symbol || !name || !Number.isInteger(token.decimals))
								continue;
							byAddress.set(address, {
								asset: {
									assetId: `rh:${ROBINHOOD_CHAIN_ID}:${address}`,
									symbol,
									name,
									kind: "CRYPTO",
									address: token.address,
									decimals: token.decimals as number,
								},
								coingeckoId: token.coingecko_coin_id ?? undefined,
								liquidityUsd: liquidityUsd ?? 0,
								volume24hUsd: volume24hUsd ?? 0,
								primaryPoolVolume24hUsd: volume24hUsd ?? 0,
								providerVolumeRank: poolIndex + 1,
								providerVolumeRankTotal,
								priceUsd,
								priceChange24hPct,
								dexes: dex ? [dex] : [],
								pools: poolAddress ? [poolAddress] : [],
							});
						}
					}
				}
				return [...byAddress.values()].sort(
					(left, right) =>
						right.volume24hUsd - left.volume24hUsd ||
						right.liquidityUsd - left.liquidityUsd ||
						left.asset.symbol.localeCompare(right.asset.symbol),
				);
			},
		);
	}

	private async cached<T>(
		key: string,
		ttlMs: number,
		load: () => Promise<T>,
	): Promise<T> {
		const cached = this.cache.get(key);
		if (cached && cached.expiresAt > Date.now()) return cached.value as T;
		const pending = this.inFlight.get(key);
		if (pending) return pending as Promise<T>;
		const request = load()
			.then((value) => {
				this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
				return value;
			})
			.finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, request);
		return request;
	}
}

type RobinhoodCatalog = {
	assets: RegistryAsset[];
	sourceAssets: Map<string, RobinhoodAsset>;
	prices: Map<string, RobinhoodPrice>;
};

function staticCryptoAssets(): RegistryAsset[] {
	return Object.values(ASSET_REGISTRY).filter(
		(asset) => asset.kind === "CRYPTO",
	);
}

function canonicalDeployment(
	deployments: Array<{ chainId: number; contractAddress: string }> | undefined,
) {
	return deployments?.find(
		(deployment) => deployment.chainId === ROBINHOOD_CHAIN_ID,
	);
}

function marketPrice(price: RobinhoodPrice): number {
	const bid = Number(price.bid);
	const ask = Number(price.ask);
	if (bid > 0 && ask > 0) return (bid + ask) / 2;
	return bid > 0 ? bid : ask > 0 ? ask : 0;
}

function marketVolume(price: RobinhoodPrice | undefined): number {
	if (!price) return 0;
	const mintBurnUsdVolume = Number(price.mintBurnUsdVolume);
	const dailyTradingVolume = Number(price.dailyTradingVolume);
	const dailyTradingUsd =
		Number.isFinite(dailyTradingVolume) && dailyTradingVolume > 0
			? dailyTradingVolume * marketPrice(price)
			: 0;
	return Math.max(
		Number.isFinite(mintBurnUsdVolume) && mintBurnUsdVolume > 0
			? mintBurnUsdVolume
			: 0,
		dailyTradingUsd,
	);
}

function validGeneratedAt(value: string): boolean {
	return Number.isFinite(new Date(value).getTime());
}

function positiveNumber(value: string | null | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function finiteNumber(value: string | null | undefined): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}
