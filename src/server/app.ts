import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { signRequest } from "@worldcoin/idkit-core/signing";
import { createPublicClient, http, type Address } from "viem";
import { z, ZodError } from "zod";
import {
	addressSchema,
	baseUnitsSchema,
	budgetForTicket,
	executionRequestSchema,
	feedInputSchema,
	onboardingPreferencesSchema,
	personalizationPreferencesSchema,
} from "../domain/schemas.js";
import { DEFAULT_BUDGET } from "../domain/schemas.js";
import { sha256 } from "../domain/canonical.js";
import { executionIntent } from "../domain/execution-intent.js";
import {
	FEED_PAGE_SIZE,
	POLICY_VERSION,
	USDG_ADDRESS,
	USDG_DECIMALS,
} from "../domain/constants.js";
import {
	eligibleCandidates,
	policyHash,
	PolicyError,
	validateExecutionAssets,
	validateExecutionSelection,
	validateFeed,
} from "../domain/policy.js";
import { PrivyWalletAuth } from "./auth.js";
import type { AppConfig } from "./config.js";
import type {
	CandidateProvider,
	ExecutionProvider,
	PrivateInferenceProvider,
} from "./adapters/types.js";
import type { StateStore } from "./store.js";
import type { AssetIconProvider } from "./adapters/coingecko.js";
import { sessionEpochId } from "./session-epoch.js";

export interface AppDependencies {
	config: AppConfig;
	store: StateStore;
	candidates: CandidateProvider;
	inference: PrivateInferenceProvider;
	execution: ExecutionProvider;
	icons?: AssetIconProvider;
}

