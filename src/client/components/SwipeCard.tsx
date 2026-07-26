import { useEffect, useRef, useState } from "react";
import type { Candidate } from "../../domain/schemas";
import { api, type AssetHistoryResponse } from "../api";
import { AssetMark } from "./AssetMark";
import { Shield } from "./Icons";

const SWIPE_THRESHOLD_PX = 72;
type DecisionFeedback = "invest" | "skip";
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

function PriceSparkline({ candidate }: { candidate: Candidate }) {
  const [history, setHistory] = useState<AssetHistoryResponse>();

  useEffect(() => {
    let active = true;
    void api.assetHistory(candidate.assetId)
      .then((result) => active && setHistory(result))
      .catch(() => active && setHistory({ period: "1W", source: "unavailable", points: [] }));
    return () => {
      active = false;
    };
  }, [candidate.assetId]);

  const prices = history?.points.map((point) => point.price) ?? [];
  const first = prices[0];
  const last = prices.at(-1);
  const change = first && last ? ((last - first) / first) * 100 : 0;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || 1;
  const line = prices
    .map((price, index) => {
      const x = prices.length === 1 ? 50 : (index / (prices.length - 1)) * 100;
      const y = 28 - ((price - min) / spread) * 23;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const source = history?.source === "the-graph" ? "The Graph · Uniswap v4" : history ? "History unavailable" : "Loading chart";
  const period = history?.period ?? "1W";

  return (
    <div className={`price-chart${change < 0 ? " is-down" : ""}`}>
      <div className="chart-meta">
        <strong>{usdFormatter.format(Number(candidate.quote.unitPriceUsd))}</strong>
        <span>{prices.length ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}% · ${period}` : `— · ${period}`}</span>
      </div>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={`${candidate.symbol} one week price chart`}>
        {line ? <><polygon points={`0,32 ${line} 100,32`} /><polyline points={line} /></> : <line x1="0" y1="18" x2="100" y2="18" className="chart-loading-line" />}
      </svg>
      <div className="chart-source"><span>{period}</span><span>{source}</span></div>
    </div>
  );
}

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
          <b>{feedback === "invest" ? "In your basket" : "Skipped"}</b>
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
      <PriceSparkline candidate={candidate} />
      <p className="card-reason">{candidate.reason}</p>
      <details className="card-disclosure">
        <summary>Why it made the feed</summary>
        <div className="card-evidence">
          <div>
            <p className="micro-label">Evidence</p>
            <ul>
              <li><span className="evidence-dot blue" />{executionMode === "live" ? "0G private" : executionMode === "local-live" ? "Local ranking receipt" : "Demo ranking receipt"}</li>
              <li><span className="evidence-dot black" />{executionMode === "live" ? "Privy wallet auth" : executionMode === "local-live" ? "Privy wallet auth" : "Demo wallet boundary"}</li>
              <li><Shield />{executionMode === "demo" ? "Quote fixture" : "Live Uniswap quote"}</li>
            </ul>
          </div>
          <div className="metrics">
            <p className="micro-label">Key metrics</p>
            <div className="metric-row">
              <span>
                <strong>{candidate.crowdScoreBps ? `${Math.round(candidate.crowdScoreBps / 100)}%` : "—"}</strong>
                {candidate.crowdScoreBps ? "Crowd" : "No crowd data"}
              </span>
              <span><strong>{(candidate.quote.priceImpactBps / 100).toFixed(2)}%</strong>Impact</span>
              <span><strong>{usdFormatter.format(Number(candidate.quote.unitPriceUsd))}</strong>Price</span>
              <span><strong>fresh</strong>Quote</span>
            </div>
          </div>
        </div>
      </details>
      <fieldset className="card-counter">
        <legend className="sr-only">Card {index + 1} of {total}</legend>
        <span>{index + 1} of {total}</span>
      </fieldset>
    </article>
  );
}
