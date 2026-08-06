import { randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { type Address, createPublicClient, formatUnits, http } from "viem";
import { ZodError, z } from "zod";
import { sha256 } from "../domain/canonical.js";
import {
	AI_RANKING_POOL_SIZE,
	ASSET_REGISTRY,
	FEED_PAGE_SIZE,
	POLICY_VERSION,
	USDG_ADDRESS,
	USDG_DECIMALS,
} from "../domain/constants.js";
import { executionIntent } from "../domain/execution-intent.js";
import {
	eligibleFeedCandidates,
	PolicyError,
	policyHash,
	validateExecutionAssets,
	validateExecutionSelection,
	validateFeed,
	validateRanking,
} from "../domain/policy.js";
import {
	addressSchema,
	appChainSchema,
	baseUnitsSchema,
	budgetForTicket,
	DEFAULT_BUDGET,
	executionProviderIdSchema,
	feedRankingProviderIdSchema,
	executionRequestSchema,
	feedInputSchema,
	onboardingPreferencesSchema,
	personalizationPreferencesSchema,
	rankingInputSchema,
	solanaAddressSchema,
	type ExecutionProviderId,
	type FeedRankingProviderId,
	type RankingInput,
} from "../domain/schemas.js";
import {
	SOLANA_ASSET_REGISTRY,
	SOLANA_CLUSTER,
	SOLANA_NATIVE_MINT,
	SOLANA_USDC_DECIMALS,
	SOLANA_USDC_MINT,
	solanaAssetById,
} from "../domain/solana.js";
import type {
	AssetIconProvider,
	MarketDataProvider,
} from "./adapters/coingecko.js";
import type { HistoryPeriod, PricePoint } from "./adapters/market-history.js";
import { ExecutionProviderError } from "./adapters/types.js";
import type {
	CandidateProvider,
	ExecutionProvider,
	PrivateInferenceProvider,
	SolanaPreparedTransaction,
} from "./adapters/types.js";
import { PrivyWalletAuth } from "./auth.js";
import type { ExecutionActor } from "./auth.js";
import type { AppConfig } from "./config.js";
import { sessionEpochId } from "./session-epoch.js";
import type { StateStore } from "./store.js";

export interface AppDependencies {
	config: AppConfig;
	store: StateStore;
	candidates: CandidateProvider;
	candidateProviders?: Partial<Record<ExecutionProviderId, CandidateProvider>>;
	inference: PrivateInferenceProvider;
	rankingProviders?: Partial<
		Record<FeedRankingProviderId, PrivateInferenceProvider>
	>;
	execution: ExecutionProvider;
	executionProviders?: Partial<Record<ExecutionProviderId, ExecutionProvider>>;
	solanaExecutionProviders?: Partial<Record<ExecutionProviderId, ExecutionProvider>>;
	solanaCandidateProviders?: Partial<Record<ExecutionProviderId, CandidateProvider>>;
	auth?: {
		actor(
			request: Request,
		): Promise<
			| ExecutionActor
			| { wallet: string; txOrigin: string; userId?: string; chain?: "ROBINHOOD" | "SOLANA" }
		>;
	};
	icons?: AssetIconProvider;
	marketData?: MarketDataProvider;
	history?: Pick<MarketDataProvider, "history">;
	fetcher?: typeof fetch;
}

export function createApp(deps: AppDependencies) {
	const app = express();
	const solanaExitPreparations = new Map<
		string,
		{
			wallet: string;
			assetId: string;
			provider: ExecutionProviderId;
			prepared: SolanaPreparedTransaction;
			signature?: string;
		}
	>();
	// Vercel terminates the public request before it reaches this function.
	// Trust exactly that proxy hop so rate limiting keys off the real client IP.
	if (deps.config.NODE_ENV === "production") app.set("trust proxy", 1);
	const auth =
		deps.auth ??
		new PrivyWalletAuth(
			deps.config.PRIVY_APP_ID,
			deps.config.PRIVY_APP_SECRET,
		);
	const chainClient = createPublicClient({
		transport: http(deps.config.ROBINHOOD_RPC_URL),
	});

	app.disable("x-powered-by");
	app.use(
		helmet({
			contentSecurityPolicy: {
				directives: {
					defaultSrc: ["'self'"],
					scriptSrc: [
						"'self'",
						"'wasm-unsafe-eval'",
						"https://challenges.cloudflare.com",
					],
					styleSrc: ["'self'", "'unsafe-inline'"],
					imgSrc: [
						"'self'",
						"data:",
						"blob:",
						"https://assets.coingecko.com",
						"https://coin-images.coingecko.com",
						"https://img.logo.dev",
						"https://cdn.tickerlogos.com",
					],
					childSrc: [
						"https://auth.privy.io",
						"https://verify.walletconnect.com",
						"https://verify.walletconnect.org",
					],
					frameSrc: [
						"https://auth.privy.io",
						"https://verify.walletconnect.com",
						"https://verify.walletconnect.org",
						"https://challenges.cloudflare.com",
					],
					connectSrc: [
						"'self'",
						"https://auth.privy.io",
						"https://*.rpc.privy.systems",
						"https://*.g.alchemy.com",
						"https://explorer-api.walletconnect.com",
						"https://rpc.mainnet.chain.robinhood.com",
						"https://api.mainnet-beta.solana.com",
						"wss://relay.walletconnect.com",
						"wss://relay.walletconnect.org",
						"wss://www.walletlink.org",
					],
					workerSrc: ["'self'"],
				},
			},
		}),
	);
	app.use(express.json({ limit: "64kb" }));
	app.use(
		"/api",
		rateLimit({
			windowMs: 60_000,
			limit:
				deps.config.NODE_ENV === "production" && deps.config.liveExecution
					? 60
					: 240,
			standardHeaders: "draft-8",
			legacyHeaders: false,
		}),
	);

	app.get("/api/health", (_request, response) => {
		response.json({
			status: "ok",
			mode: deps.config.localLiveExecution
				? "local-live"
				: deps.config.demoMode
					? "demo"
					: "live",
			chainId: 4663,
		});
	});

	app.get("/api/config", (_request, response) => {
		response.json({
			demoMode: !deps.config.liveExecution,
			executionMode: deps.config.localLiveExecution
				? "local-live"
				: deps.config.demoMode
					? "demo"
					: "live",
			chainId: 4663,
			stableToken: "USDG",
			executionProviders: {
				ZERO_EX: { available: providerConfigured(deps.config, "ZERO_EX", "ROBINHOOD") },
				UNISWAP: { available: providerConfigured(deps.config, "UNISWAP", "ROBINHOOD") },
				JUPITER: { available: false },
			},
			feedRankingProviders: {
				ZERO_G: { available: Boolean(deps.rankingProviders?.ZERO_G) },
				DETERMINISTIC: { available: true },
			},
			solana: {
				available:
					providerConfigured(deps.config, "JUPITER", "SOLANA") ||
					providerConfigured(deps.config, "ZERO_EX", "SOLANA"),
				cluster: SOLANA_CLUSTER,
				stableToken: "USDC",
				inputMint: SOLANA_USDC_MINT,
				executionProviders: {
					JUPITER: { available: providerConfigured(deps.config, "JUPITER", "SOLANA") },
					ZERO_EX: { available: providerConfigured(deps.config, "ZERO_EX", "SOLANA") },
				},
			},
			periodBudgetBaseUnits: DEFAULT_BUDGET.periodBudgetBaseUnits,
			slotBudgetBaseUnits: DEFAULT_BUDGET.slotBudgetBaseUnits,
			maxCards: DEFAULT_BUDGET.maxCards,
			privy: { appId: deps.config.PRIVY_APP_ID },
		});
	});

	app.post("/api/solana/rpc", async (request, response) => {
		if (!deps.config.SOLANA_RPC_URL) {
			response.status(503).json({ error: "SOLANA_UNAVAILABLE" });
			return;
		}
		const allowedMethods = new Set([
			"getAccountInfo",
			"getBalance",
			"getBlockHeight",
			"getFeeForMessage",
			"getGenesisHash",
			"getLatestBlockhash",
			"getMinimumBalanceForRentExemption",
			"getMultipleAccounts",
			"getRecentPrioritizationFees",
			"getSignatureStatuses",
			"getTokenAccountBalance",
			"getTokenAccountsByOwner",
			"getVersion",
			"simulateTransaction",
		]);
		const calls = Array.isArray(request.body) ? request.body : [request.body];
		if (
			!calls.length ||
			calls.some(
				(call) =>
					!call ||
					typeof call !== "object" ||
					typeof call.method !== "string" ||
					!allowedMethods.has(call.method),
			)
		) {
			response.status(403).json({ error: "SOLANA_RPC_METHOD_NOT_ALLOWED" });
			return;
		}
		const upstream = await (deps.fetcher ?? fetch)(deps.config.SOLANA_RPC_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request.body),
		});
		response
			.status(upstream.status)
			.type("application/json")
			.set("Cache-Control", "no-store")
			.send(await upstream.text());
	});

	app.get("/api/assets/icons", async (_request, response) => {
		try {
			response.json({ icons: (await deps.icons?.getIcons()) ?? {} });
		} catch {
			response.json({ icons: {} });
		}
	});

	app.get("/api/assets/:assetId/history", async (request, response) => {
		const assetId = String(request.params.assetId);
		const period = z
			.enum(["1H", "1D", "1W", "1M", "1Y", "ALL"])
			.default("1W")
			.parse(request.query.period) as HistoryPeriod;
		const asset = await resolveAsset(deps, assetId);
		if (!asset) {
			response.status(404).json({ error: "ASSET_NOT_FOUND" });
			return;
		}
		try {
			const history = await deps.history?.history(asset, period);
			if (history && history.points.length >= 2) {
				response.json({
					period,
					requestedPeriod: period,
					effectivePeriod:
						period === "ALL"
							? history.isCompleteHistory
								? "MAX"
								: "LIMITED"
							: period,
					coverageStart: history.points[0]?.timestamp,
					coverageEnd: history.points.at(-1)?.timestamp,
					...history,
				});
				return;
			}
		} catch {
			// Charts are enrichment; review and execution flows must remain available.
		}
		// Keep local demos usable if CoinGecko market history is temporarily down.
		if (!deps.config.liveExecution) {
			response.json({
					period,
					source: "demo",
					points: demoHistory(asset.symbol, period),
					isCompleteHistory: false,
			});
			return;
		}
		response.json({
				period,
				source: "unavailable",
				points: [],
				isCompleteHistory: false,
		});
	});

	app.get("/api/assets/:assetId/details", async (request, response) => {
		const assetId = String(request.params.assetId);
		const asset = await resolveAsset(deps, assetId);
		if (!asset) {
			response.status(404).json({ error: "ASSET_NOT_FOUND" });
			return;
		}
		const explorerUrl = assetExplorerUrl(assetId, asset.address);
		const common = {
			assetId,
			...(explorerUrl
				? {
						contract: asset.address,
						explorerUrl,
					}
				: {}),
		};
		try {
			const details = await deps.marketData?.details?.(asset);
			if (details) {
				response.json({ ...common, ...details });
				return;
			}
		} catch {
			// Metadata is optional; the contract explorer remains useful on failure.
		}
		response.json({
			...common,
			source: "unavailable",
			categories: [],
			community: [],
		});
	});

	app.get("/api/balances/:address/usdg", async (request, response) => {
		const address = addressSchema.parse(request.params.address) as Address;
		const balanceBaseUnits = await chainClient.readContract({
			address: USDG_ADDRESS,
			abi: [
				{
					type: "function",
					name: "balanceOf",
					stateMutability: "view",
					inputs: [{ name: "account", type: "address" }],
					outputs: [{ name: "", type: "uint256" }],
				},
			],
			functionName: "balanceOf",
			args: [address],
		});
		response.json({
			asset: "USDG",
			chainId: 4663,
			decimals: USDG_DECIMALS,
			balanceBaseUnits: balanceBaseUnits.toString(),
		});
	});

	app.get("/api/balances/:address/solana", async (request, response) => {
		const address = solanaAddressSchema.parse(request.params.address);
		if (!deps.config.SOLANA_RPC_URL) {
			response.status(503).json({ error: "SOLANA_UNAVAILABLE" });
			return;
		}
		const fetcher = deps.fetcher ?? fetch;
		const [native, usdcBalanceBaseUnits] = await Promise.all([
			solanaRpc<{ value?: number }>(fetcher, deps.config.SOLANA_RPC_URL, {
				id: 1,
				method: "getBalance",
				params: [address, { commitment: "confirmed" }],
			}),
			solanaUsdcBalance(fetcher, deps.config.SOLANA_RPC_URL, address),
		]);
		response.json({
			cluster: SOLANA_CLUSTER,
			address,
			solBalanceLamports: String(native.value ?? 0),
			usdcBalanceBaseUnits: usdcBalanceBaseUnits.toString(),
			usdcDecimals: SOLANA_USDC_DECIMALS,
		});
	});

	app.get("/api/portfolio/:address/solana", async (request, response) => {
		const address = solanaAddressSchema.parse(request.params.address);
		const endpoint = alchemyPortfolioEndpoint(deps.config.SOLANA_RPC_URL);
		if (!endpoint) {
			response.status(503).json({ error: "ALCHEMY_PORTFOLIO_UNAVAILABLE" });
			return;
		}
		const fetcher = deps.fetcher ?? fetch;
		const tokens: AlchemyPortfolioToken[] = [];
		let pageKey: string | undefined;
		for (let page = 0; page < 10; page += 1) {
			const upstream = await fetcher(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					addresses: [{ address, networks: ["solana-mainnet"] }],
					withMetadata: true,
					withPrices: true,
					includeNativeTokens: true,
					includeErc20Tokens: true,
					...(pageKey ? { pageKey } : {}),
				}),
			});
			if (!upstream.ok) {
				response.status(upstream.status === 429 ? 429 : 502).json({
					error:
						upstream.status === 429
							? "ALCHEMY_RATE_LIMITED"
							: "ALCHEMY_PORTFOLIO_UNAVAILABLE",
				});
				return;
			}
			const payload = (await upstream.json()) as AlchemyPortfolioResponse;
			tokens.push(...(payload.data?.tokens ?? []));
			pageKey = payload.data?.pageKey || undefined;
			if (!pageKey) break;
		}
		const knownByMint = new Map(
			Object.values(SOLANA_ASSET_REGISTRY).map((asset) => [asset.address, asset]),
		);
		response.json({
			cluster: SOLANA_CLUSTER,
			address,
			tokens: tokens
				.map((token) => {
					const mint = token.tokenAddress ?? SOLANA_NATIVE_MINT;
					const known = knownByMint.get(mint);
					const balanceBaseUnits = hexBalanceToDecimal(token.tokenBalance);
					const usdPrice = token.tokenPrices?.find(
						(price) => price.currency.toLowerCase() === "usd",
					);
					return {
						assetId: known?.assetId ?? `sol:mainnet:${mint}`,
						mint,
						symbol: known?.symbol ?? token.tokenMetadata?.symbol ?? "Unknown",
						name: known?.name ?? token.tokenMetadata?.name ?? "Unknown token",
						decimals:
							known?.decimals ?? token.tokenMetadata?.decimals ?? 0,
						balanceBaseUnits,
						iconUrl: token.tokenMetadata?.logo ?? undefined,
						priceUsd: usdPrice ? Number(usdPrice.value) : undefined,
						priceUpdatedAt: usdPrice?.lastUpdatedAt,
					};
				})
				.filter((token) => BigInt(token.balanceBaseUnits) > 0n),
		});
	});

	app.get("/api/portfolio/:address/robinhood", async (request, response) => {
		const address = addressSchema.parse(request.params.address);
		const endpoint = alchemyPortfolioEndpoint(deps.config.ROBINHOOD_RPC_URL);
		if (!endpoint) {
			response.status(503).json({ error: "ALCHEMY_PORTFOLIO_UNAVAILABLE" });
			return;
		}
		const fetcher = deps.fetcher ?? fetch;
		const tokens: AlchemyPortfolioToken[] = [];
		let pageKey: string | undefined;
		for (let page = 0; page < 10; page += 1) {
			const upstream = await fetcher(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					addresses: [{ address, networks: ["robinhood-mainnet"] }],
					withMetadata: true,
					withPrices: true,
					includeNativeTokens: false,
					includeErc20Tokens: true,
					...(pageKey ? { pageKey } : {}),
				}),
			});
			if (!upstream.ok) {
				response.status(upstream.status === 429 ? 429 : 502).json({
					error:
						upstream.status === 429
							? "ALCHEMY_RATE_LIMITED"
							: "ALCHEMY_PORTFOLIO_UNAVAILABLE",
				});
				return;
			}
			const payload = (await upstream.json()) as AlchemyPortfolioResponse;
			tokens.push(...(payload.data?.tokens ?? []));
			pageKey = payload.data?.pageKey || undefined;
			if (!pageKey) break;
		}
		const discovered = await deps.candidates.getRankingCandidates(500, [], {
			includeCommunity: true,
		});
		const supported = deps.marketData
			? await deps.marketData
					.enrichRankingCandidates(discovered)
					.catch(() => discovered)
			: discovered;
		const knownByContract = new Map(
			supported.flatMap((asset) =>
				asset.contract ? [[asset.contract.toLowerCase(), asset] as const] : [],
			),
		);
		response.json({
			chainId: 4663,
			address,
			tokens: tokens.flatMap((token) => {
				const contract = token.tokenAddress?.toLowerCase();
				const known = contract ? knownByContract.get(contract) : undefined;
				const balanceBaseUnits = hexBalanceToDecimal(token.tokenBalance);
				if (!contract || !known || BigInt(balanceBaseUnits) <= 0n) return [];
				const usdPrice = token.tokenPrices?.find(
					(price) => price.currency.toLowerCase() === "usd",
				);
				return [
					{
						assetId: known.assetId,
						contract,
						symbol: known.symbol,
						name: known.name,
						kind: known.kind,
						decimals: known.decimals ?? token.tokenMetadata?.decimals ?? 0,
						balanceBaseUnits,
						iconUrl: known.iconUrl ?? token.tokenMetadata?.logo ?? undefined,
						priceUsd:
							known.priceUsd ?? (usdPrice ? Number(usdPrice.value) : undefined),
						priceUpdatedAt:
							known.marketDataUpdatedAt ?? usdPrice?.lastUpdatedAt,
						marketDataSource:
							known.marketDataSource ?? (usdPrice ? "alchemy" : undefined),
						coingeckoId: known.coingeckoId,
					},
				];
			}),
		});
	});

	const requireWallet = async (
		request: Request,
		response: Response,
		next: NextFunction,
	) => {
		if (!deps.config.liveExecution) {
			const chain = appChainSchema
				.optional()
				.default("ROBINHOOD")
				.parse(request.header("x-wallet-chain"));
			response.locals.chain = chain;
			response.locals.wallet =
				chain === "SOLANA"
					? "11111111111111111111111111111111"
					: "0x71f30000000000000000000000000000000009a2";
			response.locals.txOrigin =
				chain === "SOLANA"
					? response.locals.wallet
					: "0x71f30000000000000000000000000000000009a3";
			response.locals.userId = `demo:${response.locals.wallet}`;
			next();
			return;
		}
		try {
			const actor = await auth.actor(request);
			response.locals.wallet = actor.wallet;
			response.locals.txOrigin = actor.txOrigin;
			response.locals.userId = actor.userId ?? actor.wallet;
			response.locals.chain = actor.chain ?? "ROBINHOOD";
			next();
		} catch {
			response.status(401).json({ error: "AUTH_REQUIRED" });
		}
	};

	const requireFeedWallet = async (
		request: Request,
		response: Response,
		next: NextFunction,
	) => {
		if (deps.config.demoMode && !request.header("authorization")) {
			response.locals.wallet = "0x71f30000000000000000000000000000000009a2";
			response.locals.txOrigin = "0x71f30000000000000000000000000000000009a3";
			response.locals.userId = `demo:${response.locals.wallet}`;
			response.locals.chain = "ROBINHOOD";
			next();
			return;
		}
		await requireWallet(request, response, next);
	};
	const preferenceOwner = (response: Response) =>
		String(response.locals.userId ?? response.locals.wallet);
	const preferencesFor = async (response: Response) => {
		const ownerId = preferenceOwner(response);
		const byOwner = await deps.store.getPreferences(ownerId);
		if (byOwner || ownerId === response.locals.wallet) return byOwner;
		return deps.store.getPreferences(response.locals.wallet);
	};

	app.post(
		"/api/preferences",
		requireWallet,
		async (request, response) => {
			const preferences = onboardingPreferencesSchema.parse(request.body);
			if (
				preferences.activeChain !== response.locals.chain ||
				(preferences.activeChain === "SOLANA" &&
					!["JUPITER", "ZERO_EX"].includes(preferences.executionProvider)) ||
				(preferences.activeChain === "ROBINHOOD" &&
					preferences.executionProvider === "JUPITER")
			) {
				response.status(409).json({ error: "CHAIN_WALLET_MISMATCH" });
				return;
			}
			if (!providerConfigured(deps.config, preferences.executionProvider, preferences.activeChain)) {
				response.status(422).json({
					error: "EXECUTION_PROVIDER_UNAVAILABLE",
					message: `${providerLabel(preferences.executionProvider)} is not configured.`,
					provider: preferences.executionProvider,
				});
				return;
			}
			const storedPreferences =
				preferences.activeChain === "SOLANA"
					? { ...preferences, solanaExecutionWallet: response.locals.wallet }
					: preferences;
			const ownerId = preferenceOwner(response);
			const existing = await preferencesFor(response);
			if (
				existing &&
				(existing.executionProvider !== storedPreferences.executionProvider ||
					existing.feedRankingProvider !== storedPreferences.feedRankingProvider)
			) {
				await deps.store.invalidatePreparedExecutions(ownerId);
			}
			response.json(
				await deps.store.setPreferences(
					ownerId,
					storedPreferences,
					response.locals.wallet,
				),
			);
		},
	);

	app.get("/api/preferences", requireWallet, async (_request, response) => {
		const preferences = await preferencesFor(response);
		if (!preferences) {
			response.status(404).json({ error: "PREFERENCES_NOT_FOUND" });
			return;
		}
		response.json(preferences);
	});

	app.post(
		"/api/sessions/open",
		requireFeedWallet,
		async (request, response) => {
			const cadence = personalizationPreferencesSchema.shape.cadence.parse(
				request.body?.cadence,
			);
			// Demo and local-live are intentionally repeatable so a builder can sign
			// multiple test baskets during one cadence period. Production stays
			// idempotent per wallet and epoch at the StateStore boundary.
			const storedPreferences = await preferencesFor(response);
			const chain =
				storedPreferences?.activeChain ??
				appChainSchema
					.optional()
					.default("ROBINHOOD")
					.parse(request.body?.chain);
			const executionProvider =
				storedPreferences?.executionProvider ??
				executionProviderIdSchema
					.optional()
					.default("ZERO_EX")
					.parse(request.body?.executionProvider);
			const feedRankingProvider =
				storedPreferences?.feedRankingProvider ??
				feedRankingProviderIdSchema
					.optional()
					.default("ZERO_G")
					.parse(request.body?.feedRankingProvider);
			const session = await deps.store.openSession(
				response.locals.wallet,
				sessionEpochId(cadence, deps.config),
				executionProvider,
				chain,
				preferenceOwner(response),
				feedRankingProvider,
			);
			response.json(session);
		},
	);

	app.post(
		"/api/sessions/:sessionId/feed",
		requireFeedWallet,
		async (request, response) => {
			const timing = serverTiming("feed", deps.config.NODE_ENV !== "test");
			const session = await deps.store.getSession(
				String(request.params.sessionId),
			);
			if (
				!session ||
				session.wallet !== response.locals.wallet ||
				session.chain !== response.locals.chain
			) {
				response.status(404).json({ error: "SESSION_NOT_FOUND" });
				return;
			}
			const currentPreferences = await preferencesFor(response);
			if (
				currentPreferences &&
				(currentPreferences.executionProvider !== session.executionProvider ||
					currentPreferences.activeChain !== session.chain ||
					currentPreferences.feedRankingProvider !==
						session.feedRankingProvider)
			) {
				response.status(409).json({
					error: "EXECUTION_PROVIDER_CHANGED",
					message:
						"Your execution provider changed. Refresh the basket before continuing.",
				});
				return;
			}
			const submittedPreferences = onboardingPreferencesSchema.parse(
				request.body,
			);
			if (
				submittedPreferences.executionProvider !== session.executionProvider ||
				submittedPreferences.activeChain !== session.chain ||
				submittedPreferences.feedRankingProvider !==
					session.feedRankingProvider
			) {
				response.status(409).json({
					error: "EXECUTION_PROVIDER_CHANGED",
					message:
						"Your execution provider changed. Refresh the basket before continuing.",
				});
				return;
			}
			const candidatesForSession = candidateProvider(
				deps,
				session.executionProvider,
				session.chain,
			);
			const budget = budgetForTicket(
				submittedPreferences.ticketSizeUsd,
				submittedPreferences.periodLimitUsd ?? 100,
			);
			const candidateLimit =
				z
					.number()
					.int()
					.min(1)
					.max(FEED_PAGE_SIZE)
					.optional()
					.parse(request.body?.candidateLimit) ?? FEED_PAGE_SIZE;
			const excludedAssetIds =
				z
					.array(z.string().min(1))
					.optional()
					.parse(request.body?.excludedAssetIds) ?? [];
			const { riskDisclosureAccepted: _accepted, ...preferences } =
				submittedPreferences;
			timing.mark("session");
			let rankingCandidates = (
				await candidatesForSession.getRankingCandidates(
					AI_RANKING_POOL_SIZE,
					excludedAssetIds,
					{
						includeCommunity: preferences.riskMode === "degen",
						riskMode: preferences.riskMode,
					},
				)
			).filter((candidate) =>
				preferences.assetClasses.includes(candidate.kind),
			);
			if (deps.marketData) {
				rankingCandidates =
					await deps.marketData.enrichRankingCandidates(rankingCandidates);
			}
			if (
				deps.config.liveExecution &&
				session.chain === "ROBINHOOD" &&
				deps.marketData
			) {
				rankingCandidates = rankingCandidates.filter(
					(candidate) => candidate.coingeckoId && candidate.iconUrl,
				);
			}
			if (!rankingCandidates.length) {
				response
					.status(422)
					.json({ error: "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES" });
				return;
			}
			timing.mark("market");
			const unsignedRankingInput = {
				schemaVersion: "investmade-ranking-input/v1" as const,
				sessionId: session.id,
				epochId: session.epochId,
				policyVersion: POLICY_VERSION,
				budget,
				preferences,
				candidates: rankingCandidates,
			};
			const rankingInput = rankingInputSchema.parse({
				...unsignedRankingInput,
				inputCommitment: sha256(unsignedRankingInput),
			});
			const generated = await rankFeed(
				deps,
				submittedPreferences.feedRankingProvider,
				rankingInput,
			);
			const ranking = validateRanking(
				generated.output,
				rankingInput,
				rankingCandidates,
			);
			timing.mark("inference");
			const pageSize = Math.min(candidateLimit, budget.maxCards);
			const discoveredCandidates =
				await candidatesForSession.getCandidatesForFeed(
				response.locals.wallet,
					ranking.assets.map((asset) => asset.assetId),
					budget.slotBudgetBaseUnits,
					new Date(),
					pageSize,
					response.locals.txOrigin,
				);
			const marketById = new Map(
				rankingCandidates.map((candidate) => [candidate.assetId, candidate]),
			);
			const marketCandidates = discoveredCandidates.map((candidate) => {
				const market = marketById.get(candidate.assetId);
				if (!market) return candidate;
				return {
					...candidate,
					marketPriceUsd: market.priceUsd ?? candidate.marketPriceUsd,
					volume24hUsd: market.volume24hUsd,
					liquidityUsd: market.liquidityUsd,
					discoveryProvider: market.discoveryProvider,
					providerVolumeRank: market.providerVolumeRank,
					providerVolumeRankTotal: market.providerVolumeRankTotal,
					marketDataSource:
						market.marketDataSource ?? candidate.marketDataSource,
					marketCapRank: market.marketCapRank,
					marketCapRankSource: market.marketCapRankSource,
					coingeckoId: market.coingeckoId,
					iconUrl: market.iconUrl ?? candidate.iconUrl,
					marketDataUpdatedAt: market.marketDataUpdatedAt,
					primaryClassification: market.primaryClassification,
					classificationConfidence: market.classificationConfidence,
					tags: market.tags,
					riskFlags: market.riskFlags,
					classificationEvidence: market.classificationEvidence,
					evidenceIds: [
						...candidate.evidenceIds,
						...(market.coingeckoId
							? [`coingecko:market:${market.coingeckoId}`]
							: []),
					],
				};
			});
			const candidates = eligibleFeedCandidates(marketCandidates).slice(
				0,
				pageSize,
			);
			if (!candidates.length) {
				response
					.status(422)
					.json({ error: "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES" });
				return;
			}
			const rankingById = new Map(
				ranking.assets.map((asset) => [asset.assetId, asset]),
			);
			const input = feedInputSchema.parse({
				schemaVersion: "investmade-feed-input/v1",
				sessionId: session.id,
				epochId: session.epochId,
				policyVersion: POLICY_VERSION,
				budget,
				preferences,
				candidates,
				inputCommitment: rankingInput.inputCommitment,
			});
			const output = validateFeed(
				{
					schemaVersion: "investmade-feed-output/v1",
					sessionId: session.id,
					inputCommitment: rankingInput.inputCommitment,
					policyVersion: POLICY_VERSION,
					regime: ranking.regime,
					cards: candidates.map((candidate, index) => {
						const ranked = rankingById.get(candidate.assetId);
						if (!ranked) {
							throw new PolicyError(
								"ASSET_NOT_ELIGIBLE",
								`${candidate.assetId} was not present in the verified ranking.`,
							);
						}
						return {
							assetId: candidate.assetId,
							action: "BUY" as const,
							rank: index + 1,
							amountInBaseUnits: budget.slotBudgetBaseUnits,
							scoreBps: ranked.scoreBps,
							marketCapRank: candidate.marketCapRank,
							marketCapRankSource: candidate.marketCapRankSource,
							evidenceIds: candidate.evidenceIds,
							reason: ranked.reason,
						};
					}),
					warnings: ranking.warnings,
				},
				input,
				candidates,
			);
			timing.mark("cards");
			timing.apply(response);
			response.json({
				candidates,
				feed: output,
				proof: generated.receipt,
				hasMore:
					candidates.length === pageSize &&
					ranking.assets.length > candidates.length,
				rankedAssetCount: ranking.assets.length,
			});
		},
	);

	app.post(
		"/api/executions/prepare",
		requireWallet,
		async (request, response) => {
			const timing = serverTiming("prepare", deps.config.NODE_ENV !== "test");
			const parsed = executionRequestSchema.parse(request.body);
			const session = await deps.store.getSession(parsed.sessionId);
			if (
				!session ||
				session.wallet !== response.locals.wallet ||
				session.chain !== response.locals.chain ||
				session.chain !== parsed.chain
			) {
				response.status(404).json({ error: "SESSION_NOT_FOUND" });
				return;
			}
			const currentPreferences = await preferencesFor(response);
			if (
				currentPreferences &&
				(currentPreferences.executionProvider !== session.executionProvider ||
					currentPreferences.activeChain !== session.chain)
			) {
				response.status(409).json({
					error: "EXECUTION_PROVIDER_CHANGED",
					message:
						"Your execution provider changed. Refresh the basket before continuing.",
				});
				return;
			}
			const executionForSession = executionProvider(
				deps,
				session.executionProvider,
				session.chain,
			);
			const candidatesForSession = candidateProvider(
				deps,
				session.executionProvider,
				session.chain,
			);
			const requestedIntent = executionIntent(session, parsed);
			const requestedPlanHash = sha256(requestedIntent);
			let expectedPlanHash: string = requestedPlanHash;
			if (session.executionId) {
				const existing = await deps.store.getExecution(session.executionId);
				if (!existing) {
					response.status(409).json({
						error: "EXECUTION_NOT_FOUND",
						executionId: session.executionId,
					});
					return;
				}
				if (existing.status !== "PREPARED") {
					response.status(409).json({
						error: "EXECUTION_TERMINAL",
						message:
							"This basket has already been submitted. Open its receipt or start another basket.",
						executionId: existing.plan.executionId,
						status: existing.status,
					});
					return;
				}
				expectedPlanHash = existing.plan.authorizedPlanHash;
			}
			timing.mark("session");
			if (deps.config.liveExecution && parsed.chain === "ROBINHOOD") {
				const required = parsed.selections.reduce(
					(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
					0n,
				);
				const available = await chainClient.readContract({
					address: USDG_ADDRESS,
					abi: [
						{
							type: "function",
							name: "balanceOf",
							stateMutability: "view",
							inputs: [{ name: "account", type: "address" }],
							outputs: [{ name: "", type: "uint256" }],
						},
					],
					functionName: "balanceOf",
					args: [response.locals.wallet as Address],
				});
				if (available < required) {
					response.status(422).json({
						error: "INSUFFICIENT_SMART_WALLET_USDG",
						message:
							"Fund your Investmade Wallet with enough USDG before refreshing quotes.",
					});
					return;
				}
			}
			if (deps.config.liveExecution && parsed.chain === "SOLANA") {
				if (!deps.config.SOLANA_RPC_URL) {
					throw new Error("SOLANA_RPC_BALANCE_UNAVAILABLE");
				}
				const required = parsed.selections.reduce(
					(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
					0n,
				);
				const available = await solanaUsdcBalance(
					deps.fetcher ?? fetch,
					deps.config.SOLANA_RPC_URL,
					response.locals.wallet,
				);
				if (available < required) {
					response.status(422).json({
						error: "INSUFFICIENT_FUNDS",
						message: `Basket requires ${formatUnits(required, SOLANA_USDC_DECIMALS)} USDC, but this wallet has ${formatUnits(available, SOLANA_USDC_DECIMALS)} USDC.`,
					});
					return;
				}
			}
			timing.mark("balance");
			const slotBudgetBaseUnits = parsed.selections[0]?.amountInBaseUnits;
			const candidates =
				await candidatesForSession.getCandidatesForExecution(
				response.locals.wallet,
				parsed.selections.map((selection) => selection.assetId),
				slotBudgetBaseUnits,
				undefined,
				response.locals.txOrigin,
			);
			validateExecutionAssets(parsed, candidates);
			timing.mark("candidates");
			const preparation = await executionForSession.prepareBasket(
				response.locals.wallet,
				parsed,
				candidates,
				response.locals.txOrigin,
			);
			if (preparation.unavailableAssetIds?.length) {
				const unavailable = new Set(preparation.unavailableAssetIds);
				const symbols = candidates
					.filter((candidate) => unavailable.has(candidate.assetId))
					.map((candidate) => candidate.symbol);
				response.status(422).json({
					error: "EXECUTION_ASSETS_UNAVAILABLE",
					message: `${symbols.join(", ")} ${symbols.length === 1 ? "is" : "are"} not currently supported by ${providerLabel(session.executionProvider)}.`,
					provider: session.executionProvider,
					assetIds: preparation.unavailableAssetIds,
					symbols,
				});
				return;
			}
			const quotes = preparation.quotes;
			const quotesByAssetId = new Map(
				quotes.map((quote) => [quote.assetId, quote]),
			);
			const quotedCandidates = candidates.map((candidate) => {
				const quote = quotesByAssetId.get(candidate.assetId);
				if (!quote) {
					throw new PolicyError(
						"ASSET_NOT_ELIGIBLE",
						`${candidate.assetId} did not return an executable quote.`,
					);
				}
				return { ...candidate, quote };
			});
			validateExecutionSelection(parsed, quotedCandidates);
			timing.mark("execution");
			const plan = {
				executionId: session.executionId ?? randomUUID(),
				sessionId: session.id,
				epochId: session.epochId,
				provider: session.executionProvider,
				chain: parsed.chain,
				...(parsed.chain === "ROBINHOOD"
					? { chainId: parsed.chainId }
					: { cluster: parsed.cluster }),
				inputToken: parsed.inputToken,
				signingWallet: session.wallet,
				totalInputBaseUnits: parsed.selections
					.reduce(
						(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
						0n,
					)
					.toString(),
				authorizedPlanHash: requestedPlanHash,
				policyHash: policyHash(parsed.selections, parsed.periodLimitUsd),
				callCommitments: (preparation.walletCalls ?? []).map((call) =>
					sha256({
						kind: call.kind,
						to: call.transaction.to.toLowerCase(),
						data: call.transaction.data.toLowerCase(),
						value: call.transaction.value,
						chainId: call.transaction.chainId,
						assetId: call.assetId,
					}),
				),
				quotes,
				solanaTransaction: preparation.solanaTransaction,
				generatedAt: new Date().toISOString(),
			};
			const execution = session.executionId
				? await deps.store.refreshPreparedExecution(
						session.executionId,
						expectedPlanHash,
						plan,
					)
				: await deps.store.reserveExecution(session.id, plan);
			timing.mark("store");
			timing.apply(response);
			response.json({
				...execution,
				kind:
					parsed.chain === "SOLANA"
						? "SOLANA_TRANSACTION"
						: "EVM_CALLS",
				walletCalls: preparation.walletCalls,
				solanaTransaction: preparation.solanaTransaction,
			});
		},
	);

	app.post(
		"/api/executions/:executionId/demo-settle",
		requireWallet,
		async (request, response) => {
			if (!deps.config.demoMode || deps.config.liveExecution) {
				response.status(404).json({ error: "NOT_FOUND" });
				return;
			}
			const execution = await deps.store.getExecution(
				String(request.params.executionId),
			);
			if (!execution) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			const transactionHashes = execution.plan.quotes.map(
				(_quote, index) =>
					`0x${sha256(`${execution.plan.executionId}:${index}`).slice(7)}`,
			);
			const settledOutputs = execution.plan.quotes.map((quote, index) => ({
				assetId: quote.assetId,
				amountOutBaseUnits: quote.estimatedAmountOut,
				transactionHash: transactionHashes[index] ?? "",
				status: "success" as const,
			}));
			response.json(
				await deps.store.updateExecution(
					execution.plan.executionId,
					"SETTLED",
					transactionHashes,
					settledOutputs,
				),
			);
		},
	);

	app.post(
		"/api/executions/:executionId/submitted",
		requireWallet,
		async (request, response) => {
			if (!deps.config.liveExecution) {
				response.status(409).json({ error: "USE_DEMO_SETTLE" });
				return;
			}
			const execution = await deps.store.getExecution(
				String(request.params.executionId),
			);
			if (!execution) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			const session = await deps.store.getSession(execution.plan.sessionId);
			if (
				!session ||
				session.wallet !== response.locals.wallet ||
				session.chain !== response.locals.chain
			) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			if (session.executionProvider !== execution.plan.provider) {
				throw new Error("EXECUTION_PROVIDER_MISMATCH");
			}
			if (execution.plan.chain === "SOLANA") {
				const provider = executionProvider(deps, execution.plan.provider, "SOLANA");
				const signedTransaction = z.string().min(1).parse(
					request.body?.signedTransaction,
				);
				if (
					!execution.plan.solanaTransaction ||
					!provider.submitSignedTransaction
				) {
					throw new Error("SOLANA_TRANSACTION_MISSING");
				}
				const signature = await provider.submitSignedTransaction(
					{
						...execution.plan.solanaTransaction,
						messageCommitment:
							execution.plan.solanaTransaction
								.messageCommitment as `sha256:${string}`,
					},
					signedTransaction,
				);
				response.json(
					await deps.store.updateExecution(
						execution.plan.executionId,
						"SUBMITTED",
						[signature],
						[],
						"BATCH",
					),
				);
				return;
			}
			const hashes = request.body?.transactionHashes;
			const batched = request.body?.batched === true;
			if (!batched) {
				response.status(422).json({
					error: "ATOMIC_BATCH_REQUIRED",
					message:
						"Live baskets must be submitted as one atomic smart-wallet transaction.",
				});
				return;
			}
			if (
				!Array.isArray(hashes) ||
				hashes.length !== 1 ||
				execution.plan.callCommitments.length === 0 ||
				new Set(hashes).size !== hashes.length ||
				!hashes.every((hash) => /^0x[a-fA-F0-9]{64}$/.test(hash))
			) {
				response.status(422).json({ error: "INVALID_TRANSACTION_HASHES" });
				return;
			}
			response.json(
				await deps.store.updateExecution(
					execution.plan.executionId,
					"SUBMITTED",
					hashes,
					[],
					"BATCH",
				),
			);
		},
	);

	app.post(
		"/api/executions/:executionId/reconcile",
		requireWallet,
		async (request, response) => {
			if (!deps.config.liveExecution) {
				response.status(409).json({ error: "USE_DEMO_SETTLE" });
				return;
			}
			const execution = await deps.store.getExecution(
				String(request.params.executionId),
			);
			if (execution?.status !== "SUBMITTED") {
				response.status(409).json({ error: "EXECUTION_NOT_SUBMITTED" });
				return;
			}
			const session = await deps.store.getSession(execution.plan.sessionId);
			if (
				!session ||
				session.wallet !== response.locals.wallet ||
				session.chain !== response.locals.chain
			) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			if (session.executionProvider !== execution.plan.provider) {
				throw new Error("EXECUTION_PROVIDER_MISMATCH");
			}
			if (execution.plan.chain === "SOLANA") {
				const provider = executionProvider(deps, execution.plan.provider, "SOLANA");
				const signature = execution.transactionHashes[0];
				if (
					!signature ||
					!execution.plan.solanaTransaction ||
					!provider.transactionStatus ||
					!provider.reconcileOutputs
				) {
					throw new Error("SOLANA_RECONCILIATION_UNAVAILABLE");
				}
				const status = await provider.transactionStatus(signature);
				if (status.state === "PENDING") {
					response
						.status(202)
						.json({ ...execution, reconciliation: ["pending"] });
					return;
				}
				if (status.state === "FAILED") {
					response.json(
						await deps.store.updateExecution(
							execution.plan.executionId,
							"FAILED",
							[signature],
							execution.plan.quotes.map((quote) => ({
								assetId: quote.assetId,
								amountOutBaseUnits: "0",
								transactionHash: signature,
								blockNumber: status.slot?.toString(),
								status: "failed" as const,
							})),
							"BATCH",
						),
					);
					return;
				}
				const outputs = await provider.reconcileOutputs(
					signature,
					session.wallet,
					execution.plan.solanaTransaction.expectedBalanceChanges,
				);
				if (!outputs) {
					response
						.status(202)
						.json({ ...execution, reconciliation: ["pending"] });
					return;
				}
				const settled = outputs.every((output) => output.status === "success");
				response.json(
					await deps.store.updateExecution(
						execution.plan.executionId,
						settled ? "SETTLED" : "FAILED",
						[signature],
						outputs,
						"BATCH",
					),
				);
				return;
			}
			if (execution.submissionMode === "BATCH") {
				const hash = execution.transactionHashes[0];
				if (!hash) {
					response.status(409).json({ error: "BATCH_TRANSACTION_MISSING" });
					return;
				}
				try {
					const receipt = await chainClient.getTransactionReceipt({
						hash: hash as `0x${string}`,
					});
					if (receipt.status !== "success") {
						response.json(
							await deps.store.updateExecution(
								execution.plan.executionId,
								"FAILED",
								execution.transactionHashes,
								execution.plan.quotes.map((quote) => ({
									assetId: quote.assetId,
									amountOutBaseUnits: "0",
									transactionHash: hash,
									blockNumber: receipt.blockNumber.toString(),
									status: "failed" as const,
								})),
								"BATCH",
							),
						);
						return;
					}
					if (
						spentTransferAmount(receipt.logs, USDG_ADDRESS, session.wallet) !==
						BigInt(execution.plan.totalInputBaseUnits)
					) {
						throw new Error("TRANSACTION_PLAN_MISMATCH");
					}
					const settledOutputs = execution.plan.quotes.map((quote) => {
						const amountOutBaseUnits = settledTransferAmount(
							receipt.logs,
							quote.tokenOut,
							session.wallet,
						);
						if (amountOutBaseUnits < BigInt(quote.minimumAmountOut)) {
							throw new Error("TRANSACTION_PLAN_MISMATCH");
						}
						return {
							assetId: quote.assetId,
							amountOutBaseUnits: amountOutBaseUnits.toString(),
							transactionHash: hash,
							blockNumber: receipt.blockNumber.toString(),
							status: "success" as const,
						};
					});
					response.json(
						await deps.store.updateExecution(
							execution.plan.executionId,
							"SETTLED",
							execution.transactionHashes,
							settledOutputs,
							"BATCH",
						),
					);
				} catch (error) {
					if (
						error instanceof Error &&
						error.message === "TRANSACTION_PLAN_MISMATCH"
					)
						throw error;
					response
						.status(202)
						.json({ ...execution, reconciliation: ["pending"] });
				}
				return;
			}
			const outcomes = await Promise.all(
				execution.transactionHashes.map(async (hash, index) => {
					try {
						const [transaction, receipt] = await Promise.all([
							chainClient.getTransaction({ hash: hash as `0x${string}` }),
							chainClient.getTransactionReceipt({
								hash: hash as `0x${string}`,
							}),
						]);
						const callHash = sha256({
							to: transaction.to?.toLowerCase(),
							data: transaction.input.toLowerCase(),
							value: transaction.value.toString(),
							chainId: 4663,
							assetId: execution.plan.quotes[index]?.assetId,
						});
						const quote = execution.plan.quotes[index];
						if (!quote) throw new Error("EXECUTION_QUOTE_MISSING");
						const localLiveTransferMatch =
							deps.config.localLiveExecution &&
							receipt.status === "success" &&
							spentTransferAmount(
								receipt.logs,
								USDG_ADDRESS,
								transaction.from,
							) === BigInt(quote.amountInBaseUnits);
						if (
							transaction.from.toLowerCase() !== session.wallet ||
							(callHash !== execution.plan.callCommitments[index] &&
								!localLiveTransferMatch)
						) {
							throw new Error("TRANSACTION_PLAN_MISMATCH");
						}
						const amountOutBaseUnits =
							receipt.status === "success"
								? settledTransferAmount(
										receipt.logs,
										quote.tokenOut,
										session.wallet,
									)
								: 0n;
						return {
							state:
								receipt.status === "success" && amountOutBaseUnits > 0n
									? ("success" as const)
									: ("failed" as const),
							settledOutput: {
								assetId: quote.assetId,
								amountOutBaseUnits: amountOutBaseUnits.toString(),
								transactionHash: hash,
								blockNumber: receipt.blockNumber.toString(),
								status:
									receipt.status === "success" && amountOutBaseUnits > 0n
										? ("success" as const)
										: ("failed" as const),
							},
						};
					} catch (error) {
						if (
							error instanceof Error &&
							error.message === "TRANSACTION_PLAN_MISMATCH"
						)
							throw error;
						return { state: "pending" as const };
					}
				}),
			);
			if (outcomes.some((outcome) => outcome.state === "pending")) {
				response.status(202).json({
					...execution,
					reconciliation: outcomes.map((outcome) => outcome.state),
				});
				return;
			}
			const successCount = outcomes.filter(
				(outcome) => outcome.state === "success",
			).length;
			const status =
				successCount === outcomes.length
					? "SETTLED"
					: successCount > 0
						? "PARTIAL"
						: "FAILED";
			const settledOutputs = outcomes
				.map((outcome) =>
					"settledOutput" in outcome ? outcome.settledOutput : undefined,
				)
				.filter(
					(output): output is NonNullable<typeof output> =>
						output !== undefined,
				);
			response.json(
				await deps.store.updateExecution(
					execution.plan.executionId,
					status,
					execution.transactionHashes,
					settledOutputs,
				),
			);
		},
	);

	app.get(
		"/api/executions/:executionId",
		requireWallet,
		async (request, response) => {
			const execution = await deps.store.getExecution(
				String(request.params.executionId),
			);
			if (!execution) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			const session = await deps.store.getSession(execution.plan.sessionId);
			if (
				!session ||
				session.wallet !== response.locals.wallet ||
				session.chain !== response.locals.chain
			) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
				return;
			}
			response.json(execution);
		},
	);

	app.post(
		"/api/positions/:assetId/exit/quote",
		requireWallet,
		async (request, response) => {
			const amountInBaseUnits = baseUnitsSchema.parse(
				request.body?.amountInBaseUnits,
			);
			if (BigInt(amountInBaseUnits) <= 0n) {
				response.status(422).json({ error: "EXIT_AMOUNT_REQUIRED" });
				return;
			}
			const selectedProvider =
				(await preferencesFor(response))
					?.executionProvider ?? "ZERO_EX";
			const selectedChain = response.locals.chain ?? "ROBINHOOD";
			const candidatesForExit = candidateProvider(deps, selectedProvider, selectedChain);
			const executionForExit = executionProvider(deps, selectedProvider, selectedChain);
			const candidates =
				await candidatesForExit.getCandidatesForExecution(
				response.locals.wallet,
				[String(request.params.assetId)],
				undefined,
				undefined,
				response.locals.txOrigin,
			);
			const candidate = candidates[0];
			if (
				!candidate?.eligible ||
				!candidate.marketHealthy ||
				!candidate.permissionAllowed
			) {
				response.status(422).json({ error: "EXIT_ROUTE_UNAVAILABLE" });
				return;
			}
			const preparation = await executionForExit.prepareExit(
				response.locals.wallet,
				candidate,
				amountInBaseUnits,
				50,
				response.locals.txOrigin,
			);
			if (preparation.solanaTransaction) {
				solanaExitPreparations.set(
					`${preferenceOwner(response)}:${request.params.assetId}`,
					{
						wallet: response.locals.wallet,
						assetId: candidate.assetId,
						provider: selectedProvider,
						prepared: preparation.solanaTransaction,
					},
				);
			}
			response.json({
				kind: preparation.solanaTransaction ? "SOLANA_TRANSACTION" : "EVM_CALLS",
				provider: selectedProvider,
				asset: {
					assetId: candidate.assetId,
					symbol: candidate.symbol,
					decimals: candidate.decimals,
				},
				...preparation,
			});
		},
	);

	app.post(
		"/api/positions/:assetId/exit/submit",
		requireWallet,
		async (request, response) => {
			const key = `${preferenceOwner(response)}:${request.params.assetId}`;
			const exit = solanaExitPreparations.get(key);
			if (!exit || exit.wallet !== response.locals.wallet) {
				response.status(409).json({ error: "EXIT_PREPARATION_EXPIRED" });
				return;
			}
			const provider = executionProvider(deps, exit.provider, "SOLANA");
			if (!provider.submitSignedTransaction) {
				throw new Error("SOLANA_SUBMISSION_UNAVAILABLE");
			}
			const signature = await provider.submitSignedTransaction(
				exit.prepared,
				z.string().min(1).parse(request.body?.signedTransaction),
			);
			solanaExitPreparations.set(key, { ...exit, signature });
			response.json({ signature, status: "SUBMITTED" });
		},
	);

	app.get(
		"/api/positions/:assetId/exit/status",
		requireWallet,
		async (request, response) => {
			const key = `${preferenceOwner(response)}:${request.params.assetId}`;
			const exit = solanaExitPreparations.get(key);
			if (!exit?.signature || exit.wallet !== response.locals.wallet) {
				response.status(404).json({ error: "EXIT_NOT_FOUND" });
				return;
			}
			const provider = executionProvider(deps, exit.provider, "SOLANA");
			if (!provider.transactionStatus || !provider.reconcileOutputs) {
				throw new Error("SOLANA_RECONCILIATION_UNAVAILABLE");
			}
			const status = await provider.transactionStatus(exit.signature);
			if (status.state !== "CONFIRMED") {
				response
					.status(status.state === "PENDING" ? 202 : 200)
					.json({ signature: exit.signature, status: status.state });
				return;
			}
			const outputs = await provider.reconcileOutputs(
				exit.signature,
				exit.wallet,
				exit.prepared.expectedBalanceChanges,
			);
			if (!outputs) {
				response.status(202).json({
					signature: exit.signature,
					status: "PENDING",
				});
				return;
			}
			const settled = outputs.every((output) => output.status === "success");
			if (settled) solanaExitPreparations.delete(key);
			response.json({
				signature: exit.signature,
				status: settled ? "SETTLED" : "FAILED",
				outputs,
			});
		},
	);

	if (deps.config.NODE_ENV === "production") {
		const clientPath = path.resolve("dist/client");
		app.use(
			"/assets",
			express.static(path.join(clientPath, "assets"), {
				immutable: true,
				maxAge: "1y",
			}),
		);
		app.use(express.static(clientPath, { maxAge: 0 }));
		app.get("*splat", (_request, response) =>
			response.sendFile(path.join(clientPath, "index.html")),
		);
	}

	app.use(
		(
			error: unknown,
			_request: Request,
			response: Response,
			_next: NextFunction,
		) => {
			if (error instanceof ZodError) {
				response.status(422).json({
					error: "INVALID_REQUEST",
					message:
						"Choose at least one eligible asset and check the basket details before continuing.",
				});
				return;
			}
			if (error instanceof ExecutionProviderError) {
				response.status(422).json({
					error: error.code,
					message: publicProviderError(error),
					provider: error.provider,
				});
				return;
			}
			const known = error instanceof PolicyError || error instanceof Error;
			const code = error instanceof PolicyError ? error.code : "REQUEST_FAILED";
			const message = known ? (error as Error).message : "Unexpected error";
			response
				.status(error instanceof PolicyError ? 422 : 400)
				.json({ error: code, message });
		},
	);
	return app;
}

function executionProvider(
	deps: AppDependencies,
	id: ExecutionProviderId,
	chain: "ROBINHOOD" | "SOLANA" = "ROBINHOOD",
): ExecutionProvider {
	const registry = chain === "SOLANA" ? deps.solanaExecutionProviders : deps.executionProviders;
	const provider = registry
		? registry[id]
		: deps.execution;
	if (!provider) {
		throw new ExecutionProviderError(
			id,
			"PROVIDER_UNAVAILABLE",
			`${id}_PROVIDER_UNAVAILABLE`,
		);
	}
	return provider;
}

async function resolveAsset(deps: AppDependencies, assetId: string) {
	const registered =
		Object.values(ASSET_REGISTRY).find((item) => item.assetId === assetId) ??
		solanaAssetById(assetId);
	if (registered) return registered;
	const providers = new Set<CandidateProvider>([
		deps.candidates,
		...Object.values(deps.candidateProviders ?? {}).filter(
			(provider): provider is CandidateProvider => Boolean(provider),
		),
		...Object.values(deps.solanaCandidateProviders ?? {}).filter(
			(provider): provider is CandidateProvider => Boolean(provider),
		),
	]);
	for (const provider of providers) {
		try {
			const asset = await provider.getAsset?.(assetId);
			if (asset) return asset;
		} catch {
			// Continue across provider registries; history is optional enrichment.
		}
	}
	return undefined;
}

function candidateProvider(
	deps: AppDependencies,
	id: ExecutionProviderId,
	chain: "ROBINHOOD" | "SOLANA" = "ROBINHOOD",
): CandidateProvider {
	const registry = chain === "SOLANA" ? deps.solanaCandidateProviders : deps.candidateProviders;
	const provider = registry
		? registry[id]
		: deps.candidates;
	if (!provider) {
		throw new ExecutionProviderError(
			id,
			"PROVIDER_UNAVAILABLE",
			`${id}_PROVIDER_UNAVAILABLE`,
		);
	}
	return provider;
}

async function rankFeed(
	deps: AppDependencies,
	requestedProvider: FeedRankingProviderId,
	input: RankingInput,
) {
	const registry = deps.rankingProviders;
	const deterministic = registry?.DETERMINISTIC;
	const requested =
		requestedProvider === "DETERMINISTIC"
			? deterministic ?? deps.inference
			: registry
				? registry.ZERO_G
				: deps.inference;
	const fallbackWarning =
		"0G private AI ranking was unavailable. Deterministic ranking was used.";

	if (requested) {
		try {
			const generated = await requested.rank(input);
			const effectiveProvider =
				requestedProvider === "ZERO_G" && registry && !registry.ZERO_G
					? "DETERMINISTIC"
					: requestedProvider;
			const warnings =
				effectiveProvider === "DETERMINISTIC" &&
				requestedProvider === "ZERO_G"
					? [...generated.output.warnings, fallbackWarning]
					: generated.output.warnings;
			return {
				output: { ...generated.output, warnings },
				receipt: {
					...generated.receipt,
					requestedProvider,
					effectiveProvider,
					warnings,
				},
			};
		} catch (error) {
			if (requestedProvider !== "ZERO_G" || !deterministic) throw error;
		}
	}

	if (!deterministic) {
		throw new Error(`${requestedProvider}_RANKING_PROVIDER_UNAVAILABLE`);
	}
	const generated = await deterministic.rank(input);
	const warnings =
		requestedProvider === "ZERO_G"
			? [...generated.output.warnings, fallbackWarning]
			: generated.output.warnings;
	return {
		output: { ...generated.output, warnings },
		receipt: {
			...generated.receipt,
			requestedProvider,
			effectiveProvider: "DETERMINISTIC" as const,
			warnings,
		},
	};
}

function providerConfigured(
	config: AppConfig,
	id: ExecutionProviderId,
	chain: "ROBINHOOD" | "SOLANA" = "ROBINHOOD",
) {
	if (chain === "SOLANA" && id === "ZERO_EX") {
		return Boolean(
			config.ZERO_EX_API_KEY &&
				config.JUPITER_API_KEY &&
				config.SOLANA_RPC_URL &&
				config.SOLANA_WS_URL,
		);
	}
	if (id === "JUPITER") {
		return Boolean(
			config.JUPITER_API_KEY &&
				config.SOLANA_RPC_URL &&
				config.SOLANA_WS_URL,
		);
	}
	if (!config.liveExecution) return true;
	return id === "ZERO_EX"
		? Boolean(config.ZERO_EX_API_KEY)
		: Boolean(config.UNISWAP_API_KEY);
}

async function solanaRpc<T>(
	fetcher: typeof fetch,
	rpcUrl: string,
	request: { id: number; method: string; params: unknown[] },
) {
	const response = await fetcher(rpcUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", ...request }),
	});
	if (!response.ok) throw new Error("SOLANA_RPC_BALANCE_UNAVAILABLE");
	const payload = (await response.json()) as {
		result?: T;
		error?: { message?: string };
	};
	if (!payload.result || payload.error) {
		throw new Error("SOLANA_RPC_BALANCE_UNAVAILABLE");
	}
	return payload.result;
}

