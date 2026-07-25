export function AssetMark({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`asset-mark asset-${symbol.toLowerCase()} asset-mark-${size}`} aria-hidden="true">
      {symbol === "WETH" ? "◆" : symbol.slice(0, 1)}
    </span>
  );
}
