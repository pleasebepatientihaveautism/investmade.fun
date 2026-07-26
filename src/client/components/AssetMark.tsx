import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { STOCK_LOGO_DOMAINS } from "../../domain/constants";
import { api } from "../api";

const TICKER_LOGO_CDN = "https://cdn.tickerlogos.com";
const LOGO_DEV_PUBLISHABLE_KEY = "pk_Vd4Z_uMzQJCMUA21nk_6Gw";
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
  const initialSource = domain ? "logoDev" : iconUrl ? "coingecko" : "letter";
  const [source, setSource] = useState<"coingecko" | "logoDev" | "allinvest" | "letter">(initialSource);

  useEffect(() => setSource(domain ? "logoDev" : iconUrl ? "coingecko" : "letter"), [iconUrl, domain]);

  const imageUrl = source === "logoDev"
    ? `https://img.logo.dev/ticker/${encodeURIComponent(symbol.toUpperCase())}?token=${LOGO_DEV_PUBLISHABLE_KEY}&size=128&format=png&theme=light&retina=true&fallback=404`
    : source === "coingecko"
      ? iconUrl
      : source === "allinvest" && domain
        ? `${TICKER_LOGO_CDN}/${domain}`
        : undefined;

  if (!imageUrl) return <span aria-hidden="true">{symbol === "WETH" ? "◆" : symbol.slice(0, 1)}</span>;

  return (
    <img
      src={imageUrl}
      alt={`${symbol} logo`}
      onError={() => setSource(source === "logoDev" && domain ? "allinvest" : "letter")}
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
