import type { Candidate } from "../../domain/schemas";
import { formatUnits } from "viem";
import type { ExecutionRecord, FeedResponse } from "../api";
import { AssetMark } from "./AssetMark";
import { Check, Shield } from "./Icons";

export function ReceiptScreen({
  record,
  selected,
  feed
}: {
  record?: ExecutionRecord;
  selected: Candidate[];
  feed?: FeedResponse;
}) {
  if (!record || !feed) {
    return (
      <main className="empty-page">
        <h1>Receipts</h1>
        <p>Your terminal settlement receipts will appear here. A quote or transaction hash alone is never shown as settled.</p>
      </main>
    );
  }
  return (
    <main className="receipt-page">
      <div className="receipt-heading">
        <span className="receipt-check"><Check /></span>
        <div><h1>Basket settled</h1><p>All {selected.length} legs reached a terminal state in local demo mode.</p></div>
      </div>
      <section className="receipt-ledger">
        <div className="receipt-header"><h2>Settlement receipt</h2><span>{record.plan.epochId}</span></div>
        {selected.map((candidate, index) => (
          <div className="receipt-row" key={candidate.assetId}>
            <AssetMark symbol={candidate.symbol} size="sm" />
            <b>{candidate.symbol}<small>10 USDG input</small></b>
            <span className="status-complete">
              <Check />{" "}
              {record.settledOutputs[index]
                ? `${formatUnits(BigInt(record.settledOutputs[index].amountOutBaseUnits), candidate.decimals)} ${candidate.symbol}`
                : "Settled"}
            </span>
            <code>{shortHash(record.transactionHashes[index] ?? "demo")}</code>
          </div>
        ))}
      </section>
      <aside className="receipt-proof">
        <h2>Proof chain</h2>
        <p><Shield /><span>Authorized plan<b>{shortHash(record.plan.authorizedPlanHash)}</b></span></p>
        <p><Shield /><span>Policy hash<b>{shortHash(record.plan.policyHash)}</b></span></p>
        <p><Shield /><span>0G output<b>{shortHash(feed.proof.outputCommitment)}</b></span></p>
        <p><Shield /><span>Terminal outcome<b>{record.status}</b></span></p>
        <div className="demo-disclosure">This receipt is clearly marked local demo evidence. It is not mainnet settlement proof.</div>
      </aside>
    </main>
  );
}

function shortHash(hash: string) {
  return hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : hash;
}
