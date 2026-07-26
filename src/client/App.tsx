import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight as LucideArrowRight } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
	api,
	ApiError,
	configureApiAuth,
	type ExecutionRecord,
	type FeedResponse,
	type PublicConfig,
	type WeeklySession,
} from "./api";
import { AppShell } from "./components/AppShell";
import { ArrowRight } from "./components/Icons";
import { SwipeCard } from "./components/SwipeCard";
import { BudgetRail } from "./components/BudgetRail";
import { ReviewScreen } from "./components/ReviewScreen";
import { ReceiptScreen } from "./components/ReceiptScreen";
import { Onboarding } from "./components/Onboarding";
import { PositionsScreen } from "./components/PositionsScreen";
import { AccountScreen } from "./components/AccountScreen";
import { AssetIconProvider } from "./components/AssetMark";
import { Confetti } from "./components/magicui/confetti";
import {
	formatTicketSizeUsd,
	type Candidate,
	type OnboardingPreferences,
} from "../domain/schemas";
import {
	fillFeedPage,
	nextFeedExcludedAssetIds,
} from "../domain/feed-pagination";
import {
	removeLegacyPreferences,
	writeAccountPreferences,
} from "./preferences-storage";

type View = "week" | "positions" | "receipts" | "account";
type Stage = "loading" | "onboarding" | "swipe" | "review";
type DecisionFeedback = "invest" | "skip";
const LAST_EXECUTION_KEY = "investmade:last-execution";
const LAST_EXECUTION_CANDIDATES_KEY = "investmade:last-execution-candidates";