export function createApp(deps: AppDependencies) {
	const app = express();
	const auth = new PrivyWalletAuth(
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
						"https://*.world.org",
						"https://coin-images.coingecko.com",
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
						"wss://relay.walletconnect.com",
						"wss://relay.walletconnect.org",
						"wss://www.walletlink.org",
						"https://developer.world.org",
						"https://*.world.org",
						"wss://*.world.org",
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
			limit: deps.config.liveExecution ? 60 : 240,
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
			periodBudgetBaseUnits: DEFAULT_BUDGET.periodBudgetBaseUnits,
			slotBudgetBaseUnits: DEFAULT_BUDGET.slotBudgetBaseUnits,
			maxCards: DEFAULT_BUDGET.maxCards,
			privy: { appId: deps.config.PRIVY_APP_ID },
			world: deps.config.demoMode
				? null
				: {
						appId: deps.config.WORLD_APP_ID,
						rpId: deps.config.WORLD_RP_ID,
						action: deps.config.WORLD_ACTION,
					},
		});
	});

	app.get("/api/assets/icons", async (_request, response) => {
		try {
			response.json({ icons: (await deps.icons?.getIcons()) ?? {} });
		} catch {
			response.json({ icons: {} });
		}
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

	const requireWallet = async (
		request: Request,
		response: Response,
		next: NextFunction,
	) => {
		if (!deps.config.liveExecution) {
			response.locals.wallet = "0x71f30000000000000000000000000000000009a2";
			next();
			return;
		}
		try {
			response.locals.wallet = await auth.wallet(request);
			next();
		} catch {
			response.status(401).json({ error: "AUTH_REQUIRED" });
		}
	};

	app.post("/api/world/rp-signature", requireWallet, (_request, response) => {
		if (!deps.config.liveExecution || deps.config.localLiveExecution) {
			response.json({ demoMode: true, action: deps.config.WORLD_ACTION });
			return;
		}
		const signingKey = deps.config.WORLD_RP_SIGNING_KEY;
		if (!signingKey) throw new Error("WORLD_RP_SIGNING_KEY_REQUIRED");
		const signed = signRequest({
			signingKeyHex: signingKey,
			action: deps.config.WORLD_ACTION,
		});
		response.json({
			sig: signed.sig,
			nonce: signed.nonce,
			created_at: signed.createdAt,
			expires_at: signed.expiresAt,
			app_id: deps.config.WORLD_APP_ID,
			rp_id: deps.config.WORLD_RP_ID,
			action: deps.config.WORLD_ACTION,
		});
	});

	app.post("/api/world/verify", requireWallet, async (request, response) => {
		if (request.body?.action !== deps.config.WORLD_ACTION) {
			response.status(422).json({ error: "WORLD_ACTION_MISMATCH" });
			return;
		}
		if (!deps.config.liveExecution || deps.config.localLiveExecution) {
			response.status(501).json({
				error: "WORLD_DEMO_NOT_FORGED",
				message:
					"Use World staging IDKit; investmade.fun never manufactures a proof.",
			});
			return;
		}
		const worldResponse = await fetch(
			`https://developer.world.org/api/v4/verify/${deps.config.WORLD_RP_ID}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request.body),
				signal: AbortSignal.timeout(15_000),
			},
		);
		const result = (await worldResponse.json()) as {
			success?: boolean;
			nullifier?: string;
			results?: Array<{ success?: boolean; nullifier?: string }>;
		};
		if (!worldResponse.ok || result.success !== true) {
			response.status(422).json({ error: "WORLD_VERIFICATION_FAILED" });
			return;
		}
		const nullifier =
			result.nullifier ??
			result.results?.find((item) => item.success)?.nullifier;
		if (!nullifier) {
			response.status(422).json({ error: "WORLD_NULLIFIER_MISSING" });
			return;
		}
		const digest = createHmac("sha256", deps.config.SESSION_SECRET)
			.update(nullifier.toLowerCase())
			.digest("hex");
		await deps.store.bindHuman(response.locals.wallet, digest);
		response.json({ success: true, proofOfHumanVerified: true });
	});

	app.post("/api/sessions/open", requireWallet, async (request, response) => {
		const cadence = personalizationPreferencesSchema.shape.cadence.parse(
			request.body?.cadence,
		);
		// Demo and local-live are intentionally repeatable so a builder can sign
		// multiple test baskets during one cadence period. Production stays
		// idempotent per wallet and epoch at the StateStore boundary.
		const session = await deps.store.openSession(
			response.locals.wallet,
			sessionEpochId(cadence, deps.config),
		);
		response.json(session);
	});

	app.post(
		"/api/sessions/:sessionId/feed",
		requireWallet,
		async (request, response) => {
			const timing = serverTiming("feed", deps.config.NODE_ENV !== "test");
			const session = await deps.store.getSession(
				String(request.params.sessionId),
			);
			if (!session || session.wallet !== response.locals.wallet) {
				response.status(404).json({ error: "SESSION_NOT_FOUND" });
				return;
			}
			if (
				!deps.config.demoMode &&
				!(await deps.store.isHumanVerified(response.locals.wallet))
			) {
				response.status(403).json({ error: "WORLD_VERIFICATION_REQUIRED" });
				return;
			}
			const submittedPreferences = onboardingPreferencesSchema.parse(
				request.body,
			);
			const budget = budgetForTicket(submittedPreferences.ticketSizeUsd);
			const candidateLimit = z
				.number()
				.int()
				.min(1)
				.max(FEED_PAGE_SIZE)
				.optional()
				.parse(request.body?.candidateLimit) ?? FEED_PAGE_SIZE;
			const excludedAssetIds = z
				.array(z.string().min(1))
				.optional()
				.parse(request.body?.excludedAssetIds) ?? [];
			const { riskDisclosureAccepted: _accepted, ...preferences } =
				submittedPreferences;
			timing.mark("session");
			const generatedCandidates = await deps.candidates.getCandidates(
				response.locals.wallet,
				budget.slotBudgetBaseUnits,
				undefined,
				candidateLimit,
				excludedAssetIds,
			);
			timing.mark("candidates");
			// Candidate discovery uses bounded concurrency. Apply the exact policy
			// gate before inference so the AI can never rank a card that expired
			// while the rest of the feed was being assembled.
			const candidates = eligibleCandidates(
				generatedCandidates.filter((candidate) =>
					preferences.assetClasses.includes(candidate.kind),
				),
			).slice(0, Math.min(candidateLimit, budget.maxCards));
			if (!candidates.length) {
				response
					.status(422)
					.json({ error: "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES" });
				return;
			}
			const unsignedInput = {
				schemaVersion: "investmade-feed-input/v1" as const,
				sessionId: session.id,
				epochId: session.epochId,
				policyVersion: POLICY_VERSION,
				budget,
				preferences,
				candidates,
			};
			const input = feedInputSchema.parse({
				...unsignedInput,
				inputCommitment: sha256(unsignedInput),
			});
			const generated = await deps.inference.generate(input, candidates);
			const output = validateFeed(generated.output, input, candidates);
			timing.mark("inference");
			timing.apply(response);
			response.json({
				candidates,
				feed: output,
				proof: generated.receipt,
				hasMore: generatedCandidates.length === candidateLimit,
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
			if (!session || session.wallet !== response.locals.wallet) {
				response.status(404).json({ error: "SESSION_NOT_FOUND" });
				return;
			}
			const requestedIntent = executionIntent(session, parsed);
			const requestedPlanHash = sha256(requestedIntent);
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
				if (existing.plan.authorizedPlanHash !== requestedPlanHash) {
					response.status(409).json({
						error: "EPOCH_ALREADY_EXECUTED",
						message:
							"Quotes were prepared for a different basket. Start another basket to change the selection.",
						executionId: existing.plan.executionId,
						status: existing.status,
					});
					return;
				}
			}
			timing.mark("session");
			if (deps.config.liveExecution) {
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
			timing.mark("balance");
			const slotBudgetBaseUnits = parsed.selections[0]?.amountInBaseUnits;
			const candidates = await deps.candidates.getCandidatesForExecution(
				response.locals.wallet,
				parsed.selections.map((selection) => selection.assetId),
				slotBudgetBaseUnits,
			);
			validateExecutionAssets(parsed, candidates);
			timing.mark("candidates");
			const preparation = await deps.execution.prepare(
				response.locals.wallet,
				parsed,
				candidates,
			);
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
				chainId: parsed.chainId,
				inputToken: USDG_ADDRESS,
				totalInputBaseUnits: parsed.selections
					.reduce(
						(sum, selection) => sum + BigInt(selection.amountInBaseUnits),
						0n,
					)
					.toString(),
				authorizedPlanHash: requestedPlanHash,
				policyHash: policyHash(slotBudgetBaseUnits ?? "0"),
				callCommitments: preparation.walletCalls.map((call) =>
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
				generatedAt: new Date().toISOString(),
			};
			const execution = session.executionId
				? await deps.store.refreshPreparedExecution(session.executionId, plan)
				: await deps.store.reserveExecution(session.id, plan);
			timing.mark("store");
			timing.apply(response);
			response.json({ ...execution, walletCalls: preparation.walletCalls });
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
			if (!session || session.wallet !== response.locals.wallet) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
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
			if (!session || session.wallet !== response.locals.wallet) {
				response.status(404).json({ error: "EXECUTION_NOT_FOUND" });
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
			if (!session || session.wallet !== response.locals.wallet) {
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
			const candidates = await deps.candidates.getCandidates(
				response.locals.wallet,
			);
			const candidate = candidates.find(
				(item) => item.assetId === request.params.assetId,
			);
			if (
				!candidate?.eligible ||
				!candidate.marketHealthy ||
				!candidate.permissionAllowed
			) {
				response.status(422).json({ error: "EXIT_ROUTE_UNAVAILABLE" });
				return;
			}
			const preparation = await deps.execution.prepareExit(
				response.locals.wallet,
				candidate,
				amountInBaseUnits,
				50,
			);
			response.json({
				asset: {
					assetId: candidate.assetId,
					symbol: candidate.symbol,
					decimals: candidate.decimals,
				},
				...preparation,
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
