import { type EIP1193Provider, useWallets } from "@privy-io/react-auth";
import {
	useSignTransaction,
	type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { useEffect, useState } from "react";
import { encodeFunctionData, formatUnits } from "viem";
import type { Candidate } from "../../domain/schemas";
import { api, type ExitPreparation, type WalletCall } from "../api";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check } from "./Icons";

const balanceOfAbi = [
	{
		type: "function",
		name: "balanceOf",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "", type: "uint256" }],
	},
] as const;

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
	const { wallets } = useWallets();
	const { signTransaction } = useSignTransaction();
	const activeWallet = wallets.find((candidate) => candidate.linked);
	const [balances, setBalances] = useState<Record<string, string>>({});
	const [solanaPortfolio, setSolanaPortfolio] = useState<Candidate[]>([]);
	const [portfolioLoading, setPortfolioLoading] = useState(false);
	const [prepared, setPrepared] = useState<Record<string, ExitPreparation>>({});
	const [status, setStatus] = useState<Record<string, string>>({});
	const [isExitingAll, setIsExitingAll] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (demoMode || !wallet) return;
		let cancelled = false;
		if (activeChain === "SOLANA") {
			setPortfolioLoading(true);
			setError("");
			api.solanaPortfolio(wallet)
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
					setSolanaPortfolio(assets);
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
		setPortfolioLoading(false);
		setSolanaPortfolio([]);
		if (!activeWallet) return;
		activeWallet
			.getEthereumProvider()
			.then((provider) =>
				Promise.all(
					candidates.map(async (candidate) => {
						const data = encodeFunctionData({
							abi: balanceOfAbi,
							functionName: "balanceOf",
							args: [wallet as `0x${string}`],
						});
						const value = (await provider.request({
							method: "eth_call",
							params: [{ to: candidate.contract, data }, "latest"],
						})) as string;
						return [candidate.assetId, BigInt(value).toString()] as const;
					}),
				),
			)
			.then((entries) => {
				if (!cancelled) setBalances(Object.fromEntries(entries));
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(
						caught instanceof Error
							? caught.message
							: "Could not read wallet balances.",
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeChain, activeWallet, candidates, demoMode, wallet]);

	const positionCandidates =
		activeChain === "SOLANA" ? solanaPortfolio : candidates;
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
				: !exit.walletCalls?.length || !activeWallet)
		)
			return;
		setError("");
		setStatus((current) => ({
			...current,
			[candidate.assetId]: "Confirm in wallet…",
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
			if (!activeWallet || !exit.walletCalls) return;
			await activeWallet.switchChain(4663);
			const provider = await activeWallet.getEthereumProvider();
			for (const call of exit.walletCalls) {
				const hash = (await provider.request({
					method: "eth_sendTransaction",
					params: [walletTransaction(call)],
				})) as string;
				const receipt = (await waitForReceipt(provider, hash)) as {
					status?: string;
				};
				if (receipt.status !== "0x1")
					throw new Error("Exit transaction reverted.");
			}
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
		if (
			activeChain === "SOLANA" ||
			!activeWallet ||
			!holdings.length ||
			isExitingAll
		)
			return;
		const accepted = window.confirm(
			`Exit all ${holdings.length} holdings? Your wallet will ask you to approve and sign each required transaction.`,
		);
		if (!accepted) return;

		setError("");
		setIsExitingAll(true);
		try {
			await activeWallet.switchChain(4663);
			const provider = await activeWallet.getEthereumProvider();
			for (const candidate of holdings) {
				const amount = balances[candidate.assetId] ?? "0";
				setStatus((current) => ({
					...current,
					[candidate.assetId]: "Preparing fresh quote…",
				}));
				const exit = await api.prepareExit(candidate.assetId, amount);
				if (!exit.walletCalls?.length) {
					throw new Error(
						`${candidate.symbol} returned no executable exit calls.`,
					);
				}
				setPrepared((current) => ({ ...current, [candidate.assetId]: exit }));
				setStatus((current) => ({
					...current,
					[candidate.assetId]: "Confirm in wallet…",
				}));
				for (const call of exit.walletCalls ?? []) {
					const hash = (await provider.request({
						method: "eth_sendTransaction",
						params: [walletTransaction(call)],
					})) as string;
					const receipt = (await waitForReceipt(provider, hash)) as {
						status?: string;
					};
					if (receipt.status !== "0x1")
						throw new Error(`${candidate.symbol} exit reverted.`);
				}
				setStatus((current) => ({
					...current,
					[candidate.assetId]: "Exit settled",
				}));
				setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
			}
		} catch (caught) {
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
							: "Wallet value using current CoinGecko market prices."}
					</p>
				</div>
				{!demoMode && (
					<button
						type="button"
						className="button button-primary exit-all-button"
						disabled={
							activeChain === "SOLANA" ||
							!holdings.length ||
							isExitingAll
						}
						onClick={exitAll}
					>
						{isExitingAll
							? "Exiting…"
							: activeChain === "SOLANA"
								? "Exit individually"
								: "Exit all"}
					</button>
				)}
			</header>
			<section className="portfolio-summary">
				<div className="portfolio-summary-meta">
					<span>Portfolio value</span>
					<strong>{usdFormatter.format(portfolioValueUsd)}</strong>
				</div>
			</section>
			<p className="positions-intro">
				Exit supported assets with a fresh reverse quote from your selected
				provider. Exits stay available outside your buy session.
			</p>
			{demoMode ? (
				<div className="positions-empty">
					Demo mode does not invent wallet balances or settlement. Start live
					mode with a funded wallet to prepare an exit.
				</div>
			) : portfolioLoading ? (
				<div className="positions-empty">Loading wallet holdings…</div>
			) : (
				<section className="positions-list">
					{positionCandidates.map((candidate) => {
						const rawBalance = balances[candidate.assetId] ?? "0";
						const exit = prepared[candidate.assetId];
						const settled = status[candidate.assetId] === "Exit settled";
						const balance = formatPositionBalance(
							BigInt(rawBalance),
							candidate.decimals,
						);
						const rawUnitPrice =
							candidate.marketPriceUsd ?? candidate.quote?.unitPriceUsd;
						const unitPrice = rawUnitPrice
							? `${usdFormatter.format(Number(rawUnitPrice))} each`
							: "Price unavailable";
						return (
							<article className="position-row" key={candidate.assetId}>
								<AssetMark
									symbol={candidate.symbol}
									iconUrl={candidate.iconUrl}
									size="sm"
								/>
								<div className="position-identity">
									<b>{candidate.symbol}</b>
									<small>{candidate.name}</small>
								</div>
								<div className="position-metrics">
									<b>
										{balance} {candidate.symbol}
									</b>
									<small>{unitPrice}</small>
								</div>
								<button
									type="button"
									className="button button-sell"
									disabled={BigInt(rawBalance) <= 0n || settled}
									onClick={() =>
										exit ? confirm(candidate) : prepare(candidate)
									}
								>
									{settled ? (
										<>
											<Check /> Settled
										</>
									) : exit ? (
										<>
											Confirm sell <ArrowRight />
										</>
									) : (
										"Get exit quote"
									)}
								</button>
								{exit && !settled && (
									<small className="position-status">
										{formatUnits(BigInt(exit.quote.minimumAmountOut), 6)}{" "}
										{activeChain === "SOLANA" ? "USDC" : "USDG"}
										minimum · fresh for 60 seconds
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

function walletTransaction(call: WalletCall) {
	const { transaction } = call;
	const hasEip1559Fees = Boolean(
		transaction.maxFeePerGas && transaction.maxPriorityFeePerGas,
	);
	return {
		from: transaction.from,
		to: transaction.to,
		data: transaction.data,
		value: toHex(transaction.value),
		...(hasEip1559Fees && transaction.maxFeePerGas
			? { maxFeePerGas: toHex(transaction.maxFeePerGas) }
			: {}),
		...(hasEip1559Fees && transaction.maxPriorityFeePerGas
			? { maxPriorityFeePerGas: toHex(transaction.maxPriorityFeePerGas) }
			: {}),
		...(!hasEip1559Fees && transaction.gasPrice
			? { gasPrice: toHex(transaction.gasPrice) }
			: {}),
	};
}

function toHex(value: string) {
	return `0x${BigInt(value).toString(16)}`;
}

async function waitForReceipt(provider: EIP1193Provider, hash: string) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const receipt = await provider.request({
			method: "eth_getTransactionReceipt",
			params: [hash],
		});
		if (receipt) return receipt;
		await new Promise((resolve) => setTimeout(resolve, 1_500));
	}
	throw new Error(
		"Exit transaction is still pending. Check your wallet before retrying.",
	);
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
