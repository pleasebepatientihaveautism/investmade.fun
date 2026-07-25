import { useEffect, useMemo, useState } from "react";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { formatUnits, type Address, type Hex } from "viem";
import type { Candidate } from "../../domain/schemas";
import { formatTicketSizeUsd } from "../../domain/schemas";
import type { ExecutionRecord, FeedResponse, WalletCall, WeeklySession } from "../api";
import { api } from "../api";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check, Close, Shield } from "./Icons";

export function ReviewScreen({
  session,
  feed,
  selected,
  onRemove,
  onBack,
  onSettled,
  onExecutionChange,
  onSessionExpired,
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
  onSessionExpired: () => Promise<{ sessionId: string; assetIds: string[] }>;
  ticketSizeUsd: number;
  wallet: string;
  smartWalletReady: boolean;
}) {
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  const [record, setRecord] = useState<ExecutionRecord>();
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "refreshing" | "simulating" | "signing" | "settling">("idle");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const total = Math.round(selected.length * ticketSizeUsd * 100) / 100;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const quoteExpiry = useMemo(
    () =>
      Math.max(
        0,
        Math.min(
          ...(record?.plan.quotes ?? selected.map((item) => item.quote)).map((quote) =>
            new Date(quote.expiresAt).getTime()
          )
        ) - now
      ),
    [now, record, selected]
  );
  const quotesFresh = quoteExpiry > 0;

  async function prepare() {
    setLoading(true);
    setPhase("refreshing");
    setError("");
    try {
      const prepared = await api.prepareExecution(
        session.id,
        selected.map((item) => item.assetId),
        ticketSizeUsd
      );
      setRecord(prepared);
      onExecutionChange(prepared);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not prepare execution";
      if (message === "SESSION_NOT_FOUND") {
        try {
          const recovered = await onSessionExpired();
          const prepared = await api.prepareExecution(recovered.sessionId, recovered.assetIds, ticketSizeUsd);
          setRecord(prepared);
          onExecutionChange(prepared);
          setError("");
        } catch (recoveryError) {
          setError(recoveryError instanceof Error ? recoveryError.message : "Could not renew local session");
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  }

  async function settleDemo() {
    if (!record) return;
    setLoading(true);
    try {
      const settled = await api.demoSettle(record.plan.executionId);
      setRecord(settled);
      onExecutionChange(settled);
      onSettled(settled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settlement failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmLive() {
    if (!record?.walletCalls?.length || !wallet) {
      setError("No Investmade Wallet or executable calls are available.");
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
      const calls = record.walletCalls.map(smartWalletCall);
      setPhase("simulating");
      await client.prepareUserOperation({ calls });
      setPhase("signing");
      const transactionHash = await client.sendTransaction(
        { calls },
        {
          uiOptions: {
            description: `Invest ${formatTicketSizeUsd(total)} USDG into ${selected.length} assets. All purchases succeed or none.`,
            buttonText: "Sign and invest"
          }
        }
      );
      const submitted = await api.markSubmitted(
        record.plan.executionId,
        [transactionHash],
        true
      );
      setRecord(submitted);
      onExecutionChange(submitted);
      setPhase("settling");
      const reconciled = await reconcileUntilTerminal(record.plan.executionId);
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
                <button type="button" onClick={() => onRemove(candidate.assetId)} aria-label={`Remove ${candidate.symbol}`}><Close /></button>
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
          { label: "Budget within limit", value: `${total} / 100 USDG`, ok: true },
          { label: "Assets eligible", value: `${selected.length} / ${selected.length}`, ok: true },
          { label: "Robinhood Chain · 4663", value: "Connected", ok: true },
          {
            label: "Atomic Investmade Wallet",
            value: smartWalletReady ? "Ready" : "Activation required",
            ok: smartWalletReady
          },
          {
            label: quotesFresh ? "Quotes fresh" : "Preview expired",
            value: quotesFresh ? `${Math.ceil(quoteExpiry / 1000)}s` : "Refresh required",
            ok: quotesFresh
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
        <div className="wallet-boundary"><Shield /><p><b>One approval · all-or-nothing.</b><br />The complete call set is simulated before Privy opens the signing prompt.</p></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="review-actions">
          <button type="button" className="button button-outline" onClick={onBack}>Back to cards</button>
          {!record ? (
            <button type="button" className="button button-primary" onClick={prepare} disabled={loading || !selected.length}>
              {loading ? "Refreshing…" : "Refresh quotes & continue"} <ArrowRight />
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={
                record.status === "SUBMITTED"
                  ? resumeReconciliation
                  : !quotesFresh
                    ? prepare
                  : record.walletCalls?.length
                    ? confirmLive
                    : settleDemo
              }
              disabled={loading || record.status === "SETTLED"}
            >
              {record.status === "SETTLED"
                ? "Settled"
                : loading
                  ? phaseLabel(phase)
                  : record.status === "SUBMITTED"
                    ? "Check settlement receipt"
                    : !quotesFresh
                      ? "Refresh quotes & continue"
                    : record.walletCalls?.length
                    ? "Review and sign"
                    : "Simulate wallet confirmation"} <ArrowRight />
            </button>
          )}
        </div>
      </aside>

      <section className="execution-strip">
        <h2>Execution progress</h2>
        {["Awaiting signature", "Submitted", "Settled"].map((step, index) => {
          const active = record ? (record.status === "SETTLED" ? index <= 2 : index === 0) : index === 0;
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
