import type { Candidate } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { Shield } from "./Icons";

const CARD_DOTS = Array.from({ length: 10 }, (_, dot) => `card-dot-${dot + 1}`);

export function SwipeCard({
  candidate,
  index,
  total,
  demoMode
}: {
  candidate: Candidate;
  index: number;
  total: number;
  demoMode: boolean;
}) {
  return (
    <article className="swipe-card">
      <div className="card-head">
        <div className="asset-title">
          <AssetMark symbol={candidate.symbol} size="lg" />
          <div>
            <h2>{candidate.symbol}</h2>
            <p>{candidate.name}</p>
          </div>
        </div>
        <div className="allocation-stamp">
          <strong>10</strong>
          <span>USDG</span>
        </div>
      </div>
      <div className={`signal-field signal-${candidate.symbol.toLowerCase()}`}>
        <span>{candidate.symbol}</span>
      </div>
      <p className="card-reason">{candidate.reason}</p>
      <div className="card-evidence">
        <div>
          <p className="micro-label">Evidence</p>
          <ul>
            <li><span className="evidence-dot blue" />{demoMode ? "Local ranking fixture" : "0G private"}</li>
            <li><span className="evidence-dot black" />{demoMode ? "Identity fixture" : "World verified"}</li>
            <li><Shield />{demoMode ? "Quote fixture" : "Uniswap quote"}</li>
          </ul>
        </div>
        <div className="metrics">
          <p className="micro-label">Key metrics</p>
          <div className="metric-row">
            <span><strong>{Math.round(candidate.crowdScoreBps / 100)}%</strong>Crowd</span>
            <span><strong>{(candidate.quote.priceImpactBps / 100).toFixed(2)}%</strong>Impact</span>
            <span><strong>fresh</strong>Quote</span>
          </div>
        </div>
      </div>
      <fieldset className="card-counter">
        <legend className="sr-only">Card {index + 1} of {total}</legend>
        {CARD_DOTS.slice(0, total).map((dotId, dot) => (
          <span key={dotId} className={dot === index ? "active" : ""} />
        ))}
      </fieldset>
    </article>
  );
}
