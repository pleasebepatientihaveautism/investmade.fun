import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight as LucideArrowRight } from "lucide-react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
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
import type { OnboardingPreferences } from "../domain/schemas";

type View = "week" | "positions" | "receipts" | "account";
type Stage = "loading" | "onboarding" | "swipe" | "review";
type DecisionFeedback = "invest" | "skip";
const DEV_CARD_LIMIT_KEY = "investmade:dev-card-limit";

export function App({ config }: { config: PublicConfig }) {
  const { authenticated, getAccessToken, login, logout, ready: privyReady } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const activeWallet = authenticated
    ? wallets.find((candidate) => candidate.linked)
    : undefined;
  const [view, setView] = useState<View>("week");
  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<WeeklySession>();
  const [feed, setFeed] = useState<FeedResponse>();
  const [preferences, setPreferences] = useState<OnboardingPreferences>();
  const [index, setIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settlement, setSettlement] = useState<ExecutionRecord>();
  const [error, setError] = useState("");
  const [decisionFeedback, setDecisionFeedback] = useState<DecisionFeedback>();
  const [devCardLimit, setDevCardLimit] = useState(() => readDevCardLimit(config.maxCards));
  const decisionTimer = useRef<number | undefined>(undefined);
  const wallet = activeWallet?.address.toLowerCase() ?? "";

  useEffect(() => {
    configureApiAuth({
      getAccessToken,
      getWalletAddress: () => activeWallet?.address
    });
    return () => configureApiAuth(undefined);
  }, [activeWallet?.address, getAccessToken]);

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
  const maxCards = Math.min(
    config.executionMode === "local-live" ? devCardLimit : config.maxCards,
    Math.floor(100 / ticketSizeUsd)
  );

  function changeDevCardLimit(next: number) {
    const limit = Math.max(1, Math.min(config.maxCards, Math.floor(next)));
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
      wallet={wallet}
      onWallet={authenticated ? logout : login}
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
          selected={selected}
          feed={feed}
          demoMode={config.demoMode}
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
          preferences={preferences}
          developerMode={config.executionMode === "local-live"}
          devCardLimit={devCardLimit}
          maxDevCards={config.maxCards}
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
            setView("receipts");
          }}
          onSessionExpired={recoverReviewSession}
          ticketSizeUsd={ticketSizeUsd}
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
