import type { Candidate } from "../../domain/schemas";
import { formatUnits } from "viem";
import type { ExecutionRecord, FeedResponse } from "../api";
import { AssetMark } from "./AssetMark";
import { Check, Shield } from "./Icons";
import { LoaderCircle, RotateCcw } from "lucide-react";

export function ReceiptScreen({
  record,
  selected,
  feed,
  demoMode,
  onResume,
  onStartNextBasket
}: {
  record?: ExecutionRecord;
  selected: Candidate[];
  feed?: FeedResponse;
  demoMode: boolean;
  onResume: () => Promise<void>;
  onStartNextBasket: () => void;
}) {
  if (!record) {
    return (
      <main className="empty-page">
        <h1>Activity</h1>
        <p>Your terminal settlement receipts will appear here. A quote or transaction hash alone is never shown as settled.</p>
        <button type="button" className="button button-primary" onClick={onStartNextBasket}>
          New basket
        </button>
      </main>
    );
  }
  const isTerminal = ["SETTLED", "PARTIAL", "FAILED"].includes(record.status);
  const successfulLegs = record.settledOutputs.filter((output) => output.status === "success").length;
  const receiptStatus = receiptCopy(record.status, selected.length, successfulLegs, demoMode);
  const outputsByAssetId = new Map(record.settledOutputs.map((output) => [output.assetId, output]));
  const transactionHash = record.transactionHashes.at(-1);
  const isPending = record.status === "SUBMITTED";
  return (
    <main className="receipt-page">
      <div className="receipt-heading">
        <span className={`receipt-check ${isPending ? "pending" : record.status === "FAILED" ? "failed" : ""}`}>
          {isPending ? <LoaderCircle /> : record.status === "FAILED" ? <span aria-hidden="true">!</span> : <Check />}
        </span>
        <div><h1>{receiptStatus.title}</h1><p>{receiptStatus.description}</p></div>
      </div>
      <section className="receipt-ledger">
        <div className="receipt-header"><h2>{demoMode ? "Demo basket receipt" : "Atomic basket receipt"}</h2><span>{record.plan.epochId}</span></div>
        <div className="atomic-receipt-strip">
          <b>{demoMode ? "Simulated basket · no transaction" : "One confirmation · one operation"}</b>
          <span>
            {demoMode
              ? `${record.plan.quotes.length} swap legs were simulated locally.`
              : `${record.plan.quotes.length} swaps execute together or the complete basket reverts.`}
          </span>
          {transactionHash ? (
            demoMode ? <code>{shortHash(transactionHash)}</code> : (
              <a href={explorerUrl(transactionHash)} target="_blank" rel="noreferrer">{shortHash(transactionHash)}</a>
            )
          ) : <code>Awaiting operation hash</code>}
        </div>
        {selected.map((candidate) => {
          const output = outputsByAssetId.get(candidate.assetId);
          const isSuccess = output?.status === "success";
          return (
            <div className="receipt-row" key={candidate.assetId}>
              <AssetMark symbol={candidate.symbol} size="sm" />
              <b>
                {candidate.symbol}
                <small>{formatUnits(BigInt(candidate.quote.amountInBaseUnits), 6)} USDG input</small>
              </b>
              <span className={isSuccess ? "status-complete" : output?.status === "failed" ? "status-failed" : "status-pending"}>
                {isSuccess ? <Check /> : null}
                {isSuccess && output
                  ? `${formatUnits(BigInt(output.amountOutBaseUnits), candidate.decimals)} ${candidate.symbol}`
                  : output?.status === "failed"
                    ? "Not settled"
                    : isTerminal
                      ? "No output recorded"
                      : "Awaiting receipt"}
              </span>
            </div>
          );
        })}
        {!selected.length ? (
          <p className="receipt-missing-snapshot">The operation is preserved, but its local card snapshot is unavailable. Use the operation link for the canonical onchain details.</p>
        ) : null}
        <div className="receipt-actions">
          {transactionHash && !demoMode ? (
            <a className="button button-primary" href={explorerUrl(transactionHash)} target="_blank" rel="noreferrer">
              View transaction on Robinhood Chain
            </a>
          ) : null}
          {isPending ? (
            <button type="button" className="button button-outline" onClick={() => void onResume()}>
              <RotateCcw aria-hidden="true" /> Check settlement
            </button>
          ) : null}
          <button type="button" className="button button-outline" onClick={onStartNextBasket}>
            New basket
          </button>
        </div>
      </section>
      <aside className="receipt-proof">
        <h2>Proof chain</h2>
        <p><Shield /><span>Authorized plan<b>{shortHash(record.plan.authorizedPlanHash)}</b></span></p>
        <p><Shield /><span>Policy hash<b>{shortHash(record.plan.policyHash)}</b></span></p>
        <p><Shield /><span>{demoMode ? "Ranking output" : "0G output"}<b>{feed ? shortHash(feed.proof.outputCommitment) : "Feed snapshot unavailable"}</b></span></p>
        {!demoMode && feed?.proof.teeVerified ? (
          <div className="receipt-proof-links">
            <a href={zeroGProviderUrl(feed.proof.provider)} target="_blank" rel="noreferrer">
              View TEE provider on 0G Explorer ↗
            </a>
            <a href="https://0g.ai/product" target="_blank" rel="noreferrer">
              About 0G private inference ↗
            </a>
          </div>
        ) : null}
        <p><Shield /><span>{isTerminal ? "Terminal outcome" : "Onchain status"}<b>{record.status}</b></span></p>
        <div className={demoMode ? "demo-disclosure" : "live-disclosure"}>
          {demoMode
            ? "This receipt is local demo evidence. It is not mainnet settlement proof."
            : "Live settlement is verified from the atomic Robinhood Chain operation and output-token transfers to your Investmade Wallet."}
        </div>
      </aside>
    </main>
  );
}

function receiptCopy(status: ExecutionRecord["status"], totalLegs: number, successfulLegs: number, demoMode: boolean) {
  if (status === "SUBMITTED") {
    return { title: "Basket submitted", description: "Your Investmade Wallet broadcast one atomic operation. Waiting for Robinhood Chain settlement." };
  }
  if (status === "SETTLED") {
    return demoMode
      ? { title: "Demo complete", description: `All ${totalLegs} legs completed in local demo mode. No transaction was broadcast.` }
      : { title: "Basket settled", description: `All ${totalLegs} legs reached a verified terminal state on Robinhood Chain.` };
  }
  if (status === "PARTIAL") {
    return { title: "Basket partially settled", description: `${successfulLegs} of ${totalLegs} legs reached a verified terminal state. Review the receipt before trying again.` };
  }
  if (status === "FAILED") {
    return { title: "Basket not settled", description: "No output-token transfer was verified for this basket. Your wallet remains the source of truth." };
  }
  return { title: "Basket prepared", description: "Fresh Uniswap calls are ready for your wallet confirmation." };
}

function explorerUrl(hash: string) {
  return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

function zeroGProviderUrl(provider: string) {
  return `https://explorer.0g.ai/mainnet/blockchain/accounts/${encodeURIComponent(provider)}`;
}

function shortHash(hash: string) {
  return hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : hash;
}
