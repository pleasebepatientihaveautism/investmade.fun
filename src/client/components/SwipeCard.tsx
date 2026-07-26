import { useRef, useState } from "react";
import type { Candidate } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { Shield } from "./Icons";

const CARD_DOTS = Array.from({ length: 10 }, (_, dot) => `card-dot-${dot + 1}`);
const SWIPE_THRESHOLD_PX = 72;
type DecisionFeedback = "invest" | "skip";
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

export function SwipeCard({
  candidate,
  index,
  total,
  executionMode,
  ticketSizeUsd,
  feedback,
  onSwipe
}: {
  candidate: Candidate;
  index: number;
  total: number;
  executionMode: "demo" | "local-live" | "live";
  ticketSizeUsd: number;
  feedback?: DecisionFeedback;
  onSwipe: (add: boolean) => void;
}) {
  const pointerStart = useRef<{ id: number; x: number } | undefined>(undefined);
  const [dragX, setDragX] = useState(0);

  function resetDrag() {
    pointerStart.current = undefined;
    setDragX(0);
  }

  return (
    <article
      className={`swipe-card${dragX ? " is-dragging" : ""}${feedback ? ` is-${feedback}` : ""}`}
      style={{ transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)` }}
      onPointerDown={(event) => {
        if (feedback) return;
        pointerStart.current = { id: event.pointerId, x: event.clientX };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pointerStart.current || pointerStart.current.id !== event.pointerId) return;
        setDragX(Math.max(-120, Math.min(120, event.clientX - pointerStart.current.x)));
      }}
      onPointerUp={(event) => {
        if (!pointerStart.current || pointerStart.current.id !== event.pointerId) return;
        const distance = event.clientX - pointerStart.current.x;
        resetDrag();
        if (Math.abs(distance) >= SWIPE_THRESHOLD_PX) onSwipe(distance > 0);
      }}
      onPointerCancel={resetDrag}
    >
      {feedback ? (
        <div className={`card-decision-flash ${feedback}`} aria-live="polite">
          <div className="decision-confetti" aria-hidden="true"><i>✦</i><i>✦</i><i>✦</i></div>
          <span>{feedback === "invest" ? "👍" : "👎"}</span>
          <b>{feedback === "invest" ? "Added to basket" : "Skipped"}</b>
        </div>
      ) : null}
      <div className="card-head">
        <div className="asset-title">
          <AssetMark symbol={candidate.symbol} size="lg" />
          <div>
            <h2>{candidate.symbol}</h2>
            <p>{candidate.name}</p>
          </div>
        </div>
        <div className="allocation-stamp">
          <strong>{ticketSizeUsd}</strong>
          <span>USDG</span>
        </div>
      </div>
      <div className={`signal-field signal-${candidate.symbol.toLowerCase()}`}>
        <span>{candidate.symbol}</span>
      </div>
      <p className="card-reason">{candidate.reason}</p>
      <details className="card-disclosure">
        <summary>Why this asset?</summary>
        <div className="card-evidence">
          <div>
            <p className="micro-label">Evidence</p>
            <ul>
              <li><span className="evidence-dot blue" />{executionMode === "live" ? "0G private" : "Local ranking fixture"}</li>
              <li><span className="evidence-dot black" />{executionMode === "live" ? "World verified" : executionMode === "local-live" ? "Privy wallet auth" : "Identity fixture"}</li>
              <li><Shield />{executionMode === "demo" ? "Quote fixture" : "Live Uniswap quote"}</li>
            </ul>
          </div>
          <div className="metrics">
            <p className="micro-label">Key metrics</p>
            <div className="metric-row">
              <span><strong>{Math.round(candidate.crowdScoreBps / 100)}%</strong>Crowd</span>
              <span><strong>{(candidate.quote.priceImpactBps / 100).toFixed(2)}%</strong>Impact</span>
              <span><strong>{usdFormatter.format(Number(candidate.quote.unitPriceUsd))}</strong>Price</span>
              <span><strong>fresh</strong>Quote</span>
            </div>
          </div>
        </div>
      </details>
      <fieldset className="card-counter">
        <legend className="sr-only">Card {index + 1} of {total}</legend>
        {CARD_DOTS.slice(0, total).map((dotId, dot) => (
          <span key={dotId} className={dot === index ? "active" : ""} />
        ))}
      </fieldset>
    </article>
  );
}
