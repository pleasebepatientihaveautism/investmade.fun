import { useEffect, useMemo, useState } from "react";
import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import { formatUnits } from "viem";
import type { Candidate } from "../../domain/schemas";
import type { ExecutionRecord, FeedResponse, WeeklySession } from "../api";
import { api } from "../api";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check, Close, Shield } from "./Icons";

export function ReviewScreen({
  session,
  feed,
  selected,
  onRemove,
  onBack,
  onSettled
}: {
  session: WeeklySession;
  feed: FeedResponse;
  selected: Candidate[];
  onRemove: (assetId: string) => void;
  onBack: () => void;
  onSettled: (record: ExecutionRecord) => void;
}) {
  const { wallets } = useWallets();
  const activeWallet = wallets.find((candidate) => candidate.linked) ?? wallets[0];
  const [record, setRecord] = useState<ExecutionRecord>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const total = selected.length * 10;
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
    setError("");
    try {
      const prepared = await api.prepareExecution(
        session.id,
        selected.map((item) => item.assetId)
      );
      setRecord(prepared);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare execution");
    } finally {
      setLoading(false);
    }
  }

  async function settleDemo() {
    if (!record) return;
    setLoading(true);
    try {
      const settled = await api.demoSettle(record.plan.executionId);
      setRecord(settled);
      onSettled(settled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settlement failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmLive() {
    if (!record?.walletCalls?.length || !activeWallet) {
      setError("No connected wallet or executable calls are available.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await activeWallet.switchChain(4663);
      const provider = await activeWallet.getEthereumProvider();
      const swapHashes: string[] = [];
      for (const call of record.walletCalls) {
        const transactionHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: call.transaction.from,
              to: call.transaction.to,
              data: call.transaction.data,
              value: toHex(call.transaction.value),
              ...(call.transaction.gasLimit
                ? { gas: toHex(call.transaction.gasLimit) }
                : {})
            }
          ]
        })) as string;
        if (call.kind !== "SWAP") await waitForReceipt(provider, transactionHash);
        else swapHashes.push(transactionHash);
      }
      const submitted = await api.markSubmitted(record.plan.executionId, swapHashes);
      setRecord(submitted);
      const reconciled = await reconcileUntilTerminal(record.plan.executionId);
      setRecord(reconciled);
      onSettled(reconciled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet execution failed.");
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
              <span><strong>10</strong> USDG</span>
              <span><strong>{formatOutput(candidate.quote.estimatedAmountOut, candidate.decimals)}</strong> {candidate.symbol}</span>
              <span><strong>{formatOutput(candidate.quote.minimumAmountOut, candidate.decimals)}</strong> {candidate.symbol}</span>
              <span className="blue-text">{(candidate.quote.priceImpactBps / 100).toFixed(2)}%</span>
            </div>
          ))}
        </div>
        <div className="ledger-totals">
          <div><span>Total input</span><strong>{total} USDG</strong><small>to invest</small></div>
          <div><span>Remainder</span><strong>{100 - total} USDG</strong><small>stays in your wallet</small></div>
        </div>
      </section>

      <aside className="policy-rail">
        <h2>Policy checks</h2>
        {[
          { label: "Budget within limit", value: `${total} / 100 USDG`, ok: true },
          { label: "Assets eligible", value: `${selected.length} / ${selected.length}`, ok: true },
          { label: "Robinhood Chain · 4663", value: "Connected", ok: true },
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
        <div className="wallet-boundary"><Shield /><p>Your wallet may request multiple confirmations.<br />A transaction hash is not settlement proof.</p></div>
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
              onClick={record.walletCalls?.length ? confirmLive : settleDemo}
              disabled={loading || record.status === "SETTLED"}
            >
              {record.status === "SETTLED"
                ? "Settled"
                : loading
                  ? "Confirming…"
                  : record.walletCalls?.length
                    ? "Confirm in wallet"
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

function formatOutput(raw: string, decimals: number) {
  const value = Number(formatUnits(BigInt(raw), decimals));
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : "—";
}

function shortHash(hash: string) {
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function toHex(value: string) {
  return `0x${BigInt(value).toString(16)}`;
}

async function waitForReceipt(provider: EIP1193Provider, hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash]
    });
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Approval is still pending. Retry after it confirms.");
}

async function reconcileUntilTerminal(executionId: string): Promise<ExecutionRecord> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const record = await api.reconcile(executionId);
    if (["SETTLED", "PARTIAL", "FAILED"].includes(record.status)) return record;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Transactions are submitted but not terminal yet. Check Receipts shortly.");
}
