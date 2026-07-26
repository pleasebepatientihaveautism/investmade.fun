import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { formatUnits, type Address, type Hex } from "viem";
import type { Candidate } from "../../domain/schemas";
import { formatTicketSizeUsd } from "../../domain/schemas";
import type { ExecutionRecord, FeedResponse, WalletCall, WeeklySession } from "../api";
import { api, ApiError } from "../api";
import {
  executionMatchesReviewBasket,
  executionPlanHashMatchesReviewBasket,
  reviewBasketKey,
} from "../review-safety";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check, Close, Shield } from "./Icons";

const MIN_SIGNING_WINDOW_MS = 30_000;

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
  ticketSizeUsd,
  wallet,
  smartWalletReady
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
  ticketSizeUsd: number;
  wallet: string;
  smartWalletReady: boolean;
}) {
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  const [record, setRecord] = useState<ExecutionRecord>();
  const [preparedBasketKey, setPreparedBasketKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "refreshing" | "simulating" | "signing" | "settling">("idle");
  const [error, setError] = useState("");
  const [executionConflict, setExecutionConflict] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoPrepareStarted = useRef(false);
  const preparationAttempt = useRef(0);
  const total = Math.round(selected.length * ticketSizeUsd * 100) / 100;
  const basket = useMemo(
    () => ({
      sessionId: session.id,
      epochId: session.epochId,
      selected,
      ticketSizeUsd,
      wallet,
    }),
    [selected, session.epochId, session.id, ticketSizeUsd, wallet],
  );
  const basketKey = reviewBasketKey(basket);
  const currentBasketKey = useRef(basketKey);
  currentBasketKey.current = basketKey;
  const activeRecord =
    preparedBasketKey === basketKey &&
    executionMatchesReviewBasket(record, basket)
      ? record
      : undefined;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const quoteExpiry = useMemo(() => {
    const quotes = activeRecord?.plan.quotes ?? selected.map((item) => item.quote);
    if (!quotes.length) return 0;
    return Math.max(
      0,
      Math.min(...quotes.map((quote) => new Date(quote.expiresAt).getTime())) - now,
    );
  }, [activeRecord, now, selected]);
  const quotesFresh = quoteExpiry > 0;
  const quotesSafeToSign = quoteExpiry > MIN_SIGNING_WINDOW_MS;

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
    setExecutionConflict(false);
    try {
      const prepared = await api.prepareExecution(
        session.id,
        selected.map((item) => item.assetId),
        ticketSizeUsd
      );
      if (
        attempt !== preparationAttempt.current ||
        requestedBasketKey !== currentBasketKey.current
      ) return;
      setRecord(prepared);
      setPreparedBasketKey(requestedBasketKey);
      onExecutionChange(prepared);
    } catch (caught) {
      if (attempt !== preparationAttempt.current) return;
      const code = caught instanceof ApiError ? caught.code : "";
      const message = caught instanceof Error ? caught.message : "Could not prepare execution";
      if (code === "SESSION_NOT_FOUND") {
        try {
          const recovered = await onSessionExpired();
          const prepared = await api.prepareExecution(recovered.sessionId, recovered.assetIds, ticketSizeUsd);
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
        } catch (recoveryError) {
          setError(recoveryError instanceof Error ? recoveryError.message : "Could not renew local session");
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
    selected,
    session.id,
    ticketSizeUsd,
  ]);

  useEffect(() => {
    if (
      !record ||
      (preparedBasketKey === basketKey &&
        executionMatchesReviewBasket(record, basket))
    ) return;
    preparationAttempt.current += 1;
    setRecord(undefined);
    setPreparedBasketKey("");
    setError("");
    setExecutionConflict(false);
    onExecutionInvalidated();
  }, [
    basketKey,
    basket,
    onExecutionInvalidated,
    preparedBasketKey,
    record,
  ]);

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
    setExecutionConflict(false);
    onExecutionInvalidated();
    onRemove(assetId);
  }

  async function confirmLive() {
    const signingBasketKey = basketKey;
    if (
      activeRecord?.status !== "PREPARED" ||
      !activeRecord.walletCalls?.length ||
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
      setError("The basket changed after preparation. Refresh quotes before signing.");
      return;
    }
    if (!smartWalletReady) {
      setError(
        "Activate your Investmade smart wallet before signing. External wallets can fund it, but cannot execute an atomic basket."
      );
      return;
    }
    setLoading(true);
    setError("");
    try {
      const client =
        smartWalletClient ?? (await getClientForChain({ id: 4663 }));
      if (!client || client.account.address.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("SMART_WALLET_ADDRESS_MISMATCH");
      }
      const calls = activeRecord.walletCalls.map(smartWalletCall);
      setPhase("simulating");
      await client.prepareUserOperation({ calls });
      setPhase("signing");
      const transactionHash = await client.sendTransaction(
        { calls },
        {
          uiOptions: {
            description: `Invest ${formatTicketSizeUsd(total)} USDG into ${selected.length} assets. All purchases succeed or none.`,
            buttonText: "Sign and invest",
            showWalletUIs: false
          }
        }
      );
      const submitted = await api.markSubmitted(
        activeRecord.plan.executionId,
        [transactionHash],
        true
      );
      setRecord(submitted);
      onExecutionChange(submitted);
      setPhase("settling");
      const reconciled = await reconcileUntilTerminal(activeRecord.plan.executionId);
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
      setError(caught instanceof Error ? caught.message : "Could not verify settlement yet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="review-page">
      <section className="review-ledger">
        <header>
          <h1>Review your basket</h1>
          <p>Fresh quotes are required before your wallet can confirm.</p>
        </header>
        <div className="ledger-table">
          <div className="ledger-row ledger-labels">
            <span>Asset</span><span>Input (you pay)</span><span>Estimated output</span><span>Minimum output</span><span>Impact</span>
          </div>
          {selected.map((candidate) => (
            <div className="ledger-row" key={candidate.assetId}>
              <span className="ledger-asset">
                <button type="button" onClick={() => removeAsset(candidate.assetId)} aria-label={`Remove ${candidate.symbol}`}><Close /></button>
                <AssetMark symbol={candidate.symbol} size="sm" />
                <b>{candidate.symbol}<small>{candidate.name}</small></b>
              </span>
              <span><strong>{formatTicketSizeUsd(ticketSizeUsd)}</strong> USDG</span>
              <span><strong>{formatOutput(candidate.quote.estimatedAmountOut, candidate.decimals)}</strong> {candidate.symbol}</span>
              <span><strong>{formatOutput(candidate.quote.minimumAmountOut, candidate.decimals)}</strong> {candidate.symbol}</span>
              <span className="blue-text">{(candidate.quote.priceImpactBps / 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
        <div className="ledger-totals">
          <div><span>Total input</span><strong>{formatTicketSizeUsd(total)} USDG</strong><small>to invest</small></div>
          <div><span>Remainder</span><strong>{formatTicketSizeUsd(Math.round((100 - total) * 100) / 100)} USDG</strong><small>stays in your wallet</small></div>
        </div>
      </section>

      <aside className="policy-rail">
        <h2>Policy checks</h2>
        {[
          { label: "Budget within limit", value: `${formatTicketSizeUsd(total)} / 100 USDG`, ok: selected.length > 0 },
          {
            label: "Assets eligible",
            value: selected.length ? `${selected.length} / ${selected.length}` : "No assets selected",
            ok: selected.length > 0,
          },
          { label: "Robinhood Chain · 4663", value: "Connected", ok: true },
          {
            label: "Atomic Investmade Wallet",
            value: smartWalletReady ? "Ready" : "Activation required",
            ok: smartWalletReady
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
            ok: quotesSafeToSign
          }
        ].map(({ label, value, ok }) => (
          <div className="policy-row" key={label}><span className={ok ? "check-circle" : "check-circle warning-circle"}>{ok ? <Check /> : "!"}</span><b>{label}</b><em>{value}</em></div>
        ))}
        <div className="proof-block">
          <h3>Private ranking {feed.proof.teeVerified ? "verified" : "demo-only"}</h3>
          <p><span>0G model</span><b>{feed.proof.model}</b></p>
          <p><span>Input commitment</span><b>{shortHash(feed.proof.inputCommitment)}</b></p>
          <p><span>TEE verified</span><b>{feed.proof.teeVerified ? "Verified" : "Not available in demo"}</b></p>
        </div>
        <div className="wallet-boundary"><Shield /><p><b>One click · all-or-nothing.</b><br />The complete call set is simulated, signed once, and submitted as one atomic basket.</p></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {executionConflict ? (
          <button type="button" className="button button-outline" onClick={onStartAnotherBasket}>
            Start another basket
          </button>
        ) : null}
        <div className="review-actions">
          <button type="button" className="button button-outline" onClick={onBack}>Back to cards</button>
          {!activeRecord ? (
            <button type="button" className="button button-primary" onClick={prepare} disabled={loading || !selected.length}>
              {loading ? "Refreshing…" : "Refresh quotes & continue"} <ArrowRight />
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
                  : activeRecord.walletCalls?.length
                    ? confirmLive
                    : settleDemo
              }
              disabled={loading || !selected.length || activeRecord.status === "SETTLED"}
            >
              {activeRecord.status === "SETTLED"
                ? "Settled"
                : loading
                  ? phaseLabel(phase)
                  : activeRecord.status === "SUBMITTED"
                    ? "Check settlement receipt"
                    : !quotesSafeToSign
                      ? "Refresh quotes & continue"
                    : activeRecord.walletCalls?.length
                    ? "Review and sign"
                    : "Simulate wallet confirmation"} <ArrowRight />
            </button>
          )}
        </div>
      </aside>

      <section className="execution-strip">
        <h2>Execution progress</h2>
        {["Awaiting signature", "Submitted", "Settled"].map((step, index) => {
          const active = activeRecord ? (activeRecord.status === "SETTLED" ? index <= 2 : index === 0) : index === 0;
          return <div className={active ? "execution-step active" : "execution-step"} key={step}><span>{active ? <Check /> : index + 1}</span><b>{step}</b></div>;
        })}
      </section>
    </main>
  );
}

function smartWalletCall(call: WalletCall): { to: Address; data: Hex; value: bigint } {
  const { transaction } = call;
  return {
    to: transaction.to as Address,
    data: transaction.data as Hex,
    value: BigInt(transaction.value)
  };
}

function executionErrorMessage(caught: unknown) {
  if (
    caught instanceof Error &&
    /smart wallet|bundler|paymaster|user operation|insufficient funds/i.test(caught.message)
  ) {
    return "The atomic basket could not pass smart-wallet preflight. Check Investmade Wallet funding and the Robinhood Chain bundler configuration, then retry.";
  }
  return caught instanceof Error ? caught.message : "Wallet execution failed.";
}

function formatOutput(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : "—";
}

function shortHash(hash: string) {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

async function reconcileUntilTerminal(executionId: string): Promise<ExecutionRecord> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await api.reconcile(executionId);
    if (["SETTLED", "PARTIAL", "FAILED"].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Transactions are submitted but not terminal yet. Check Receipts shortly.");
}

function phaseLabel(phase: "idle" | "refreshing" | "simulating" | "signing" | "settling") {
  if (phase === "refreshing") return "Refreshing quotes…";
  if (phase === "simulating") return "Simulating full basket…";
  if (phase === "signing") return "Waiting for signature…";
  if (phase === "settling") return "Verifying settlement…";
  return "Working…";
}
