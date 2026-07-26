import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight as LucideArrowRight } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { api, configureApiAuth, type ExecutionRecord, type FeedResponse, type PublicConfig, type WeeklySession } from "./api";
import { AppShell } from "./components/AppShell";
import { ArrowRight, Shield } from "./components/Icons";
import { SwipeCard } from "./components/SwipeCard";
import { BudgetRail } from "./components/BudgetRail";
import { ReviewScreen } from "./components/ReviewScreen";
import { ReceiptScreen } from "./components/ReceiptScreen";
import { Onboarding } from "./components/Onboarding";
import { PositionsScreen } from "./components/PositionsScreen";
import { AccountScreen } from "./components/AccountScreen";
import { AssetIconProvider } from "./components/AssetMark";
import { Confetti } from "./components/magicui/confetti";
import type { Candidate, OnboardingPreferences } from "../domain/schemas";

type View = "week" | "positions" | "receipts" | "account";
type Stage = "loading" | "onboarding" | "swipe" | "review";
type DecisionFeedback = "invest" | "skip";
const DEV_CARD_LIMIT_KEY = "investmade:dev-card-limit";
const DEV_CARD_LIMIT_MAX = 10;
const LAST_EXECUTION_KEY = "investmade:last-execution";
const LAST_EXECUTION_CANDIDATES_KEY = "investmade:last-execution-candidates";

