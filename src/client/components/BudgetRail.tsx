import type { Candidate } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Close } from "./Icons";

export function BudgetRail({
  selected,
  onRemove,
  onReview,
  demoMode
}: {
  selected: Candidate[];
  onRemove: (assetId: string) => void;
  onReview: () => void;
  demoMode: boolean;
}) {
  const remaining = 100 - selected.length * 10;
  return (
    <aside className="budget-rail" aria-label="This week's budget">
      <h2>This week’s budget</h2>
      <div className="budget-stats">
        <div><strong>{remaining}</strong><span><b>USDG</b>remaining</span></div>
        <div><strong>{selected.length}</strong><span><b>of 10</b>selected</span></div>
      </div>
      <div className="budget-progress"><span style={{ width: `${selected.length * 10}%` }} /></div>
      <div className="budget-scale"><span>100 USDG total</span><span>10 USDG per selection</span></div>
      <div className="basket-head"><h3>Your basket</h3><span>{selected.length} assets</span></div>
      <div className="basket-list">
        {selected.length === 0 ? (
          <div className="empty-basket">Swipe right to start your basket.</div>
        ) : (
          selected.map((candidate) => (
            <div className="basket-row" key={candidate.assetId}>
              <AssetMark symbol={candidate.symbol} size="sm" />
              <span className="basket-name"><strong>{candidate.symbol}</strong><small>{candidate.name}</small></span>
              <span className="basket-amount"><strong>10</strong><small>USDG</small></span>
              <button type="button" onClick={() => onRemove(candidate.assetId)} aria-label={`Remove ${candidate.symbol}`}>
                <Close />
              </button>
            </div>
          ))
        )}
      </div>
      <button type="button" className="button button-outline rail-review" disabled={!selected.length} onClick={onReview}>
        Review basket <ArrowRight />
      </button>
      <div className="freshness-note">
        <span>!</span>
        <p><strong>Quotes are time-sensitive</strong>They refresh before confirmation.</p>
        <b>60s</b>
      </div>
      <div className="network-line"><span />Robinhood Chain · 4663 <b>{demoMode ? "Demo fixture" : "Healthy"}</b></div>
    </aside>
  );
}
