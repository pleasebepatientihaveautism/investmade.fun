import type { ReactNode } from "react";
import { WalletCards } from "lucide-react";

interface Props {
  active: "week" | "positions" | "receipts" | "account";
  onNavigate: (target: Props["active"]) => void;
  wallet?: string;
  onWallet?: () => void;
  walletReady?: boolean;
  children: ReactNode;
}

export function AppShell({
  active,
  onNavigate,
  wallet,
  onWallet,
  walletReady = true,
  children
}: Props) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button type="button" className="brand" onClick={() => onNavigate("week")} aria-label="investmade.fun home">
          investmade.<span>fun</span>
        </button>
        <nav aria-label="Primary navigation">
          {[
            ["week", "This week"],
            ["positions", "Positions"],
            ["receipts", "Receipts"],
            ["account", "Account"]
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={active === id ? "nav-link active" : "nav-link"}
              onClick={() => onNavigate(id as Props["active"])}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="wallet-button"
          onClick={onWallet}
          disabled={!walletReady}
          aria-label={wallet ? "Disconnect Privy wallet" : "Connect wallet with Privy"}
          title={wallet ? "Disconnect Privy wallet" : "Connect wallet with Privy"}
        >
          <WalletCards size={17} strokeWidth={1.7} />
          {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect wallet"}
        </button>
      </header>
      {children}
      <footer className="logo-attribution">
        <a href="https://www.coingecko.com/en/api">Crypto icons by CoinGecko</a>
        <span> · </span>
        <a href="https://www.allinvestview.com/tools/ticker-logos/">Stock logos by AllInvestView</a>
      </footer>
    </div>
  );
}
