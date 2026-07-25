import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { STOCK_LOGO_DOMAINS } from "../../domain/constants";
import { api } from "../api";

const TICKER_LOGO_CDN = "https://cdn.tickerlogos.com";
const AssetIconsContext = createContext<Record<string, string>>({});

export function AssetIconProvider({ children }: { children: ReactNode }) {
  const [icons, setIcons] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    api.assetIcons().then(({ icons: next }) => {
      if (mounted) setIcons(next);
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  return <AssetIconsContext.Provider value={icons}>{children}</AssetIconsContext.Provider>;
}

function AssetLogo({ iconUrl, domain, symbol }: { iconUrl?: string; domain?: string; symbol: string }) {
  const initialSource = iconUrl ? "coingecko" : domain ? "allinvest" : "letter";
  const [source, setSource] = useState<"coingecko" | "allinvest" | "letter">(initialSource);

  useEffect(() => setSource(iconUrl ? "coingecko" : domain ? "allinvest" : "letter"), [iconUrl, domain]);

  const imageUrl = source === "coingecko" ? iconUrl : source === "allinvest" && domain ? `${TICKER_LOGO_CDN}/${domain}` : undefined;

  if (!imageUrl) return <span aria-hidden="true">{symbol === "WETH" ? "◆" : symbol.slice(0, 1)}</span>;

  return (
    <img
      src={imageUrl}
      alt={`${symbol} logo`}
      onError={() => setSource(source === "coingecko" && domain ? "allinvest" : "letter")}
    />
  );
}

export function AssetMark({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  const domain = STOCK_LOGO_DOMAINS[symbol];
  const iconUrl = useContext(AssetIconsContext)[symbol];

  return (
    <span className={`asset-mark asset-${symbol.toLowerCase()} asset-mark-${size}`}>
      {iconUrl || domain ? <AssetLogo key={`${iconUrl ?? ""}:${domain ?? ""}`} iconUrl={iconUrl} domain={domain} symbol={symbol} /> : <span aria-hidden="true">{symbol === "WETH" ? "◆" : symbol.slice(0, 1)}</span>}
    </span>
  );
}