async function solanaUsdcBalance(
	fetcher: typeof fetch,
	rpcUrl: string,
	address: string,
) {
	const tokenAccounts = await solanaRpc<{
		value?: Array<{
			account?: {
				data?: {
					parsed?: { info?: { tokenAmount?: { amount?: string } } };
				};
			};
		}>;
	}>(fetcher, rpcUrl, {
		id: 2,
		method: "getTokenAccountsByOwner",
		params: [
			address,
			{ mint: SOLANA_USDC_MINT },
			{ encoding: "jsonParsed", commitment: "confirmed" },
		],
	});
	return (tokenAccounts.value ?? []).reduce(
		(sum, account) =>
			sum +
			BigInt(account.account?.data?.parsed?.info?.tokenAmount?.amount ?? "0"),
		0n,
	);
}

function providerLabel(id: ExecutionProviderId) {
	return id === "ZERO_EX" ? "0x" : id === "JUPITER" ? "Jupiter" : "Uniswap";
}

function assetExplorerUrl(assetId: string, address: string) {
	if (/^0x0{40}$/i.test(address)) return undefined;
	return assetId.startsWith("sol:")
		? `https://explorer.solana.com/address/${encodeURIComponent(address)}`
		: `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(address)}`;
}

function publicProviderError(error: ExecutionProviderError) {
	if (error.code === "PROVIDER_UNAVAILABLE") {
		return error.message === `${error.provider}_PROVIDER_UNAVAILABLE`
			? `${providerLabel(error.provider)} is not configured.`
			: `${providerLabel(error.provider)} is temporarily unavailable.`;
	}
	if (error.code === "TOKEN_UNAUTHORIZED") {
		return `This token is not currently supported by ${providerLabel(error.provider)}.`;
	}
	if (error.code === "INSUFFICIENT_LIQUIDITY") {
		return `No ${providerLabel(error.provider)} route is available at this amount.`;
	}
	if (error.code === "UNSUPPORTED_CHAIN") {
		return `${providerLabel(error.provider)} does not support the selected chain.`;
	}
	if (error.code === "BASKET_TOO_LARGE") return error.message;
	if (error.code === "INSUFFICIENT_FUNDS") return error.message;
	if (error.code === "SIMULATION_FAILED") {
		return "The complete Solana basket did not simulate successfully.";
	}
	if (error.code === "INVALID_TRANSACTION") return error.message;
	return `This token is not valid for ${providerLabel(error.provider)}.`;
}

