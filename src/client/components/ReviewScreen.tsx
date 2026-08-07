import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
	type ConnectedStandardSolanaWallet,
	useSignTransaction,
} from "@privy-io/react-auth/solana";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Address, formatUnits, type Hex } from "viem";
import type { Candidate } from "../../domain/schemas";
import { formatTicketSizeUsd } from "../../domain/schemas";
import type {
	ExecutionRecord,
	FeedResponse,
	WalletCall,
	WeeklySession,
} from "../api";
import { ApiError, api } from "../api";
import {
	executionMatchesReviewBasket,
	executionPlanHashMatchesReviewBasket,
	reviewBasketKey,
} from "../review-safety";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check, Close, Shield } from "./Icons";

const MIN_SIGNING_WINDOW_MS = 10_000;

export function ReviewScreen({
	session,
	feed,
	selected,
	onRemove,
	onBack,
	onSettled,
	onExecutionChange,
	onExecutionInvalidated,
	onSessionExpired,
	onStartAnotherBasket,
	onTopUp,
	ticketSizeUsd,
	periodLimitUsd,
	wallet,
	smartWalletReady,
	liveExecution,
	activeChain,
	solanaWallet,
}: {
	session: WeeklySession;
	feed: FeedResponse;
	selected: Candidate[];
	onRemove: (assetId: string) => void;
	onBack: () => void;
	onSettled: (record: ExecutionRecord) => void;
	onExecutionChange: (record: ExecutionRecord) => void;
	onExecutionInvalidated: () => void;
	onSessionExpired: () => Promise<{ sessionId: string; assetIds: string[] }>;
	onStartAnotherBasket: () => void;
	onTopUp: () => void;
	ticketSizeUsd: number;
	periodLimitUsd: number;
	wallet: string;
	smartWalletReady: boolean;
	liveExecution: boolean;
	activeChain: "ROBINHOOD" | "SOLANA";
	solanaWallet?: ConnectedStandardSolanaWallet;
}) {
	const { client: smartWalletClient, getClientForChain } = useSmartWallets();
	const { signTransaction } = useSignTransaction();
	const [record, setRecord] = useState<ExecutionRecord>();
	const [preparedBasketKey, setPreparedBasketKey] = useState("");
	const [loading, setLoading] = useState(true);
	const [phase, setPhase] = useState<
		"idle" | "refreshing" | "simulating" | "signing" | "settling"
	>("refreshing");
	const [error, setError] = useState("");
	const [errorCode, setErrorCode] = useState("");
	const [executionConflict, setExecutionConflict] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const [walletBalance, setWalletBalance] = useState<number>();
	const autoPrepareStarted = useRef(false);
	const preparationAttempt = useRef(0);
	const total = Math.round(selected.length * ticketSizeUsd * 100) / 100;
	const stableToken = activeChain === "SOLANA" ? "USDC" : "USDG";
	const basket = useMemo(
		() => ({
			sessionId: session.id,
			epochId: session.epochId,
			chain: activeChain,
			executionProvider: session.executionProvider,
			selected,
			ticketSizeUsd,
			periodLimitUsd,
			wallet,
		}),
		[
			selected,
			session.epochId,
			session.executionProvider,
			session.id,
			activeChain,
			ticketSizeUsd,
			periodLimitUsd,
			wallet,
		],
	);
	const basketKey = reviewBasketKey(basket);
	const currentBasketKey = useRef(basketKey);
	currentBasketKey.current = basketKey;
	const activeRecord =
		preparedBasketKey === basketKey &&
		executionMatchesReviewBasket(record, basket)
			? record
			: undefined;
	const atomicSolanaTransaction =
		activeRecord?.solanaTransaction ?? activeRecord?.plan.solanaTransaction;
	const solanaTransactions =
		activeRecord?.solanaTransactions ??
		activeRecord?.plan.solanaTransactions ??
		(atomicSolanaTransaction ? [atomicSolanaTransaction] : []);
	const perLegSolana = Boolean(activeRecord?.plan.solanaTransactions);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, []);
	useEffect(() => {
		if (!wallet) {
			setWalletBalance(undefined);
			return;
		}
		let cancelled = false;
		setWalletBalance(undefined);
		const request =
			activeChain === "SOLANA"
				? api
						.solanaBalance(wallet)
						.then(({ usdcBalanceBaseUnits, usdcDecimals }) =>
							Number(formatUnits(BigInt(usdcBalanceBaseUnits), usdcDecimals)),
						)
				: api
						.usdgBalance(wallet)
						.then(({ balanceBaseUnits, decimals }) =>
							Number(formatUnits(BigInt(balanceBaseUnits), decimals)),
						);
		void request
			.then((balance) => {
				if (!cancelled) setWalletBalance(balance);
			})
			.catch(() => {
				if (!cancelled) setWalletBalance(undefined);
			});
		return () => {
			cancelled = true;
		};
	}, [activeChain, wallet]);
	const quoteExpiry = useMemo(() => {
		const quotes =
			activeRecord?.plan.quotes ?? selected.flatMap((item) => item.quote ?? []);
		if (!quotes.length) return 0;
		return Math.max(
			0,
			Math.min(...quotes.map((quote) => new Date(quote.expiresAt).getTime())) -
				now,
		);
	}, [activeRecord, now, selected]);
	const quotesFresh = quoteExpiry > 0;
	const quotesSafeToSign = quoteExpiry > MIN_SIGNING_WINDOW_MS;
	const hasExecutableTransaction = Boolean(
		activeChain === "SOLANA"
			? solanaTransactions.length
			: activeRecord?.walletCalls?.length,
	);
	const executionWalletReady =
		activeChain === "SOLANA"
			? Boolean(solanaWallet && solanaWallet.address === wallet)
			: smartWalletReady;
	const quoteByAssetId = new Map(
		(activeRecord?.plan.quotes ?? []).map((quote) => [quote.assetId, quote]),
	);

	const prepare = useCallback(async () => {
		if (!selected.length) {
			setError("Choose at least one asset before refreshing quotes.");
			return;
		}
		const attempt = ++preparationAttempt.current;
		const requestedBasketKey = basketKey;
		setLoading(true);
		setPhase("refreshing");
		setError("");
		setErrorCode("");
		setExecutionConflict(false);
		try {
			const prepared = await api.prepareExecution(
				session.id,
				selected.map((item) => item.assetId),
				ticketSizeUsd,
				periodLimitUsd,
				activeChain,
			);
			if (
				attempt !== preparationAttempt.current ||
				requestedBasketKey !== currentBasketKey.current
			)
				return;
			setRecord(prepared);
			setPreparedBasketKey(requestedBasketKey);
			onExecutionChange(prepared);
		} catch (caught) {
			if (attempt !== preparationAttempt.current) return;
			const code = caught instanceof ApiError ? caught.code : "";
			const message = preparationErrorMessage(caught);
			setErrorCode(code);
			if (code === "ZERO_EX_ASSETS_UNAVAILABLE" && caught instanceof ApiError) {
				const unavailableAssetIds = Array.isArray(caught.details.assetIds)
					? caught.details.assetIds.filter(
							(assetId): assetId is string =>
								typeof assetId === "string" &&
								selected.some((candidate) => candidate.assetId === assetId),
						)
					: [];
				if (
					unavailableAssetIds.length > 0 &&
					unavailableAssetIds.length < selected.length
				) {
					autoPrepareStarted.current = false;
					setError(
						`${message} Removed the unavailable asset and refreshing the remaining basket.`,
					);
					setErrorCode("");
					for (const assetId of unavailableAssetIds) onRemove(assetId);
					return;
				}
			}
			if (code === "SESSION_NOT_FOUND") {
				try {
					const recovered = await onSessionExpired();
					const prepared = await api.prepareExecution(
						recovered.sessionId,
						recovered.assetIds,
						ticketSizeUsd,
						periodLimitUsd,
						activeChain,
					);
					if (attempt !== preparationAttempt.current) return;
					setRecord(prepared);
					setPreparedBasketKey(
						reviewBasketKey({
							...basket,
							sessionId: recovered.sessionId,
							epochId: prepared.plan.epochId,
							selected: selected.filter((candidate) =>
								recovered.assetIds.includes(candidate.assetId),
							),
						}),
					);
					onExecutionChange(prepared);
					setError("");
					setErrorCode("");
				} catch (recoveryError) {
					setError(
						recoveryError instanceof Error
							? recoveryError.message
							: "Could not renew local session",
					);
				}
			} else if (
				caught instanceof ApiError &&
				(code === "EXECUTION_TERMINAL" || code === "EPOCH_ALREADY_EXECUTED")
			) {
				const executionId =
					typeof caught.details.executionId === "string"
						? caught.details.executionId
						: "";
				if (executionId) {
					try {
						const existing = await api.execution(executionId);
						if (existing.status !== "PREPARED") {
							onExecutionChange(existing);
							onSettled(existing);
							return;
						}
					} catch {
						// The product recovery below is still actionable if rehydration fails.
					}
				}
				setRecord(undefined);
				setPreparedBasketKey("");
				setExecutionConflict(true);
				setError(message);
			} else {
				setError(message);
			}
		} finally {
			setLoading(false);
			setPhase("idle");
		}
	}, [
		basket,
		basketKey,
		onExecutionChange,
		onSessionExpired,
		onSettled,
		onRemove,
		selected,
		session.id,
		ticketSizeUsd,
		periodLimitUsd,
		activeChain,
	]);

	useEffect(() => {
		if (
			!record ||
			(preparedBasketKey === basketKey &&
				executionMatchesReviewBasket(record, basket))
		)
			return;
		preparationAttempt.current += 1;
		setRecord(undefined);
		setPreparedBasketKey("");
		setError("");
		setErrorCode("");
		setExecutionConflict(false);
		onExecutionInvalidated();
	}, [basketKey, basket, onExecutionInvalidated, preparedBasketKey, record]);

	useEffect(() => {
		if (activeRecord || autoPrepareStarted.current || !selected.length) return;
		autoPrepareStarted.current = true;
		void prepare();
	}, [activeRecord, prepare, selected]);

	async function settleDemo() {
		if (!activeRecord) return;
		setLoading(true);
		try {
			const settled = await api.demoSettle(activeRecord.plan.executionId);
			setRecord(settled);
			onExecutionChange(settled);
			onSettled(settled);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Settlement failed");
		} finally {
			setLoading(false);
		}
	}

	function removeAsset(assetId: string) {
		preparationAttempt.current += 1;
		setRecord(undefined);
		setPreparedBasketKey("");
		setError("");
		setErrorCode("");
		setExecutionConflict(false);
		onExecutionInvalidated();
		onRemove(assetId);
	}

	async function confirmLive() {
		const signingBasketKey = basketKey;
		if (
			activeRecord?.status !== "PREPARED" ||
			(activeChain === "SOLANA"
				? !solanaTransactions.length
				: !activeRecord.walletCalls?.length) ||
			!wallet ||
			!selected.length
		) {
			setError("No Investmade Wallet or executable calls are available.");
			return;
		}
		if (
			!quotesSafeToSign ||
			!(await executionPlanHashMatchesReviewBasket(activeRecord, basket)) ||
			signingBasketKey !== currentBasketKey.current
		) {
			setRecord(undefined);
			setPreparedBasketKey("");
			onExecutionInvalidated();
			setError(
				"The basket changed after preparation. Refresh quotes before signing.",
			);
			return;
		}
		if (activeChain === "SOLANA") {
			if (!solanaWallet || solanaWallet.address !== wallet) {
				setError(
					"Select the prepared Solana signing wallet before continuing.",
				);
				return;
			}
			setLoading(true);
			setError("");
			try {
				setPhase("signing");
				const signedTransactions: string[] = [];
				for (const [index, prepared] of solanaTransactions.entries()) {
					const { signedTransaction } = await signTransaction({
						transaction: base64ToBytes(prepared.unsignedTransactionBase64),
						wallet: solanaWallet,
						chain: "solana:mainnet",
						options: {
							uiOptions: {
								showWalletUIs: false,
								description: perLegSolana
									? `Sign swap ${index + 1} of ${solanaTransactions.length}. Swaps settle independently.`
									: `Invest ${formatTicketSizeUsd(total)} USDC through Jupiter. Every swap succeeds or none do.`,
								buttonText: perLegSolana
									? `Sign swap ${index + 1} of ${solanaTransactions.length}`
									: `Sign & invest ${formatTicketSizeUsd(total)} USDC`,
							},
						},
					});
					signedTransactions.push(bytesToBase64(signedTransaction));
				}
				const submitted = await api.submitSolana(
					activeRecord.plan.executionId,
					signedTransactions,
				);
				setRecord(submitted);
				onExecutionChange(submitted);
				if (["SETTLED", "PARTIAL", "FAILED"].includes(submitted.status)) {
					onSettled(submitted);
					return;
				}
				setPhase("settling");
				const reconciled = await reconcileUntilTerminal(
					activeRecord.plan.executionId,
				);
				setRecord(reconciled);
				onExecutionChange(reconciled);
				onSettled(reconciled);
			} catch (caught) {
				setError(executionErrorMessage(caught));
			} finally {
				setLoading(false);
				setPhase("idle");
			}
			return;
		}
		if (!smartWalletReady) {
			setError(
				"Activate your Investmade smart wallet before signing. External wallets can fund it, but cannot execute an atomic basket.",
			);
			return;
		}
		setLoading(true);
		setError("");
		try {
			const client =
				smartWalletClient ?? (await getClientForChain({ id: 4663 }));
			if (
				!client ||
				client.account.address.toLowerCase() !== wallet.toLowerCase()
			) {
				throw new Error("SMART_WALLET_ADDRESS_MISMATCH");
			}
			const calls = (activeRecord.walletCalls ?? []).map(smartWalletCall);
			setPhase("simulating");
			await client.prepareUserOperation({ calls });
			setPhase("signing");
			const transactionHash = await client.sendTransaction(
				{ calls },
				{
					uiOptions: {
						description: `Invest ${formatTicketSizeUsd(total)} USDG into ${selected.length} assets. All purchases succeed or none.`,
						buttonText: `Sign & invest ${formatTicketSizeUsd(total)} USDG`,
						showWalletUIs: false,
					},
				},
			);
			const submitted = await api.markSubmitted(
				activeRecord.plan.executionId,
				[transactionHash],
				true,
			);
			setRecord(submitted);
			onExecutionChange(submitted);
			setPhase("settling");
			const reconciled = await reconcileUntilTerminal(
				activeRecord.plan.executionId,
			);
			setRecord(reconciled);
			onExecutionChange(reconciled);
			onSettled(reconciled);
		} catch (caught) {
			setError(executionErrorMessage(caught));
		} finally {
			setLoading(false);
			setPhase("idle");
		}
	}

	async function resumeReconciliation() {
		if (!record) return;
		setLoading(true);
		setError("");
		try {
			const reconciled = await reconcileUntilTerminal(record.plan.executionId);
			setRecord(reconciled);
			onExecutionChange(reconciled);
			onSettled(reconciled);
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: "Could not verify settlement yet.",
			);
		} finally {
			setLoading(false);
		}
	}

	if (loading && phase === "refreshing") {
		return (
			<main
				className="loading-state review-preparing"
				aria-live="polite"
				aria-busy="true"
			>
				<span />
				<h1>Preparing your basket…</h1>
			</main>
		);
	}

	return (
		<main className="review-page">
			<section className="review-ledger">
				<header>
					<h1>Review your basket</h1>
					<p>
						{hasExecutableTransaction
							? `Fresh ${
									session.executionProvider === "ZERO_EX"
										? "0x"
										: session.executionProvider === "JUPITER"
											? "Jupiter"
											: "Uniswap"
								} quotes are ready for your wallet to confirm.${perLegSolana ? " Swaps settle independently, so partial completion is possible." : ""}`
							: liveExecution
								? "No transaction is prepared yet. Resolve the issue below, then refresh the quotes."
								: "Demo quotes are ready for a simulated confirmation."}
					</p>
					{error ? (
						<p className="review-error" role="alert">
							{error}
						</p>
					) : null}
				</header>
				<div className="ledger-table">
					<div className="ledger-row ledger-labels">
						<span>Asset</span>
						<span>Input (you pay)</span>
						<span>Estimated output</span>
						<span>Minimum output</span>
						<span>Impact</span>
					</div>
					{selected.map((candidate) => {
						const quote = quoteByAssetId.get(candidate.assetId);
						return (
							<div className="ledger-row" key={candidate.assetId}>
								<span className="ledger-asset">
									<AssetMark
										symbol={candidate.symbol}
										iconUrl={candidate.iconUrl}
										size="sm"
									/>
									<b>
										{candidate.symbol}
										<small>{candidate.name}</small>
									</b>
								</span>
								<span>
									<strong>{formatTicketSizeUsd(ticketSizeUsd)}</strong>{" "}
									{stableToken}
								</span>
								<span>
									<strong>
										{quote
											? formatOutput(
													quote.estimatedAmountOut,
													candidate.decimals,
												)
											: "—"}
									</strong>{" "}
									{candidate.symbol}
								</span>
								<span>
									<strong>
										{quote
											? formatOutput(quote.minimumAmountOut, candidate.decimals)
											: "—"}
									</strong>{" "}
									{candidate.symbol}
								</span>
								<span className="blue-text">
									{quote ? `${(quote.priceImpactBps / 100).toFixed(2)}%` : "—"}
								</span>
								<button
									type="button"
									className="ledger-remove"
									onClick={() => removeAsset(candidate.assetId)}
									aria-label={`Remove ${candidate.symbol}`}
								>
									<Close />
								</button>
							</div>
						);
					})}
				</div>
				<div className="ledger-totals">
					<div>
						<span>Wallet balance</span>
						<strong>
							{walletBalance === undefined
								? "—"
								: formatTicketSizeUsd(walletBalance)}
						</strong>
						<small>
							<b>{stableToken}</b>
						</small>
					</div>
					<div>
						<span>Total input</span>
						<strong>{formatTicketSizeUsd(total)}</strong>
						<small>
							<b>{stableToken}</b> to invest
						</small>
					</div>
					<div>
						<span>Remainder</span>
						<strong>
							{formatTicketSizeUsd(
								Math.round((periodLimitUsd - total) * 100) / 100,
							)}
						</strong>
						<small>
							<b>{stableToken}</b>
						</small>
					</div>
				</div>
			</section>

			<aside className="policy-rail">
				<h2>Policy checks</h2>
				{[
					{
						label: "Assets eligible",
						value: selected.length
							? `${selected.length} / ${selected.length}`
							: "No assets selected",
						ok: selected.length > 0,
					},
					{
						label: quotesSafeToSign
							? "Quotes fresh"
							: quotesFresh
								? "Quote nearly expired"
								: "Preview expired",
						value: quotesSafeToSign
							? `${Math.ceil(quoteExpiry / 1000)}s`
							: "Refresh required",
						ok: quotesSafeToSign,
					},
					{
						label: "Budget within limit",
						value: `${formatTicketSizeUsd(total)} / ${formatTicketSizeUsd(periodLimitUsd)} ${stableToken}`,
						ok: selected.length > 0,
					},
					{
						label: "Execution provider",
						value:
							session.executionProvider === "ZERO_EX"
								? "0x"
								: session.executionProvider === "JUPITER"
									? "Jupiter"
									: "Uniswap",
						ok: true,
					},
					{
						label:
							activeChain === "SOLANA"
								? "Solana · Mainnet"
								: "Robinhood Chain · 4663",
						value: "Connected",
						ok: true,
					},
					{
						label: hasExecutableTransaction
							? activeChain === "SOLANA"
								? perLegSolana
									? "Independent Solana swaps"
									: "Atomic Solana transaction"
								: "Atomic Investmade Wallet"
							: liveExecution
								? "Live execution"
								: "Demo execution",
						value: hasExecutableTransaction
							? executionWalletReady
								? "Ready"
								: "Activation required"
							: liveExecution
								? "Quotes required"
								: "Simulated",
						ok: hasExecutableTransaction
							? executionWalletReady
							: !liveExecution,
					},
				].map(({ label, value, ok }) => (
					<div className="policy-row" key={label}>
						<span
							className={ok ? "check-circle" : "check-circle warning-circle"}
						>
							{ok ? <Check /> : "!"}
						</span>
						<b>{label}</b>
						<em>{value}</em>
					</div>
				))}
				{hasExecutableTransaction || !liveExecution ? (
					<div className="wallet-boundary">
						<Shield />
						{hasExecutableTransaction ? (
							<p>
								<b>One confirmation · all-or-nothing.</b>
								<br />
								The complete call set is simulated, signed once, and submitted
								as one atomic basket.
							</p>
						) : (
							<p>
								<b>Demo only · no broadcast.</b>
								<br />
								This simulates basket confirmation and settlement without moving
								funds.
							</p>
						)}
					</div>
				) : null}
				<div className="proof-block">
					<h3>
						{feed.proof.teeVerified
							? "0G Private Allocation Jury"
							: "Personal feed ranking"}
					</h3>
					<p>
						<span>Ranking model</span>
						<b>{feed.proof.model}</b>
					</p>
					<p>
						<span>Provider</span>
						<b>
							{feed.proof.teeVerified
								? shortHash(feed.proof.provider)
								: "Local fixture"}
						</b>
					</p>
					<p>
						<span>Input commitment</span>
						<b>{shortHash(feed.proof.inputCommitment)}</b>
					</p>
					<p>
						<span>Output commitment</span>
						<b>{shortHash(feed.proof.outputCommitment)}</b>
					</p>
					<p>
						<span>TEE verified</span>
						<b>
							{feed.proof.teeVerified ? "Verified" : "Not available in demo"}
						</b>
					</p>
					{feed.proof.teeVerified ? (
						<div className="proof-links">
							<a
								href={zeroGProviderUrl(feed.proof.provider)}
								target="_blank"
								rel="noreferrer"
							>
								View TEE provider on 0G Explorer ↗
							</a>
							<a href="https://0g.ai/product" target="_blank" rel="noreferrer">
								How 0G private inference works ↗
							</a>
						</div>
					) : null}
				</div>
				{executionConflict ? (
					<button
						type="button"
						className="button button-outline"
						onClick={onStartAnotherBasket}
					>
						Start another basket
					</button>
				) : null}
				<div className="review-actions">
					<button
						type="button"
						className="button button-outline"
						onClick={onBack}
					>
						Back to cards
					</button>
					{!activeRecord ? (
						<button
							type="button"
							className="button button-primary"
							onClick={
								errorCode === "INSUFFICIENT_SMART_WALLET_USDG"
									? onTopUp
									: prepare
							}
							disabled={loading || !selected.length}
						>
							{loading
								? "Refreshing…"
								: errorCode === "INSUFFICIENT_SMART_WALLET_USDG"
									? "Top up Investmade Wallet"
									: "Refresh quotes"}{" "}
							{loading ? (
								<LoaderCircle className="button-spinner" />
							) : errorCode === "INSUFFICIENT_SMART_WALLET_USDG" ? (
								<ArrowRight />
							) : (
								<RotateCcw />
							)}
						</button>
					) : (
						<button
							type="button"
							className="button button-primary"
							onClick={
								activeRecord.status === "SUBMITTED"
									? resumeReconciliation
									: !quotesSafeToSign
										? prepare
										: hasExecutableTransaction
											? confirmLive
											: settleDemo
							}
							disabled={
								loading || !selected.length || activeRecord.status === "SETTLED"
							}
						>
							{activeRecord.status === "SETTLED"
								? "Settled"
								: loading
									? phaseLabel(phase)
									: activeRecord.status === "SUBMITTED"
										? "Check settlement receipt"
										: !quotesSafeToSign
											? "Refresh quotes"
											: hasExecutableTransaction
												? `Sign & invest ${formatTicketSizeUsd(total)} ${stableToken}`
												: "Simulate wallet confirmation"}{" "}
							{loading ? (
								<LoaderCircle className="button-spinner" />
							) : activeRecord.status !== "SETTLED" &&
								activeRecord.status !== "SUBMITTED" &&
								!quotesSafeToSign ? (
								<RotateCcw />
							) : (
								<ArrowRight />
							)}
						</button>
					)}
				</div>
			</aside>

			<section className="execution-strip">
				<h2>Execution progress</h2>
				{(hasExecutableTransaction
					? ["Awaiting signature", "Submitted", "Settled"]
					: liveExecution
						? ["Quotes required", "Wallet confirmation", "Settlement"]
						: ["Ready", "Simulated", "Complete"]
				).map((step, index) => {
					const active = activeRecord
						? activeRecord.status === "SETTLED"
							? index <= 2
							: index === 0
						: index === 0;
					return (
						<div
							className={active ? "execution-step active" : "execution-step"}
							key={step}
						>
							<span>{active ? <Check /> : index + 1}</span>
							<b>{step}</b>
						</div>
					);
				})}
			</section>
		</main>
	);
}

