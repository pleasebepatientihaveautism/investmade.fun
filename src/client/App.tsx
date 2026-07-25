import { useCallback, useEffect, useState } from "react";
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

type View = "week" | "positions" | "receipts";
type Stage = "loading" | "onboarding" | "swipe" | "review";

export function App({ config }: { config: PublicConfig }) {
  const { authenticated, getAccessToken, logout, ready: privyReady } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const activeWallet = wallets.find((candidate) => candidate.linked) ?? wallets[0];
  const [view, setView] = useState<View>("week");
  const [stage, setStage] = useState<Stage>("loading");
  const [session, setSession] = useState<WeeklySession>();
  const [feed, setFeed] = useState<FeedResponse>();
  const [index, setIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settlement, setSettlement] = useState<ExecutionRecord>();
  const [error, setError] = useState("");
  const wallet = activeWallet?.address.toLowerCase() ?? "";

  useEffect(() => {
    configureApiAuth({
      getAccessToken,
      getWalletAddress: () => activeWallet?.address
    });
    return () => configureApiAuth(undefined);
  }, [activeWallet?.address, getAccessToken]);

  const loadSession = useCallback(async () => {
    const opened = await api.openSession();
    const generated = await api.generateFeed(opened.id);
    setSession(opened);
    setFeed(generated);
    scrollToTop();
    setStage("swipe");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!cancelled) {
          if (config.demoMode) await loadSession();
          else {
            scrollToTop();
            setStage("onboarding");
          }
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not open session");
      }
    })();
    return () => { cancelled = true; };
  }, [config.demoMode, loadSession]);

  const candidates = feed?.candidates ?? [];
  const current = candidates[index];
  const selected = candidates.filter((candidate) => selectedIds.includes(candidate.assetId));

  function decide(add: boolean) {
    if (!current) return;
    if (add && !selectedIds.includes(current.assetId) && selectedIds.length < 10) {
      setSelectedIds((ids) => [...ids, current.assetId]);
    }
    setIndex((value) => Math.min(value + 1, candidates.length));
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
    <AppShell
      active={view}
      onNavigate={navigate}
      wallet={wallet}
      onWallet={authenticated ? logout : undefined}
    >
      {stage === "onboarding" ? (
        <Onboarding
          config={config}
          onComplete={loadSession}
          privyReady={privyReady && walletsReady}
        />
      ) : view === "receipts" ? (
        <ReceiptScreen record={settlement} selected={selected} feed={feed} />
      ) : view === "positions" ? (
        <PositionsScreen
          candidates={candidates}
          wallet={wallet}
          demoMode={config.demoMode}
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
        />
      ) : (
        <main className="swipe-page">
          <section className="swipe-workspace">
            <header className="page-heading">
              <h1>Build this week’s basket</h1>
              <p>Swipe right to allocate 10 USDG. Nothing moves until you review and confirm.</p>
            </header>
            {error ? (
              <div className="fatal-state"><h2>Session unavailable</h2><p>{error}</p><button type="button" onClick={() => location.reload()}>Try again</button></div>
            ) : stage === "loading" || !feed ? (
              <div className="loading-state"><span /><h2>Building your private feed</h2><p>Checking executable routes and deterministic policy.</p></div>
            ) : current ? (
              <>
                <div className="card-stage">
                  <button type="button" className="gesture gesture-skip" onClick={() => decide(false)} aria-label="Skip asset">
                    <ArrowLeft /><span>Skip<small>Swipe left</small></span>
                  </button>
                  <SwipeCard
                    candidate={current}
                    index={index}
                    total={candidates.length}
                    demoMode={!feed.proof.teeVerified}
                  />
                  <button type="button" className="gesture gesture-add" onClick={() => decide(true)} aria-label="Add 10 USDG">
                    <LucideArrowRight /><span>Add<small>Swipe right</small></span>
                  </button>
                </div>
                <div className="card-actions">
                  <button type="button" className="button button-skip" onClick={() => decide(false)}>Skip</button>
                  <button type="button" className="button button-primary" onClick={() => decide(true)}>Add 10 USDG</button>
                  <button type="button" className="button button-outline" onClick={() => {
                    scrollToTop();
                    setStage("review");
                  }} disabled={!selected.length}>Review basket <ArrowRight /></button>
                </div>
              </>
            ) : (
              <div className="feed-complete">
                <h2>Your feed is complete.</h2>
                <p>{selected.length ? `${selected.length * 10} USDG is ready for review.` : "You skipped every card. Your USDG stays in your wallet."}</p>
                <button type="button" className="button button-primary" disabled={!selected.length} onClick={() => {
                  scrollToTop();
                  setStage("review");
                }}>Review basket <ArrowRight /></button>
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
            demoMode={!feed?.proof.teeVerified}
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
  );
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "auto" });
}