function demoHistory(symbol: string, period: HistoryPeriod): PricePoint[] {
	const seed = [...symbol].reduce(
		(value, character) => value + character.charCodeAt(0),
		0,
	);
	const now = Math.floor(Date.now() / 1000);
	const spanSeconds = {
		"1H": 3_600,
		"1D": 86_400,
		"1W": 7 * 86_400,
		"1M": 30 * 86_400,
		"1Y": 365 * 86_400,
		ALL: 3 * 365 * 86_400,
	}[period];
	return Array.from({ length: 31 }, (_, index) => {
		const drift = index * ((seed % 7) - 2) * 0.0018;
		const wave = Math.sin(index * 0.7 + seed) * 0.018;
		return {
			timestamp: now - ((30 - index) * spanSeconds) / 30,
			price: 100 * (1 + drift + wave),
		};
	});
}

function serverTiming(route: "feed" | "prepare", log: boolean) {
	const startedAt = performance.now();
	let stageStartedAt = startedAt;
	const stages: Array<{ name: string; duration: number }> = [];
	return {
		mark(name: string) {
			const now = performance.now();
			stages.push({ name, duration: now - stageStartedAt });
			stageStartedAt = now;
		},
		apply(response: Response) {
			const total = performance.now() - startedAt;
			if (log) {
				console.log(
					JSON.stringify({
						event: "request_timing",
						route,
						stages: Object.fromEntries(
							stages.map((stage) => [
								stage.name,
								Number(stage.duration.toFixed(1)),
							]),
						),
						totalMs: Number(total.toFixed(1)),
					}),
				);
			}
			response.setHeader(
				"Server-Timing",
				[
					...stages.map(
						(stage) => `${stage.name};dur=${stage.duration.toFixed(1)}`,
					),
					`total;dur=${total.toFixed(1)}`,
				].join(", "),
			);
		},
	};
}