function zeroGProviderUrl(provider: string) {
	return `https://explorer.0g.ai/mainnet/blockchain/accounts/${encodeURIComponent(provider)}`;
}

function smartWalletCall(call: WalletCall): {
	to: Address;
	data: Hex;
	value: bigint;
} {
	const { transaction } = call;
	return {
		to: transaction.to as Address,
		data: transaction.data as Hex,
		value: BigInt(transaction.value),
	};
}

function executionErrorMessage(caught: unknown) {
	if (
		caught instanceof Error &&
		/smart wallet|bundler|paymaster|user operation|insufficient funds/i.test(
			caught.message,
		)
	) {
		return "The atomic basket could not pass smart-wallet preflight. Check Investmade Wallet funding and the Robinhood Chain bundler configuration, then retry.";
	}
	return caught instanceof Error ? caught.message : "Wallet execution failed.";
}

function preparationErrorMessage(caught: unknown) {
	const message =
		caught instanceof Error ? caught.message : "Could not prepare execution";
	if (
		message.includes("not_authorized_for_trade") ||
		message.toLowerCase().includes("legal restrictions")
	) {
		return "0x cannot trade one or more selected assets on Robinhood Chain because the token is not authorized. Remove the unavailable stock token or choose a supported crypto asset.";
	}
	return message;
}

function formatOutput(raw: string, decimals: number) {
	const value = Number(formatUnits(BigInt(raw), decimals));
	return Number.isFinite(value)
		? value.toLocaleString(undefined, { maximumSignificantDigits: 6 })
		: "—";
}

function shortHash(hash: string) {
	return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function base64ToBytes(value: string) {
	const binary = window.atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return window.btoa(binary);
}

async function reconcileUntilTerminal(
	executionId: string,
): Promise<ExecutionRecord> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const record = await api.reconcile(executionId);
		if (["SETTLED", "PARTIAL", "FAILED"].includes(record.status)) return record;
		await new Promise((resolve) =>
			setTimeout(resolve, attempt < 12 ? 500 : 1_500),
		);
	}
	throw new Error(
		"Transactions are submitted but not terminal yet. Check Receipts shortly.",
	);
}

function phaseLabel(
	phase: "idle" | "refreshing" | "simulating" | "signing" | "settling",
) {
	if (phase === "refreshing") return "Refreshing quotes…";
	if (phase === "simulating") return "Simulating full basket…";
	if (phase === "signing") return "Basket settlement";
	if (phase === "settling") return "Verifying settlement…";
	return "Working…";
}
