import { type ReactNode, useEffect } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import type { ConnectedStandardSolanaWallet } from "@privy-io/react-auth/solana";
import { Wallet } from "lucide-react";
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
	activeChain: "ROBINHOOD" | "SOLANA";
	onChainChange: (chain: "ROBINHOOD" | "SOLANA") => void;
	solanaWallets: ConnectedStandardSolanaWallet[];
	solanaWalletsReady: boolean;
	solanaAvailable: boolean;
	selectedSolanaWallet?: ConnectedStandardSolanaWallet;
	onSolanaWalletChange: (wallet: ConnectedStandardSolanaWallet) => void;
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
	activeChain,
	onChainChange,
	solanaWallets,
	solanaWalletsReady,
	solanaAvailable,
	selectedSolanaWallet,
	onSolanaWalletChange,
	children,
}: Props) {
	useEffect(() => {
		const root = document.documentElement;
		const themeColor = document.querySelector<HTMLMetaElement>(
			'meta[name="theme-color"]',
		);
		const previousChain = root.dataset.chain;
		const previousThemeColor = themeColor?.content;
		const chain = activeChain.toLowerCase();

		root.dataset.chain = chain;
		if (themeColor) {
			themeColor.content = activeChain === "SOLANA" ? "#090B0F" : "#f1f3f6";
		}

		return () => {
			if (previousChain) root.dataset.chain = previousChain;
			else delete root.dataset.chain;
			if (themeColor && previousThemeColor) themeColor.content = previousThemeColor;
		};
	}, [activeChain]);

	return (
		<div className="app-shell">
			<header className={navigationEnabled ? "topbar" : "topbar topbar-onboarding"}>
				<button
					type="button"
					className="brand"
					onClick={() => onNavigate("week")}
					aria-label="invest4.fun home"
				>
					invest4.<span>fun</span>
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
							activeChain={activeChain}
							onChainChange={onChainChange}
							solanaWallets={solanaWallets}
							solanaWalletsReady={solanaWalletsReady}
							solanaAvailable={solanaAvailable}
							selectedSolanaWallet={selectedSolanaWallet}
							onSolanaWalletChange={onSolanaWalletChange}
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
						<Wallet size={17} strokeWidth={1.7} />
						Connect wallet
					</button>
				)}
			</header>
			{children}
		</div>
	);
}
