import type { Candidate } from "../../domain/schemas";
import type { OnboardingPreferences } from "../../domain/schemas";
import { formatTicketSizeUsd } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { Close } from "./Icons";

export function BudgetRail({
  selected,
  onRemove,
  executionMode,
  ticketSizeUsd,
  cadence
}: {
  selected: Candidate[];
  onRemove: (assetId: string) => void;
  executionMode: "demo" | "local-live" | "live";
  ticketSizeUsd: number;
  cadence: OnboardingPreferences["cadence"];
}) {
  const remaining = Math.round((100 - selected.length * ticketSizeUsd) * 100) / 100;
  return (
    <aside className="budget-rail" aria-label={`This ${periodName(cadence)}'s budget`}>
      <div className="budget-summary">
        <h2>This {periodName(cadence)}</h2>
        <p><strong>{formatTicketSizeUsd(remaining)}</strong> USDG left</p>
        <span>{selected.length} selected · {formatTicketSizeUsd(ticketSizeUsd)} each</span>
      </div>
      <div
        className="budget-progress"
        role="progressbar"
        aria-label="Period budget allocated"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100 - remaining}
      >
        <span style={{ width: `${Math.min(100, selected.length * ticketSizeUsd)}%` }} />
      </div>
      {selected.length ? (
        <>
          <div className="basket-head"><h3>Your basket</h3><span>{selected.length} assets</span></div>
          <div className="basket-list">
            {selected.map((candidate) => (
              <div className="basket-row" key={candidate.assetId}>
                <AssetMark symbol={candidate.symbol} size="sm" />
                <span className="basket-name"><strong>{candidate.symbol}</strong><small>{candidate.name}</small></span>
                <span className="basket-amount"><strong>{formatTicketSizeUsd(ticketSizeUsd)}</strong><small>USDG</small></span>
                <button type="button" onClick={() => onRemove(candidate.assetId)} aria-label={`Remove ${candidate.symbol}`}>
                  <Close />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <div className="budget-meta">
        <span>Quotes refresh before signing</span>
        <span className="network-line"><i />Robinhood Chain · 4663 <b>{executionMode === "demo" ? "Demo" : executionMode === "local-live" ? "Live signing" : "Healthy"}</b></span>
      </div>
    </aside>
  );
}

function periodName(cadence: OnboardingPreferences["cadence"]) {
  if (cadence === "daily") return "day";
  if (cadence === "monthly") return "month";
  return "week";
}