export function App({ config }: { config: PublicConfig }) {
	const {
		authenticated,
		getAccessToken,
		login,
		ready: privyReady,
		user,
	} = usePrivy();
	const { wallets, ready: walletsReady } = useWallets();
	const { client: smartWalletClient } = useSmartWallets();
	const fundingWallet = authenticated
		? wallets.find(
				(candidate) =>
					candidate.linked &&
					candidate.walletClientType !== "privy" &&
					candidate.walletClientType !== "privy-v2",
			)
		: undefined;
	const embeddedWallet = authenticated
		? wallets.find(
				(candidate) =>
					candidate.walletClientType === "privy" ||
					candidate.walletClientType === "privy-v2",
			)
		: undefined;
	const smartWalletAddress = authenticated
		? (user?.smartWallet?.address ?? smartWalletClient?.account.address)
		: undefined;
	const [view, setView] = useState<View>("week");
	const [stage, setStage] = useState<Stage>("onboarding");
	const [session, setSession] = useState<WeeklySession>();
	const [feed, setFeed] = useState<FeedResponse>();
	const [preferences, setPreferences] = useState<OnboardingPreferences>();
	const [index, setIndex] = useState(0);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [settlement, setSettlement] = useState<ExecutionRecord>();
	const [receiptCandidates, setReceiptCandidates] = useState<Candidate[]>([]);
	const [error, setError] = useState("");
	const [decisionFeedback, setDecisionFeedback] = useState<DecisionFeedback>();
	const [loadingMore, setLoadingMore] = useState(false);
	const [feedExhausted, setFeedExhausted] = useState(false);
	const [topUpRequest, setTopUpRequest] = useState(0);
	const decisionTimer = useRef<number | undefined>(undefined);
	const wallet = smartWalletAddress?.toLowerCase() ?? "";
	const fundingWalletAddress = fundingWallet?.address.toLowerCase() ?? "";
	const displayWallet = wallet || fundingWalletAddress;
	const smartWalletReady = Boolean(
		wallet && embeddedWallet && smartWalletClient,
	);

	useEffect(() => {
		configureApiAuth({
			getAccessToken,
			getWalletAddress: () => smartWalletAddress,
		});
		return () => configureApiAuth(undefined);
	}, [getAccessToken, smartWalletAddress]);

	useEffect(() => {
		removeLegacyPreferences();
	}, []);

	useEffect(() => {
		if (!wallet) return;
		const executionId = localStorage.getItem(lastExecutionKey(wallet));
		if (!executionId) return;
		setReceiptCandidates(readReceiptCandidates(wallet));
		let cancelled = false;
		api
			.execution(executionId)
			.then(async (record) => {
				if (cancelled) return;
				setSettlement(record);
				if (record.status !== "SUBMITTED") return;
				const reconciled = await api.reconcile(executionId);
				if (!cancelled) setSettlement(reconciled);
			})
			.catch(() => {
				localStorage.removeItem(lastExecutionKey(wallet));
			});
		return () => {
			cancelled = true;
		};
	}, [wallet]);

	const loadSession = useCallback(
		async (preferences: OnboardingPreferences) => {
			setError("");
			setView("week");
			setStage("loading");
			try {
				const opened = await api.openSession(preferences.cadence);
				const generated = await api.generateFeed(opened.id, preferences);
				setPreferences(preferences);
				setSession(opened);
				setFeed({
					...generated,
					candidates: fillFeedPage(generated.candidates),
				});
				setIndex(0);
				setSelectedIds([]);
				setFeedExhausted(false);
				scrollToTop();
				setStage("swipe");
			} catch (caught) {
				setError(
					caught instanceof Error ? caught.message : "Could not open session",
				);
				scrollToTop();
				setStage("swipe");
			}
		},
		[],
	);

	useEffect(() => {
		if (!privyReady || authenticated) return;
		setView("week");
		setStage("onboarding");
		setSession(undefined);
		setFeed(undefined);
		setPreferences(undefined);
		setIndex(0);
		setSelectedIds([]);
		setSettlement(undefined);
		setReceiptCandidates([]);
		setError("");
		setDecisionFeedback(undefined);
		setFeedExhausted(false);
	}, [authenticated, privyReady]);

	useEffect(
		() => () => {
			if (decisionTimer.current) window.clearTimeout(decisionTimer.current);
		},
		[],
	);

	const candidates = feed?.candidates ?? [];
	const current = candidates[index];
	const selected = selectedIds
		.map((assetId) =>
			candidates.find((candidate) => candidate.assetId === assetId),
		)
		.filter((candidate): candidate is Candidate => Boolean(candidate));
	const ticketSizeUsd = preferences?.ticketSizeUsd ?? 10;
	const periodLimitUsd = preferences?.periodLimitUsd ?? 100;
	const cadence = preferences?.cadence ?? "weekly";
	const selectedTotalUsd = selected.length * ticketSizeUsd;
	const canAddCurrent = selectedTotalUsd + ticketSizeUsd <= periodLimitUsd;

	useEffect(() => {
		for (const candidate of candidates.slice(index, index + 2)) {
			void api.assetHistory(candidate.assetId).catch(() => undefined);
		}
	}, [candidates, index]);

	const recoverReviewSession = useCallback(async () => {
		if (!preferences) throw new Error("PREFERENCES_REQUIRED");
		const opened = await api.openSession(preferences.cadence);
		const generated = await api.generateFeed(opened.id, preferences);
		const available = new Set(
			generated.candidates.map((candidate) => candidate.assetId),
		);
		const retained = selectedIds.filter((assetId) => available.has(assetId));
		const assetIds = retained.length
			? retained
			: generated.candidates.slice(0, 1).map((candidate) => candidate.assetId);
		if (!assetIds.length)
			throw new Error("NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES");
		setSession(opened);
		setFeed({
			...generated,
			candidates: fillFeedPage(generated.candidates),
		});
		setSelectedIds(assetIds);
		return { sessionId: opened.id, assetIds };
	}, [preferences, selectedIds]);

	const loadMoreCandidates = useCallback(async () => {
		if (!feed || !preferences || !session || loadingMore || feedExhausted) return;
		setLoadingMore(true);
		try {
			const next = await api.generateFeed(
				session.id,
				preferences,
				nextFeedExcludedAssetIds(feed, selectedIds),
			);
			const nextCandidates = fillFeedPage(next.candidates);
			setFeed((currentFeed) => {
				if (!currentFeed) return next;
				const rankOffset = currentFeed.feed.cards.length;
				return {
					...next,
					candidates: [...currentFeed.candidates, ...nextCandidates],
					feed: {
						...next.feed,
						cards: [
							...currentFeed.feed.cards,
							...next.feed.cards.map((card, cardIndex) => ({
								...card,
								rank: rankOffset + cardIndex + 1,
							})),
						],
					},
				};
			});
		} catch (caught) {
			if (
				caught instanceof ApiError &&
				caught.code !== "NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES"
			) {
				console.error("Could not load the next feed page", caught);
			}
			setFeedExhausted(true);
		} finally {
			setLoadingMore(false);
		}
	}, [
		feed,
		feedExhausted,
		loadingMore,
		preferences,
		selectedIds,
		session,
	]);

	useEffect(() => {
		if (
			!feed ||
			feedExhausted ||
			loadingMore ||
			index < Math.max(0, candidates.length - 3)
		) {
			return;
		}
		void loadMoreCandidates();
	}, [
		candidates.length,
		feed,
		feedExhausted,
		index,
		loadMoreCandidates,
		loadingMore,
	]);

	function decide(add: boolean) {
		if (!current) return;
		if (
			add &&
			!selectedIds.includes(current.assetId) &&
			canAddCurrent
		) {
			setSelectedIds((ids) => [...ids, current.assetId]);
		}
		setIndex((value) => Math.min(value + 1, candidates.length));
	}

	function animateDecision(add: boolean) {
		if (!current || decisionFeedback || (add && !canAddCurrent)) return;
		setDecisionFeedback(add ? "invest" : "skip");
		decisionTimer.current = window.setTimeout(() => {
			decide(add);
			setDecisionFeedback(undefined);
			decisionTimer.current = undefined;
		}, 300);
	}

	function remove(assetId: string) {
		setSelectedIds((ids) => ids.filter((id) => id !== assetId));
		setFeedExhausted(false);
	}

	function navigate(target: View) {
		if (!authenticated || stage === "onboarding") return;
		scrollToTop();
		setView(target);
		if (target === "week" && stage === "loading" && feed) setStage("swipe");
	}

	return (
		<AssetIconProvider>
			<AppShell
				active={view}
				onNavigate={navigate}
				wallet={displayWallet}
				onWallet={login}
				walletReady={privyReady}
				navigationEnabled={authenticated && stage !== "onboarding"}
				fundingWallet={fundingWallet}
				topUpRequest={topUpRequest}
			>
				{stage === "onboarding" ? (
					<Onboarding
						config={config}
						onComplete={loadSession}
						privyReady={privyReady && walletsReady}
					/>
				) : view === "receipts" ? (
					<ReceiptScreen
						record={settlement}
						selected={receiptCandidates.length ? receiptCandidates : selected}
						feed={feed}
						demoMode={config.demoMode}
						onResume={async () => {
							if (!settlement) return;
							const reconciled = await api.reconcile(
								settlement.plan.executionId,
							);
							setSettlement(reconciled);
						}}
						onStartNextBasket={() => {
							if (preferences) {
								void loadSession(preferences);
								setView("week");
							}
						}}
					/>
				) : view === "positions" ? (
					<PositionsScreen
						candidates={Array.from(
							new Map(
								candidates.map((candidate) => [candidate.assetId, candidate]),
							).values(),
						)}
						wallet={wallet}
						demoMode={config.demoMode}
					/>
				) : view === "account" && preferences ? (
					<AccountScreen
						wallet={wallet}
						fundingWallet={fundingWalletAddress}
						smartWalletReady={smartWalletReady}
						preferences={preferences}
						developerMode={config.executionMode === "local-live"}
						onTopUp={() => setTopUpRequest((request) => request + 1)}
						onResetDemoWeek={async () => {
							await loadSession(preferences);
							setView("week");
						}}
						onSave={async (next) => {
							if (user?.id) writeAccountPreferences(user.id, next);
							await loadSession(next);
							setView("week");
						}}
					/>
				) : stage === "review" && session && feed ? (
					<ReviewScreen
						session={session}
						feed={feed}
						selected={selected}
						onRemove={remove}
						onBack={() => {
							scrollToTop();
							setStage("swipe");
						}}
						onSettled={(record) => {
							setSettlement(record);
							setReceiptCandidates(
								executionCandidates(
									record,
									selected,
									wallet ? readReceiptCandidates(wallet) : [],
								),
							);
							setView("receipts");
						}}
						onSessionExpired={recoverReviewSession}
						onExecutionInvalidated={() => {
							setSettlement(undefined);
							if (wallet) {
								localStorage.removeItem(lastExecutionKey(wallet));
								localStorage.removeItem(lastExecutionCandidatesKey(wallet));
							}
						}}
						onStartAnotherBasket={() => {
							if (preferences) void loadSession(preferences);
						}}
						ticketSizeUsd={ticketSizeUsd}
						periodLimitUsd={periodLimitUsd}
						wallet={wallet}
						smartWalletReady={smartWalletReady}
						onExecutionChange={(record) => {
							setSettlement(record);
							const snapshot = executionCandidates(
								record,
								selected,
								wallet ? readReceiptCandidates(wallet) : [],
							);
							setReceiptCandidates(snapshot);
							if (wallet) {
								localStorage.setItem(
									lastExecutionKey(wallet),
									record.plan.executionId,
								);
								if (snapshot.length === record.plan.quotes.length) {
									localStorage.setItem(
										lastExecutionCandidatesKey(wallet),
										JSON.stringify(snapshot),
									);
								}
							}
						}}
					/>
				) : (
					<main className="swipe-page">
						<section className="swipe-workspace">
							<header className="page-heading">
								<h1>Build your next basket</h1>
								<p>
									Swipe right to allocate {ticketSizeUsd} USDG. Nothing moves
									until you review and confirm.
								</p>
								{config.executionMode === "local-live" ? (
									<p>
										<b>Live signing enabled.</b> Real USDG → WETH Uniswap quote;
										ranking evidence is local-only.
									</p>
								) : null}
							</header>
							{error ? (
								<div className="fatal-state">
									<h2>Session unavailable</h2>
									<p>{error}</p>
									<button type="button" onClick={() => location.reload()}>
										Try again
									</button>
								</div>
							) : stage === "loading" || !feed ? (
								<div className="loading-state">
									<span />
									<h2>Building your personal feed</h2>
									<p>
										{config.executionMode === "live"
											? "Eligible assets. Privately ranked. TEE-verified."
											: config.executionMode === "local-live"
												? "Live Uniswap route. Local ranking evidence."
												: "Demo assets. Bounded ranking. No broadcast."}
									</p>
								</div>
							) : current ? (
								<>
									<div className="card-stage">
										<button
											type="button"
											className="gesture gesture-skip"
							onClick={() => animateDecision(false)}
							aria-label="Skip asset"
								disabled={Boolean(decisionFeedback)}
										>
											<ArrowLeft />
											<span>
												Skip<small>Swipe left</small>
											</span>
										</button>
										<SwipeCard
											candidate={current}
											index={index}
											total={candidates.length}
											executionMode={config.executionMode}
											ticketSizeUsd={ticketSizeUsd}
											feedback={decisionFeedback}
											onSwipe={animateDecision}
										/>
										<button
											type="button"
											className="gesture gesture-add"
											onClick={() => animateDecision(true)}
											aria-label={`Add ${ticketSizeUsd} USDG`}
								disabled={Boolean(decisionFeedback) || !canAddCurrent}
										>
											<LucideArrowRight />
											<span>
												Add<small>Swipe right</small>
											</span>
										</button>
									</div>
									<div
										className={`card-actions${selected.length ? " has-selection" : ""}`}
									>
										<button
											type="button"
											className="button button-skip"
											onClick={() => animateDecision(false)}
											disabled={Boolean(decisionFeedback)}
										>
											Skip
										</button>
										<button
											type="button"
							className="button button-primary"
							onClick={() => animateDecision(true)}
							disabled={Boolean(decisionFeedback) || !canAddCurrent}
										>
											Add {ticketSizeUsd} USDG
										</button>
										<button
											type="button"
											className="button button-outline"
											onClick={() => {
												scrollToTop();
												setStage("review");
											}}
											disabled={!selected.length}
										>
											Review basket ({selected.length}) <ArrowRight />
										</button>
									</div>
								</>
							) : loadingMore ? (
								<div className="loading-state loading-more">
									<span />
									<h2>Finding more assets…</h2>
									<p>Your selected basket stays ready to review.</p>
								</div>
							) : (
								<div className="feed-complete">
									{selected.length ? (
										<Confetti
											className="completion-confetti"
											options={{
												gravity: 0.9,
												particleCount: 120,
												spread: 90,
												startVelocity: 36,
											}}
										/>
									) : null}
									<h2>That’s the feed.</h2>
									<p>
										{selected.length
											? `${formatTicketSizeUsd(selected.length * ticketSizeUsd)} USDG is ready for review.`
											: "You skipped every card. Your USDG stays in your wallet."}
									</p>
									<button
										type="button"
										className="button button-primary"
										disabled={!selected.length}
										onClick={() => {
											scrollToTop();
											setStage("review");
										}}
									>
										Review basket ({selected.length}) <ArrowRight />
									</button>
								</div>
							)}
						</section>
						<BudgetRail
							selected={selected}
							onRemove={remove}
							executionMode={config.executionMode}
							ticketSizeUsd={ticketSizeUsd}
							periodLimitUsd={periodLimitUsd}
							cadence={cadence}
						/>
						<section className="evidence-detail">
							<div className="feed-method-copy">
								<h2>How your feed earns your trust</h2>
								<p>
									{config.executionMode === "demo"
										? "Your rules shape the feed. Demo mode applies them to eligible fixture routes."
										: "Your rules shape the feed. Live routes prove what is buyable. You sign every swap."}
								</p>
								<ol className="feed-pipeline">
									<li>
										<strong>1 · Your rules</strong>
										<span>Cadence, cap, ticket, risk, and asset mix.</span>
									</li>
									<li>
										<strong>2 · Live routes</strong>
										<span>
											{config.executionMode === "demo"
												? "Fixture routes pass the same eligibility gates."
												: "Fresh Robinhood Chain checks + exact Uniswap quote."}
										</span>
									</li>
									<li>
										<strong>3 · Private 0G rank</strong>
										<span>
											{feed?.proof.teeVerified
												? "0G ranks only verified candidates inside a TEE."
												: "Local ranking uses the same bounded input and output schema."}
										</span>
									</li>
									<li>
										<strong>4 · You approve</strong>
										<span>Policy rechecks the route. Your wallet signs last.</span>
									</li>
								</ol>
							</div>
							{feed ? (
								<details className="feed-proof">
									<summary>
										View proof <ArrowRight />
									</summary>
									<dl>
										<div>
											<dt>Privacy</dt>
											<dd>
												{feed.proof.teeVerified
													? "TEE verified"
													: "Local run · not TEE verified"}
											</dd>
										</div>
										<div>
											<dt>Model</dt>
											<dd>{feed.proof.model}</dd>
										</div>
										<div>
											<dt>Input</dt>
											<dd>{shortProof(feed.proof.inputCommitment)}</dd>
										</div>
										<div>
											<dt>Output</dt>
											<dd>{shortProof(feed.proof.outputCommitment)}</dd>
										</div>
									</dl>
								</details>
							) : (
								<span className="feed-proof-loading">Preparing proof…</span>
							)}
						</section>
					</main>
				)}
			</AppShell>
		</AssetIconProvider>
	);
}

function scrollToTop() {
	window.scrollTo({ top: 0, behavior: "auto" });
}

function shortProof(value: string) {
	return `${value.slice(0, 11)}…${value.slice(-6)}`;
}

function lastExecutionKey(wallet: string) {
	return `${LAST_EXECUTION_KEY}:${wallet.toLowerCase()}`;
}

function lastExecutionCandidatesKey(wallet: string) {
	return `${LAST_EXECUTION_CANDIDATES_KEY}:${wallet.toLowerCase()}`;
}

function readReceiptCandidates(wallet: string) {
	try {
		const value = JSON.parse(
			localStorage.getItem(lastExecutionCandidatesKey(wallet)) ?? "[]",
		);
		return Array.isArray(value) ? (value as Candidate[]) : [];
	} catch {
		return [];
	}
}

function executionCandidates(
	record: ExecutionRecord,
	current: Candidate[],
	fallback: Candidate[],
) {
	const assetIds = new Set(record.plan.quotes.map((quote) => quote.assetId));
	const selected = current.filter((candidate) => assetIds.has(candidate.assetId));
	if (selected.length === record.plan.quotes.length) return selected;
	return fallback.filter((candidate) => assetIds.has(candidate.assetId));
}