export function App({ config }: { config: PublicConfig }) {
  const { authenticated, getAccessToken, login, ready: privyReady, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const fundingWallet = authenticated
    ? wallets.find(
        (candidate) =>
          candidate.linked &&
          candidate.walletClientType !== "privy" &&
          candidate.walletClientType !== "privy-v2"
      )
    : undefined;
  const embeddedWallet = authenticated
    ? wallets.find(
        (candidate) =>
          candidate.walletClientType === "privy" || candidate.walletClientType === "privy-v2"
      )
    : undefined;
  const smartWalletAddress =
    user?.smartWallet?.address ?? smartWalletClient?.account.address;
  const [view, setView] = useState<View>("week");
  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<WeeklySession>();
  const [feed, setFeed] = useState<FeedResponse>();
  const [preferences, setPreferences] = useState<OnboardingPreferences>();
  const [index, setIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settlement, setSettlement] = useState<ExecutionRecord>();
  const [receiptCandidates, setReceiptCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [decisionFeedback, setDecisionFeedback] = useState<DecisionFeedback>();
  const [devCardLimit, setDevCardLimit] = useState(() => readDevCardLimit(DEV_CARD_LIMIT_MAX));
  const decisionTimer = useRef<number | undefined>(undefined);
  const wallet = smartWalletAddress?.toLowerCase() ?? "";
  const fundingWalletAddress = fundingWallet?.address.toLowerCase() ?? "";
  const displayWallet = wallet || fundingWalletAddress;
  const smartWalletReady = Boolean(wallet && embeddedWallet && smartWalletClient);

  useEffect(() => {
    configureApiAuth({
      getAccessToken,
      getWalletAddress: () => smartWalletAddress
    });
    return () => configureApiAuth(undefined);
  }, [getAccessToken, smartWalletAddress]);

  useEffect(() => {
    if (!wallet) return;
    const executionId = localStorage.getItem(lastExecutionKey(wallet));
    if (!executionId) return;
    setReceiptCandidates(readReceiptCandidates(wallet));
    let cancelled = false;
    api.execution(executionId)
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

  const loadSession = useCallback(async (preferences: OnboardingPreferences) => {
    setError("");
    try {
      const opened = await api.openSession(preferences.cadence);
      const generated = await api.generateFeed(opened.id, preferences);
      setPreferences(preferences);
      setSession(opened);
      setFeed(generated);
      setIndex(0);
      setSelectedIds([]);
      scrollToTop();
      setStage("swipe");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open session");
      scrollToTop();
      setStage("swipe");
    }
  }, []);

  useEffect(() => {
    scrollToTop();
    setStage("onboarding");
  }, []);

  useEffect(() => {
    if (privyReady && !authenticated) {
      setStage("onboarding");
    }
  }, [authenticated, privyReady]);

  useEffect(
    () => () => {
      if (decisionTimer.current) window.clearTimeout(decisionTimer.current);
    },
    []
  );

  const feedCandidates = feed?.candidates ?? [];
  const candidates = config.executionMode === "local-live"
    ? feedCandidates.slice(0, devCardLimit)
    : feedCandidates;
  const current = candidates[index];
  const selected = candidates.filter((candidate) => selectedIds.includes(candidate.assetId));
  const ticketSizeUsd = preferences?.ticketSizeUsd ?? 10;
  const cadence = preferences?.cadence ?? "weekly";
  // The developer menu changes how many candidates can be reviewed. The
  // signed basket is still bound by the production three-card policy.
  const maxCards = Math.min(config.maxCards, Math.floor(100 / ticketSizeUsd));

  function changeDevCardLimit(next: number) {
    const limit = Math.max(1, Math.min(DEV_CARD_LIMIT_MAX, Math.floor(next)));
    setDevCardLimit(limit);
    localStorage.setItem(DEV_CARD_LIMIT_KEY, String(limit));
  }

  const recoverReviewSession = useCallback(async () => {
    if (!preferences) throw new Error("PREFERENCES_REQUIRED");
    const opened = await api.openSession(preferences.cadence);
    const generated = await api.generateFeed(opened.id, preferences);
    const available = new Set(generated.candidates.map((candidate) => candidate.assetId));
    const retained = selectedIds.filter((assetId) => available.has(assetId));
    const assetIds = retained.length ? retained : generated.candidates.slice(0, 1).map((candidate) => candidate.assetId);
    if (!assetIds.length) throw new Error("NO_ELIGIBLE_CANDIDATES_FOR_PREFERENCES");
    setSession(opened);
    setFeed(generated);
    setSelectedIds(assetIds);
    return { sessionId: opened.id, assetIds };
  }, [preferences, selectedIds]);

  function decide(add: boolean) {
    if (!current) return;
    if (add && !selectedIds.includes(current.assetId) && selectedIds.length < maxCards) {
      setSelectedIds((ids) => [...ids, current.assetId]);
    }
    setIndex((value) => Math.min(value + 1, candidates.length));
  }

  function animateDecision(add: boolean) {
    if (!current || decisionFeedback) return;
    setDecisionFeedback(add ? "invest" : "skip");
    decisionTimer.current = window.setTimeout(() => {
      decide(add);
      setDecisionFeedback(undefined);
      decisionTimer.current = undefined;
    }, 300);
  }

  function remove(assetId: string) {
    setSelectedIds((ids) => ids.filter((id) => id !== assetId));
  }

  function navigate(target: View) {
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
            const reconciled = await api.reconcile(settlement.plan.executionId);
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
          candidates={candidates}
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
          devCardLimit={devCardLimit}
          maxDevCards={DEV_CARD_LIMIT_MAX}
          onDevCardLimitChange={changeDevCardLimit}
          onResetDemoWeek={async () => {
            await loadSession(preferences);
            setView("week");
          }}
          onSave={async (next) => {
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
            setReceiptCandidates(selected);
            setView("receipts");
          }}
          onSessionExpired={recoverReviewSession}
          ticketSizeUsd={ticketSizeUsd}
          wallet={wallet}
          smartWalletReady={smartWalletReady}
          onExecutionChange={(record) => {
            setSettlement(record);
            setReceiptCandidates(selected);
            if (wallet) {
              localStorage.setItem(lastExecutionKey(wallet), record.plan.executionId);
              localStorage.setItem(lastExecutionCandidatesKey(wallet), JSON.stringify(selected));
            }
          }}
        />
      ) : (
        <main className="swipe-page">
          <section className="swipe-workspace">
            <header className="page-heading">
              <h1>Build this {periodLabel(cadence)} basket</h1>
              <p>Swipe right to allocate {ticketSizeUsd} USDG. Nothing moves until you review and confirm.</p>
              {config.executionMode === "local-live" ? <p><b>Live signing enabled.</b> Real USDG → WETH Uniswap quote; ranking evidence is local-only.</p> : null}
            </header>
            {error ? (
              <div className="fatal-state"><h2>Session unavailable</h2><p>{error}</p><button type="button" onClick={() => location.reload()}>Try again</button></div>
            ) : stage === "loading" || !feed ? (
              <div className="loading-state"><span /><h2>Building your private feed</h2><p>Checking executable routes and deterministic policy.</p></div>
            ) : current ? (
              <>
                <div className="card-stage">
                  <button type="button" className="gesture gesture-skip" onClick={() => animateDecision(false)} aria-label="Skip asset" disabled={Boolean(decisionFeedback)}>
                    <ArrowLeft /><span>Skip<small>Swipe left</small></span>
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
                  <button type="button" className="gesture gesture-add" onClick={() => animateDecision(true)} aria-label={`Add ${ticketSizeUsd} USDG`} disabled={Boolean(decisionFeedback)}>
                    <LucideArrowRight /><span>Add<small>Swipe right</small></span>
                  </button>
                </div>
                <div className="card-actions">
                  <button type="button" className="button button-skip" onClick={() => animateDecision(false)} disabled={Boolean(decisionFeedback)}>Skip</button>
                  <button type="button" className="button button-primary" onClick={() => animateDecision(true)} disabled={Boolean(decisionFeedback)}>Add {ticketSizeUsd} USDG</button>
                  <button type="button" className="button button-outline" onClick={() => {
                    scrollToTop();
                    setStage("review");
                  }} disabled={!selected.length}>Review and sign <ArrowRight /></button>
                </div>
              </>
            ) : (
              <div className="feed-complete">
                {selected.length ? <Confetti className="completion-confetti" options={{ gravity: 0.9, particleCount: 120, spread: 90, startVelocity: 36 }} /> : null}
                <h2>Your feed is complete.</h2>
                <p>{selected.length ? `${selected.length * ticketSizeUsd} USDG is ready for review.` : "You skipped every card. Your USDG stays in your wallet."}</p>
                <button type="button" className="button button-primary" disabled={!selected.length} onClick={() => {
                  scrollToTop();
                  setStage("review");
                }}>Review and sign <ArrowRight /></button>
              </div>
            )}
          </section>
                  <BudgetRail
                    selected={selected}
                    onRemove={remove}
                    onReview={() => {
              scrollToTop();
              setStage("review");
            }}
                    executionMode={config.executionMode}
                    ticketSizeUsd={ticketSizeUsd}
                    cadence={cadence}
                    maxCards={maxCards}
                  />
          <section className="trust-strip">
            <Shield /><b>Non-custodial by design</b><span>You control your keys</span><span>We never hold funds</span><span>Every trade requires your signature</span>
          </section>
          <section className="evidence-detail">
            <div><h2>Why am I seeing this?</h2><p>Private AI ranking over bounded, executable candidates.</p></div>
            <button type="button">View full evidence <ArrowRight /></button>
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

function periodLabel(cadence: OnboardingPreferences["cadence"]) {
  if (cadence === "daily") return "day’s";
  if (cadence === "monthly") return "month’s";
  return "week’s";
}

function readDevCardLimit(maxCards: number) {
  const saved = Number(localStorage.getItem(DEV_CARD_LIMIT_KEY));
  return Number.isInteger(saved) && saved >= 1 && saved <= maxCards ? saved : maxCards;
}

function lastExecutionKey(wallet: string) {
  return `${LAST_EXECUTION_KEY}:${wallet.toLowerCase()}`;
}

function lastExecutionCandidatesKey(wallet: string) {
  return `${LAST_EXECUTION_CANDIDATES_KEY}:${wallet.toLowerCase()}`;
}

function readReceiptCandidates(wallet: string) {
  try {
    const value = JSON.parse(localStorage.getItem(lastExecutionCandidatesKey(wallet)) ?? "[]");
    return Array.isArray(value) ? value as Candidate[] : [];
  } catch {
    return [];
  }
}