const TRANSFER_TOPIC =
	"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function settledTransferAmount(
	logs: readonly {
		address: string;
		data: string;
		topics: readonly string[];
	}[],
	token: string,
	wallet: string,
) {
	const recipientTopic = `0x${"0".repeat(24)}${wallet.slice(2)}`.toLowerCase();
	return logs.reduce((sum, log) => {
		if (
			log.address.toLowerCase() !== token.toLowerCase() ||
			log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
			log.topics[2]?.toLowerCase() !== recipientTopic
		) {
			return sum;
		}
		return sum + BigInt(log.data);
	}, 0n);
}

type AlchemyPortfolioToken = {
	tokenAddress?: string | null;
	tokenBalance?: string;
	tokenMetadata?: {
		decimals?: number | null;
		logo?: string | null;
		name?: string | null;
		symbol?: string | null;
	};
	tokenPrices?: Array<{
		currency: string;
		value: string;
		lastUpdatedAt?: string;
	}>;
};

type AlchemyPortfolioResponse = {
	data?: { tokens?: AlchemyPortfolioToken[]; pageKey?: string | null };
};

function alchemyPortfolioEndpoint(rpcUrl?: string) {
	if (!rpcUrl) return undefined;
	try {
		const parsed = new URL(rpcUrl);
		if (!parsed.hostname.endsWith("alchemy.com")) return undefined;
		const apiKey = parsed.pathname.split("/").filter(Boolean).at(-1);
		return apiKey
			? `https://api.g.alchemy.com/data/v1/${apiKey}/assets/tokens/balances/by-address`
			: undefined;
	} catch {
		return undefined;
	}
}

function hexBalanceToDecimal(value?: string) {
	if (!value) return "0";
	try {
		return BigInt(value).toString();
	} catch {
		return "0";
	}
}

/**
 * Local-live recovery can accept a wallet-modified calldata envelope only when
 * the authenticated wallet actually debited the exact USDG amount. Production
 * execution keeps the stricter signed-call commitment check above.
 */
function spentTransferAmount(
	logs: readonly {
		address: string;
		data: string;
		topics: readonly string[];
	}[],
	token: string,
	wallet: string,
) {
	const senderTopic = `0x${"0".repeat(24)}${wallet.slice(2)}`.toLowerCase();
	return logs.reduce((sum, log) => {
		if (
			log.address.toLowerCase() !== token.toLowerCase() ||
			log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
			log.topics[1]?.toLowerCase() !== senderTopic
		) {
			return sum;
		}
		return sum + BigInt(log.data);
	}, 0n);
}
