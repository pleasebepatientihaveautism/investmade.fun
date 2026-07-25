import { useState } from "react";
import { STOCK_LOGO_DOMAINS } from "../../domain/constants";

const TICKER_LOGO_CDN = "https://cdn.tickerlogos.com";

function TickerLogo({ domain, symbol }: { domain: string; symbol: string }) {
  const [logoFailed, setLogoFailed] = useState(false);

  if (logoFailed) return <span aria-hidden="true">{symbol.slice(0, 1)}</span>;

  return (
    <img
      src={`${TICKER_LOGO_CDN}/${domain}`}
      alt={`${symbol} logo`}
      onError={() => setLogoFailed(true)}
    />
  );
}

export function AssetMark({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const domain = STOCK_LOGO_DOMAINS[symbol];

  return (
    <span className={`asset-mark asset-${symbol.toLowerCase()} asset-mark-${size}`}>
      {domain ? (
        <TickerLogo key={domain} domain={domain} symbol={symbol} />
      ) : (
        <span aria-hidden="true">{symbol === "WETH" ? "◆" : symbol.slice(0, 1)}</span>
      )}
    </span>
  );
}
