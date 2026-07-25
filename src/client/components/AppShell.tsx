import type { ReactNode } from "react";
import { WalletCards } from "lucide-react";

interface Props {
  active: "week" | "positions" | "receipts";
  onNavigate: (target: Props["active"]) => void;
  wallet?: string;
  onWallet?: () => void;
  children: ReactNode;
}

export function AppShell({ active, onNavigate, wallet, onWallet, children }: Props) {
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
            ["receipts", "Receipts"]
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
        <button type="button" className="wallet-button" onClick={onWallet} title={onWallet ? "Log out of Privy" : undefined}>
          <WalletCards size={17} strokeWidth={1.7} />
          {wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "0x71F3…09A2"}
        </button>
      </header>
      {children}
    </div>
  );
}
