import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
	type ConnectedStandardSolanaWallet,
	useSignTransaction,
} from "@privy-io/react-auth/solana";
import { FilePen, HandCoins, LoaderCircle, LogOut, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { type Address, formatUnits, type Hex } from "viem";
import type { Candidate } from "../../domain/schemas";
import { api, type ExitPreparation, type WalletCall } from "../api";
import { AssetMark } from "./AssetMark";
import { Check } from "./Icons";

const usdFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

export function PositionsScreen({
	candidates,
	wallet,
	demoMode,
	activeChain,
	solanaWallet,
}: {
	candidates: Candidate[];
	wallet: string;
	demoMode: boolean;
	activeChain: "ROBINHOOD" | "SOLANA";
	solanaWallet?: ConnectedStandardSolanaWallet;
}) {
	const { client: smartWalletClient, getClientForChain } = useSmartWallets();
	const { signTransaction } = useSignTransaction();
	const [balances, setBalances] = useState<Record<string, string>>({});
	const [indexedPortfolio, setIndexedPortfolio] = useState<Candidate[]>([]);
	const [portfolioLoading, setPortfolioLoading] = useState(false);
	const [prepared, setPrepared] = useState<Record<string, ExitPreparation>>({});
	const [status, setStatus] = useState<Record<string, string>>({});
	const [isExitingAll, setIsExitingAll] = useState(false);
	const [exitAllOpen, setExitAllOpen] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (demoMode || !wallet) return;
		let cancelled = false;
		setPortfolioLoading(true);
		setError("");
		setIndexedPortfolio([]);
		setBalances({});
		if (activeChain === "SOLANA") {
			api
				.solanaPortfolio(wallet)
				.then((portfolio) => {
					if (cancelled) return;
					const knownByMint = new Map(
						candidates.map((candidate) => [candidate.contract, candidate]),
					);
					const assets = portfolio.tokens.map((token): Candidate => {
						const known = knownByMint.get(token.mint);
						return known
							? {
									...known,
									assetId: token.assetId,
									iconUrl: token.iconUrl ?? known.iconUrl,
									marketPriceUsd:
										token.priceUsd ?? known.marketPriceUsd,
									marketDataSource: token.priceUsd
										? "alchemy"
										: known.marketDataSource,
									marketDataUpdatedAt:
										token.priceUpdatedAt ?? known.marketDataUpdatedAt,
								}
							: {
									chain: "SOLANA",
									assetId: token.assetId,
									symbol: token.symbol,
									name: token.name,
									kind: "CRYPTO",
									contract: token.mint,
									decimals: token.decimals,
									eligible: true,
									marketHealthy: true,
									permissionAllowed: true,
									marketPriceUsd: token.priceUsd,
									marketDataSource: "alchemy",
									marketDataUpdatedAt: token.priceUpdatedAt,
									iconUrl: token.iconUrl,
									primaryClassification: "UNKNOWN",
									classificationConfidence: "LOW",
									tags: [],
									riskFlags: [],
									classificationEvidence: ["Alchemy wallet portfolio"],
									crowdScoreBps: 0,
									reason: "Detected in the connected wallet by Alchemy.",
									evidenceIds: ["alchemy-portfolio"],
								};
					});
					setIndexedPortfolio(assets);
					setBalances(
						Object.fromEntries(
							portfolio.tokens.map((token) => [
								token.assetId,
								token.balanceBaseUnits,
							]),
						),
					);
				})
				.catch((caught) => {
					if (!cancelled) {
						setError(
							caught instanceof Error
								? caught.message
								: "Could not read Solana balances.",
						);
					}
				})
				.finally(() => {
					if (!cancelled) setPortfolioLoading(false);
				});
			return () => {
				cancelled = true;
			};
		}
		api
			.robinhoodPortfolio(wallet)
			.then((portfolio) => {
				if (cancelled) return;
				const knownByContract = new Map(
					candidates.map((candidate) => [
						candidate.contract.toLowerCase(),
						candidate,
					]),
				);
				const assets = portfolio.tokens.map((token): Candidate => {
					const known = knownByContract.get(token.contract.toLowerCase());
					return {
						...(known ?? {
							chain: "ROBINHOOD",
							eligible: true,
							marketHealthy: true,
							permissionAllowed: true,
							primaryClassification:
								token.kind === "STOCK_TOKEN" ? "TOKENIZED_STOCK" : "CRYPTO",
							classificationConfidence: "HIGH",
							tags: [token.kind === "STOCK_TOKEN" ? "stock" : "crypto"],
							riskFlags: [],
							classificationEvidence: ["Alchemy wallet portfolio"],
							crowdScoreBps: 0,
							reason: "Detected in the connected wallet by Alchemy.",
							evidenceIds: ["alchemy-portfolio"],
						}),
						assetId: token.assetId,
						symbol: token.symbol,
						name: token.name,
						kind: token.kind,
						contract: token.contract,
						decimals: token.decimals,
						coingeckoId: token.coingeckoId ?? known?.coingeckoId,
						iconUrl: token.iconUrl ?? known?.iconUrl,
						marketPriceUsd: token.priceUsd ?? known?.marketPriceUsd,
						marketDataSource: token.marketDataSource ?? known?.marketDataSource,
						marketDataUpdatedAt:
							token.priceUpdatedAt ?? known?.marketDataUpdatedAt,
					};
				});
				setIndexedPortfolio(assets);
				setBalances(
					Object.fromEntries(
						portfolio.tokens.map((token) => [
							token.assetId,
							token.balanceBaseUnits,
						]),
					),
				);
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(
						caught instanceof Error
							? caught.message
							: "Could not read Robinhood balances.",
					);
				}
			})
			.finally(() => {
				if (!cancelled) setPortfolioLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [activeChain, candidates, demoMode, wallet]);

	const positionCandidates = indexedPortfolio;
	const portfolioValueUsd = positionCandidates.reduce(
		(total, candidate) =>
			total +
			(Number(balances[candidate.assetId] ?? "0") / 10 ** candidate.decimals) *
				Number(candidate.marketPriceUsd ?? candidate.quote?.unitPriceUsd ?? 0),
		0,
	);
	const holdings = positionCandidates.filter(
		(candidate) => BigInt(balances[candidate.assetId] ?? "0") > 0n,
	);

	async function prepare(candidate: Candidate) {
		const amount = balances[candidate.assetId] ?? "0";
		if (BigInt(amount) <= 0n) return;
		setError("");
		setStatus((current) => ({
			...current,
			[candidate.assetId]: "Preparing fresh quote…",
		}));
		try {
			const result = await api.prepareExit(candidate.assetId, amount);
			setPrepared((current) => ({ ...current, [candidate.assetId]: result }));
			setStatus((current) => ({
				...current,
				[candidate.assetId]: "Ready for wallet confirmation",
			}));
		} catch (caught) {
			setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
			setError(
				caught instanceof Error ? caught.message : "Could not prepare exit.",
			);
		}
	}

	async function confirm(candidate: Candidate) {
		const exit = prepared[candidate.assetId];
		if (
			!exit ||
			(activeChain === "SOLANA"
				? !exit.solanaTransaction || !solanaWallet
				: !exit.walletCalls?.length)
		)
			return;
		setError("");
		setStatus((current) => ({
			...current,
			[candidate.assetId]: "Settling transaction…",
		}));
		try {
			if (activeChain === "SOLANA" && exit.solanaTransaction && solanaWallet) {
				const { signedTransaction } = await signTransaction({
					transaction: base64ToBytes(
						exit.solanaTransaction.unsignedTransactionBase64,
					),
					wallet: solanaWallet,
					chain: "solana:mainnet",
					options: {
						uiOptions: {
							description: `Exit ${candidate.symbol} to USDC through Jupiter.`,
							buttonText: `Sign ${candidate.symbol} exit`,
						},
					},
				});
				await api.submitSolanaExit(
					candidate.assetId,
					bytesToBase64(signedTransaction),
				);
				let settled = false;
				for (let attempt = 0; attempt < 40; attempt += 1) {
					const result = await api.solanaExitStatus(candidate.assetId);
					if (result.status === "SETTLED") {
						settled = true;
						break;
					}
					if (result.status === "FAILED")
						throw new Error("Solana exit failed.");
					await new Promise((resolve) =>
						window.setTimeout(resolve, attempt < 12 ? 500 : 1_500),
					);
				}
				if (!settled) throw new Error("Solana exit is still pending.");
				setStatus((current) => ({
					...current,
					[candidate.assetId]: "Exit settled",
				}));
				setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
				return;
			}
			if (!exit.walletCalls) return;
			const client =
				smartWalletClient ?? (await getClientForChain({ id: 4663 }));
			if (!client || client.account.address.toLowerCase() !== wallet.toLowerCase()) {
				throw new Error("The active Privy smart wallet does not match this account.");
			}
			const calls = exit.walletCalls.map(smartWalletCall);
			await client.prepareUserOperation({ calls });
			await client.sendTransaction(
				{ calls },
				{
					uiOptions: {
						description: `Sell ${candidate.symbol} to USDG on Robinhood Chain.`,
						buttonText: `Confirm ${candidate.symbol} sale`,
						showWalletUIs: false,
					},
				},
			);
			setStatus((current) => ({
				...current,
				[candidate.assetId]: "Exit settled",
			}));
			setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Exit confirmation failed.",
			);
			setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
		}
	}

	async function exitAll() {
		if (activeChain === "SOLANA" || !holdings.length || isExitingAll)
			return;

		setError("");
		setIsExitingAll(true);
		try {
			const client =
				smartWalletClient ?? (await getClientForChain({ id: 4663 }));
			if (!client || client.account.address.toLowerCase() !== wallet.toLowerCase()) {
				throw new Error("The active Privy smart wallet does not match this account.");
			}
			setStatus((current) => ({
				...current,
				...Object.fromEntries(
					holdings.map((candidate) => [
						candidate.assetId,
						"Preparing fresh quote…",
					]),
				),
			}));
			const attempts = await Promise.allSettled(
				holdings.map(async (candidate) => {
					const amount = balances[candidate.assetId] ?? "0";
					const preparation = await api.prepareExit(candidate.assetId, amount);
					if (!preparation.walletCalls?.length) {
						throw new Error("No executable exit calls.");
					}
					return { candidate, preparation };
				}),
			);
			const exits = attempts.flatMap((attempt) =>
				attempt.status === "fulfilled" ? [attempt.value] : [],
			);
			const skipped = holdings.filter(
				(_, index) => attempts[index]?.status === "rejected",
			);
			if (!exits.length) {
				throw new Error("No Robinhood holdings have an executable exit route right now.");
			}
			setPrepared((current) => ({
				...current,
				...Object.fromEntries(
					exits.map(({ candidate, preparation }) => [
						candidate.assetId,
						preparation,
					]),
				),
			}));
			const calls = exits.flatMap(({ preparation }) =>
				(preparation.walletCalls ?? []).map(smartWalletCall),
			);
			setStatus((current) => ({
				...current,
				...Object.fromEntries(
					exits.map(({ candidate }) => [
						candidate.assetId,
						"Settling transaction…",
					]),
				),
				...Object.fromEntries(
					skipped.map((candidate) => [
						candidate.assetId,
						"No executable route",
					]),
				),
			}));
			await client.prepareUserOperation({ calls });
			await client.sendTransaction(
				{ calls },
				{
					uiOptions: {
						description: `Sell ${exits.length} available holdings to USDG on Robinhood Chain. All submitted exits succeed or none.`,
						buttonText: `Confirm ${exits.length} exits`,
						showWalletUIs: false,
					},
				},
			);
			setStatus((current) => ({
				...current,
				...Object.fromEntries(
					exits.map(({ candidate }) => [candidate.assetId, "Exit settled"]),
				),
			}));
			setBalances((current) => ({
				...current,
				...Object.fromEntries(
					exits.map(({ candidate }) => [candidate.assetId, "0"]),
				),
			}));
		} catch (caught) {
			setPrepared((current) =>
				Object.fromEntries(
					Object.entries(current).filter(
						([assetId]) =>
							!holdings.some((candidate) => candidate.assetId === assetId),
					),
				),
			);
			setStatus((current) => ({
				...current,
				...Object.fromEntries(
					holdings.map((candidate) => [candidate.assetId, ""]),
				),
			}));
			setError(
				caught instanceof Error
					? caught.message
					: "Could not exit all holdings.",
			);
		} finally {
			setIsExitingAll(false);
		}
	}

	return (
		<main className="positions-page">
			<header className="positions-heading">
				<div>
					<h1>Portfolio</h1>
					<p>
						{activeChain === "SOLANA"
							? "Live wallet balances from Alchemy. USD prices are shown when available."
							: "Live Alchemy balances with Robinhood market prices when available."}
					</p>
				</div>
			</header>
			<section className="portfolio-summary">
				<div className="portfolio-summary-meta">
					<span>Portfolio value</span>
					<div className="portfolio-summary-value-row">
						<strong>{usdFormatter.format(portfolioValueUsd)}</strong>
						{!demoMode && (
							<button
								type="button"
								className="button button-primary exit-all-button"
								disabled={
									activeChain === "SOLANA" ||
									!holdings.length ||
									isExitingAll
								}
								onClick={() => setExitAllOpen(true)}
							>
								{isExitingAll
									? "Exiting…"
									: activeChain === "SOLANA"
										? "Exit individually"
										: "Exit all positions"}
								{!isExitingAll && activeChain !== "SOLANA" && (
									<LogOut aria-hidden="true" />
								)}
							</button>
						)}
					</div>
				</div>
			</section>
			<Dialog.Root open={exitAllOpen} onOpenChange={setExitAllOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="send-dialog-overlay" />
					<Dialog.Content className="send-dialog-content exit-all-dialog">
						<div className="send-dialog-header">
							<div>
								<Dialog.Title>Exit all holdings?</Dialog.Title>
								<Dialog.Description>
									All available exits will be submitted as one atomic
									smart-wallet transaction.
								</Dialog.Description>
							</div>
							<Dialog.Close asChild>
								<button
									type="button"
									className="send-dialog-close"
									aria-label="Close exit confirmation"
								>
									<X aria-hidden="true" />
								</button>
							</Dialog.Close>
						</div>
						<div className="send-dialog-actions">
							<Dialog.Close asChild>
								<button type="button" className="button button-outline">
									Cancel
								</button>
							</Dialog.Close>
							<button
								type="button"
								className="button button-primary"
								onClick={() => {
									setExitAllOpen(false);
									void exitAll();
								}}
							>
								Confirm exit all <LogOut aria-hidden="true" />
							</button>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
			{demoMode ? (
				<div className="positions-empty">
					Demo mode does not invent wallet balances or settlement. Start live
					mode with a funded wallet to prepare an exit.
				</div>
			) : portfolioLoading ? (
				<div
					className="positions-empty positions-loading"
					role="status"
					aria-live="polite"
				>
					<LoaderCircle aria-hidden="true" />
					Loading wallet holdings…
				</div>
			) : (
				<section className="positions-list">
					{positionCandidates.map((candidate) => {
						const rawBalance = balances[candidate.assetId] ?? "0";
						const exit = prepared[candidate.assetId];
						const actionStatus = status[candidate.assetId] ?? "";
						const settled = actionStatus === "Exit settled";
						const quoteLoading = actionStatus === "Preparing fresh quote…";
						const transactionSettling =
							actionStatus === "Settling transaction…";
						const actionBusy = quoteLoading || transactionSettling;
						const actionLabel = settled
							? `${candidate.symbol} exit settled`
							: quoteLoading
								? `Preparing ${candidate.symbol} quote`
								: transactionSettling
									? `Settling ${candidate.symbol} transaction`
									: exit
										? `Confirm ${candidate.symbol} sale`
										: `Sell ${candidate.symbol}`;
						const balance = formatPositionBalance(
							BigInt(rawBalance),
							candidate.decimals,
						);
						const rawUnitPrice =
							candidate.marketPriceUsd ?? candidate.quote?.unitPriceUsd;
							const holdingValue = rawUnitPrice !== undefined
								? usdFormatter.format(
										(Number(rawBalance) / 10 ** candidate.decimals) *
											Number(rawUnitPrice),
									)
								: "Price unavailable";
							const unitPrice = rawUnitPrice !== undefined
								? usdFormatter.format(Number(rawUnitPrice))
								: "Price unavailable";
						return (
							<article className="position-row" key={candidate.assetId}>
								<AssetMark
									symbol={candidate.symbol}
									iconUrl={candidate.iconUrl}
									size="sm"
								/>
								<div className="position-copy">
									<div className="position-primary">
										<b>{candidate.name}</b>
										<b>{holdingValue}</b>
									</div>
									<div className="position-secondary">
										<small>{unitPrice}</small>
										<small>
											{balance} {candidate.symbol}
										</small>
									</div>
								</div>
								<button
									type="button"
									className="button button-sell"
									aria-label={actionLabel}
									title={actionLabel}
									disabled={BigInt(rawBalance) <= 0n || settled || actionBusy}
									onClick={() =>
										exit ? confirm(candidate) : prepare(candidate)
									}
								>
									{settled ? (
										<Check aria-hidden="true" />
									) : actionBusy ? (
										<LoaderCircle
											className="button-spinner"
											aria-hidden="true"
										/>
									) : exit ? (
										<FilePen aria-hidden="true" />
									) : (
										<HandCoins aria-hidden="true" />
									)}
								</button>
								{exit && !settled && (
									<small className="position-status">
										{formatUnits(BigInt(exit.quote.minimumAmountOut), 6)}{" "}
										{activeChain === "SOLANA" ? "USDC" : "USDG"}{" "}
										minimum · quote is active for 60 seconds
									</small>
								)}
								{status[candidate.assetId] &&
									status[candidate.assetId] !==
										"Ready for wallet confirmation" && (
										<small className="position-status">
											{status[candidate.assetId]}
										</small>
									)}
							</article>
						);
					})}
				</section>
			)}
			{error && (
				<p className="error-message" role="alert">
					{error}
				</p>
			)}
		</main>
	);
}

function formatPositionBalance(value: bigint, decimals: number) {
	const formatted = formatUnits(value, decimals);
	const [whole, fraction = ""] = formatted.split(".");
	const firstNonZero = fraction.search(/[1-9]/);
	const visibleDecimals =
		value > 0n && whole === "0" && firstNonZero >= 4
			? Math.min(fraction.length, firstNonZero + 2)
			: 4;
	const compactFraction = fraction
		.slice(0, visibleDecimals)
		.replace(/0+$/, "");
	return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function smartWalletCall(call: WalletCall): {
	to: Address;
	data: Hex;
	value: bigint;
} {
	const { transaction } = call;
	return {
		to: transaction.to as Address,
		data: transaction.data as Hex,
		value: BigInt(transaction.value),
	};
}

function base64ToBytes(value: string) {
	const binary = window.atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array) {
	let binary = "";
	for (const byte of value) binary += String.fromCharCode(byte);
	return window.btoa(binary);
}
