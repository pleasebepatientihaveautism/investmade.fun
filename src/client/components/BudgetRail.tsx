import type { Candidate } from "../../domain/schemas";
import type { OnboardingPreferences } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Close } from "./Icons";

export function BudgetRail({
  selected,
  onRemove,
  onReview,
  demoMode,
  ticketSizeUsd,
  cadence
}: {
  selected: Candidate[];
  onRemove: (assetId: string) => void;
  onReview: () => void;
  demoMode: boolean;
  ticketSizeUsd: number;
  cadence: OnboardingPreferences["cadence"];
}) {
  const remaining = 100 - selected.length * ticketSizeUsd;
  const maxCards = Math.min(10, Math.floor(100 / ticketSizeUsd));
  return (
    <aside className="budget-rail" aria-label={`This ${periodName(cadence)}'s budget`}>
      <h2>This {periodName(cadence)}’s budget</h2>
      <div className="budget-stats">
        <div><strong>{remaining}</strong><span><b>USDG</b>remaining</span></div>
        <div><strong>{selected.length}</strong><span><b>of {maxCards}</b>selected</span></div>
      </div>
      <div className="budget-progress"><span style={{ width: `${selected.length * ticketSizeUsd}%` }} /></div>
      <div className="budget-scale"><span>100 USDG limit</span><span>{ticketSizeUsd} USDG per selection</span></div>
      <div className="basket-head"><h3>Your basket</h3><span>{selected.length} assets</span></div>
      <div className="basket-list">
        {selected.length === 0 ? (
          <div className="empty-basket">Swipe right to start your basket.</div>
        ) : (
          selected.map((candidate) => (
            <div className="basket-row" key={candidate.assetId}>
              <AssetMark symbol={candidate.symbol} size="sm" />
              <span className="basket-name"><strong>{candidate.symbol}</strong><small>{candidate.name}</small></span>
              <span className="basket-amount"><strong>{ticketSizeUsd}</strong><small>USDG</small></span>
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

function periodName(cadence: OnboardingPreferences["cadence"]) {
  if (cadence === "daily") return "day";
  if (cadence === "monthly") return "month";
  return "week";
}
