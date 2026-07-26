import type { ReactNode } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { WalletCards } from "lucide-react";
import { WalletMenu } from "./WalletMenu";

interface Props {
	active: "week" | "positions" | "receipts" | "account";
	onNavigate: (target: Props["active"]) => void;
	wallet?: string;
	fundingWallet?: ConnectedWallet;
	topUpRequest?: number;
	onWallet?: () => void;
	walletReady?: boolean;
	navigationEnabled?: boolean;
	children: ReactNode;
}

export function AppShell({
	active,
	onNavigate,
	wallet,
	fundingWallet,
	topUpRequest,
	onWallet,
	walletReady = true,
	navigationEnabled = true,
	children,
}: Props) {
	return (
		<div className="app-shell">
			<header className={navigationEnabled ? "topbar" : "topbar topbar-onboarding"}>
				<button
					type="button"
					className="brand"
					onClick={() => onNavigate("week")}
					aria-label="investmade.fun home"
				>
					investmade.<span>fun</span>
				</button>
				{navigationEnabled ? (
					<nav aria-label="Primary navigation">
						{[
							["week", "Basket"],
							["positions", "Portfolio"],
							["receipts", "Activity"],
							["account", "Account"],
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
				) : null}
				{wallet ? (
					<div className="wallet-pill">
						<WalletMenu
							wallet={wallet}
							fundingWallet={fundingWallet}
							topUpRequest={topUpRequest}
						/>
					</div>
				) : (
					<button
						type="button"
						className="wallet-button"
						onClick={onWallet}
						disabled={!walletReady}
						aria-label="Connect wallet with Privy"
						title="Connect wallet with Privy"
					>
						<WalletCards size={17} strokeWidth={1.7} />
						Connect wallet
					</button>
				)}
			</header>
			{children}
		</div>
	);
}
