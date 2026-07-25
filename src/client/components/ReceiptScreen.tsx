import type { Candidate } from "../../domain/schemas";
import { formatUnits } from "viem";
import type { ExecutionRecord, FeedResponse } from "../api";
import { AssetMark } from "./AssetMark";
import { Check, Shield } from "./Icons";

export function ReceiptScreen({
  record,
  selected,
  feed,
  demoMode,
  onStartNextBasket
}: {
  record?: ExecutionRecord;
  selected: Candidate[];
  feed?: FeedResponse;
  demoMode: boolean;
  onStartNextBasket: () => void;
}) {
  if (!record || !feed) {
    return (
      <main className="empty-page">
        <h1>Receipts</h1>
        <p>Your terminal settlement receipts will appear here. A quote or transaction hash alone is never shown as settled.</p>
      </main>
    );
  }
  const isTerminal = ["SETTLED", "PARTIAL", "FAILED"].includes(record.status);
  const successfulLegs = record.settledOutputs.filter((output) => output.status === "success").length;
  const receiptStatus = receiptCopy(record.status, selected.length, successfulLegs, demoMode);
  const outputsByAssetId = new Map(record.settledOutputs.map((output) => [output.assetId, output]));
  const transactionHash = record.transactionHashes.at(-1);
  return (
    <main className="receipt-page">
      <div className="receipt-heading">
        <span className="receipt-check"><Check /></span>
        <div><h1>{receiptStatus.title}</h1><p>{receiptStatus.description}</p></div>
      </div>
      <section className="receipt-ledger">
        <div className="receipt-header"><h2>Settlement receipt</h2><span>{record.plan.epochId}</span></div>
        {selected.map((candidate, index) => {
          const output = outputsByAssetId.get(candidate.assetId);
          const hash = output?.transactionHash ?? record.transactionHashes[index];
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
              {hash ? (
                demoMode ? <code>{shortHash(hash)}</code> : (
                  <a className="receipt-hash" href={explorerUrl(hash)} target="_blank" rel="noreferrer">
                    {shortHash(hash)}
                  </a>
                )
              ) : <code>Awaiting hash</code>}
            </div>
          );
        })}
        <div className="receipt-actions">
          {transactionHash && !demoMode ? (
            <a className="button button-primary" href={explorerUrl(transactionHash)} target="_blank" rel="noreferrer">
              View transaction on Robinhood Chain
            </a>
          ) : null}
          <button type="button" className="button button-outline" onClick={onStartNextBasket}>
            Build another basket
          </button>
        </div>
      </section>
      <aside className="receipt-proof">
        <h2>Proof chain</h2>
        <p><Shield /><span>Authorized plan<b>{shortHash(record.plan.authorizedPlanHash)}</b></span></p>
        <p><Shield /><span>Policy hash<b>{shortHash(record.plan.policyHash)}</b></span></p>
        <p><Shield /><span>0G output<b>{shortHash(feed.proof.outputCommitment)}</b></span></p>
        <p><Shield /><span>{isTerminal ? "Terminal outcome" : "Onchain status"}<b>{record.status}</b></span></p>
        <div className={demoMode ? "demo-disclosure" : "live-disclosure"}>
          {demoMode
            ? "This receipt is local demo evidence. It is not mainnet settlement proof."
            : "Live settlement is verified from Robinhood Chain transaction receipts and output-token transfers to your connected wallet."}
        </div>
      </aside>
    </main>
  );
}

function receiptCopy(status: ExecutionRecord["status"], totalLegs: number, successfulLegs: number, demoMode: boolean) {
  if (status === "SUBMITTED") {
    return { title: "Transaction submitted", description: "Your wallet broadcast the Uniswap calls. Waiting for Robinhood Chain receipts." };
  }
  if (status === "SETTLED") {
    return { title: "Basket settled", description: `All ${totalLegs} legs reached a verified terminal state${demoMode ? " in local demo mode" : " on Robinhood Chain"}.` };
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

function shortHash(hash: string) {
  return hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : hash;
}
