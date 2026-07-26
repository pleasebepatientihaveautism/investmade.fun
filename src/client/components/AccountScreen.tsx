import { formatUnits } from "viem";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { OnboardingPreferences } from "../../domain/schemas";
import { formatTicketSizeUsd, isTicketSizeUsd } from "../../domain/schemas";
import { api } from "../api";

const CADENCE_OPTIONS = ["daily", "weekly", "monthly"] as const;
const RISK_OPTIONS = ["conservative", "balanced", "degen"] as const;

export function AccountScreen({
	wallet,
	fundingWallet,
	smartWalletReady,
	preferences,
	developerMode,
	devCardLimit,
	maxDevCards,
	onDevCardLimitChange,
	onResetDemoWeek,
	onSave,
}: {
	wallet: string;
	fundingWallet: string;
	smartWalletReady: boolean;
	preferences: OnboardingPreferences;
	developerMode: boolean;
	devCardLimit: number;
	maxDevCards: number;
	onDevCardLimitChange: (limit: number) => void;
	onResetDemoWeek: () => Promise<void>;
	onSave: (preferences: OnboardingPreferences) => Promise<void>;
}) {
	const [draft, setDraft] = useState(preferences);
	const [balance, setBalance] = useState<string>();
	const [balanceError, setBalanceError] = useState("");
	const [saveError, setSaveError] = useState("");
	const [saving, setSaving] = useState(false);
	const [addressCopied, setAddressCopied] = useState<"smart" | "funding">();

	useEffect(() => setDraft(preferences), [preferences]);

	useEffect(() => {
		if (!wallet) return;
		let cancelled = false;
		setBalance(undefined);
		setBalanceError("");
		api
			.usdgBalance(wallet)
			.then(({ balanceBaseUnits, decimals }) => {
				if (!cancelled)
					setBalance(formatUnits(BigInt(balanceBaseUnits), decimals));
			})
			.catch((caught) => {
				if (!cancelled)
					setBalanceError(
						caught instanceof Error
							? caught.message
							: "Could not read USDG balance.",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [wallet]);

	async function save() {
		setSaveError("");
		setSaving(true);
		try {
			const next = { ...draft, riskDisclosureAccepted: true as const };
			await onSave(next);
		} catch (caught) {
			setSaveError(
				caught instanceof Error ? caught.message : "Could not save settings.",
			);
		} finally {
			setSaving(false);
		}
	}

	async function copyAddress(address: string, type: "smart" | "funding") {
		if (!address) return;
		try {
			await navigator.clipboard.writeText(address);
		} catch {
			const textarea = document.createElement("textarea");
			textarea.value = address;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.append(textarea);
			textarea.select();
			document.execCommand("copy");
			textarea.remove();
		}
		setAddressCopied(type);
		window.setTimeout(() => setAddressCopied(undefined), 1_800);
	}

	return (
		<main className="account-page">
			<header className="account-heading">
				<span>Account</span>
				<h1>Your wallet, your plan.</h1>
				<p>
					Change the preferences that shape your next investment session.
					Nothing trades until you review and sign.
				</p>
			</header>

			<section
				className="account-balance"
				aria-label="Investmade Wallet USDG balance"
			>
				<div>
					<span className="account-label">
						Investmade Wallet · USDG balance
					</span>
					<strong>
						{balance === undefined
							? balanceError
								? "—"
								: "Loading…"
							: `${balance} USDG`}
					</strong>
					<small>
						{balanceError ||
							"This smart wallet funds and atomically executes every basket."}
					</small>
				</div>
				<div className="account-address">
					<code>{wallet ? shortAddress(wallet) : "Wallet not activated"}</code>
					{wallet ? (
						<button
							type="button"
							className="copy-address"
							aria-label={
								addressCopied === "smart"
									? "Address copied"
									: "Copy Investmade Wallet address"
							}
							title={addressCopied === "smart" ? "Copied" : "Copy address"}
							onClick={() => void copyAddress(wallet, "smart")}
						>
							{addressCopied === "smart" ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
						</button>
					) : null}
				</div>
			</section>

			<section className="wallet-identity-grid" aria-label="Wallet roles">
				<article>
					<div className="wallet-role-heading">
						<span className="account-label">Execution wallet</span>
						<span
							className={smartWalletReady ? "wallet-ready" : "wallet-pending"}
						>
							{smartWalletReady ? "Ready" : "Activation required"}
						</span>
					</div>
					<h2>Investmade Wallet</h2>
					<div className="wallet-role-address">
						<code>{wallet ? shortAddress(wallet) : "Not available"}</code>
						{wallet ? (
							<button
								type="button"
								className="copy-address copy-address-compact"
								aria-label={
									addressCopied === "smart"
										? "Address copied"
										: "Copy Investmade Wallet address"
								}
								title={addressCopied === "smart" ? "Copied" : "Copy address"}
								onClick={() => void copyAddress(wallet, "smart")}
							>
								{addressCopied === "smart" ? (
									<Check aria-hidden="true" />
								) : (
									<Copy aria-hidden="true" />
								)}
							</button>
						) : null}
					</div>
					<p>
						Receives USDG, holds assets, and sends the complete basket as one
						ERC-4337 operation.
					</p>
				</article>
				<article>
					<div className="wallet-role-heading">
						<span className="account-label">Connected signer</span>
						<span className={fundingWallet ? "wallet-ready" : "wallet-pending"}>
							{fundingWallet ? "Connected" : "Optional"}
						</span>
					</div>
					<h2>Funding wallet</h2>
					<div className="wallet-role-address">
						<code>
							{fundingWallet
								? shortAddress(fundingWallet)
								: "Use Privy login only"}
						</code>
						{fundingWallet ? (
							<button
								type="button"
								className="copy-address copy-address-compact"
								aria-label={
									addressCopied === "funding"
										? "Address copied"
										: "Copy funding wallet address"
								}
								title={addressCopied === "funding" ? "Copied" : "Copy address"}
								onClick={() => void copyAddress(fundingWallet, "funding")}
							>
								{addressCopied === "funding" ? (
									<Check aria-hidden="true" />
								) : (
									<Copy aria-hidden="true" />
								)}
							</button>
						) : null}
					</div>
					<p>
						Your Rainbow or other external wallet can fund the Investmade
						Wallet. It does not execute basket legs directly.
					</p>
				</article>
			</section>

			<section className="account-settings" aria-labelledby="settings-title">
				<div className="settings-intro">
					<div>
						<span className="account-label">Investment settings</span>
						<h2 id="settings-title">Your next session</h2>
					</div>
					<span className="settings-limit">100 USDG period limit</span>
				</div>

				<div className="settings-field">
					<span>How often can you use Investmade?</span>
					<SelectMenu
						ariaLabel="How often can you use Investmade? A new session is available once per selected period."
						value={draft.cadence}
						options={CADENCE_OPTIONS.map((cadence) => ({
							value: cadence,
							label: `Every ${cadence === "daily" ? "day" : cadence === "weekly" ? "week" : "month"}`,
						}))}
						onChange={(cadence) =>
							setDraft((current) => ({
								...current,
								cadence: cadence as OnboardingPreferences["cadence"],
							}))
						}
					/>
					<small>A new session is available once per selected period.</small>
				</div>

				<label className="settings-field">
					<span>Ticket size per accepted card</span>
					<div className="ticket-input">
						<b>$</b>
						<input
							type="number"
							min="0.1"
							max="100"
							step="0.01"
							inputMode="decimal"
							value={formatTicketSizeUsd(draft.ticketSizeUsd)}
							onChange={(event) =>
								setDraft((current) => ({
									...current,
									ticketSizeUsd: clampTicket(event.target.value),
								}))
							}
						/>
					</div>
					<small>USDG amount from $0.10 to $100.00, in $0.01 increments.</small>
				</label>

				<fieldset className="settings-field">
					<legend>Risk preference</legend>
					<div className="settings-options">
						{RISK_OPTIONS.map((risk) => (
							<label
								key={risk}
								className={draft.riskMode === risk ? "selected" : ""}
							>
								<input
									type="radio"
									name="risk"
									checked={draft.riskMode === risk}
									onChange={() =>
										setDraft((current) => ({ ...current, riskMode: risk }))
									}
								/>
								<b>{risk}</b>
							</label>
						))}
					</div>
				</fieldset>

				<fieldset className="settings-field">
					<legend>Assets to include</legend>
					<div className="settings-options">
						{(["CRYPTO", "STOCK_TOKEN"] as const).map((assetClass) => {
							const selected = draft.assetClasses.includes(assetClass);
							return (
								<label key={assetClass} className={selected ? "selected" : ""}>
									<input
										type="checkbox"
										checked={selected}
										onChange={() =>
											setDraft((current) => ({
												...current,
												assetClasses: selected
													? current.assetClasses.filter(
															(item) => item !== assetClass,
														)
													: [...current.assetClasses, assetClass],
											}))
										}
									/>
									<b>
										{assetClass === "CRYPTO" ? "Crypto" : "Tokenized stocks"}
									</b>
								</label>
							);
						})}
					</div>
					{!draft.assetClasses.length ? (
						<small className="settings-error">
							Choose at least one asset type.
						</small>
					) : null}
				</fieldset>

				<div className="settings-actions">
					{saveError ? <p role="alert">{saveError}</p> : null}
					<button
						type="button"
						className="button button-primary"
						disabled={saving || !draft.assetClasses.length}
						onClick={save}
					>
						{saving ? "Saving…" : "Save and refresh my feed"}
					</button>
				</div>
			</section>

			{developerMode ? (
				<section
					className="account-settings"
					aria-labelledby="developer-settings-title"
				>
					<div className="settings-intro">
						<div>
							<span className="account-label">Local developer controls</span>
							<h2 id="developer-settings-title">Test another basket</h2>
						</div>
						<span className="settings-limit">Local only</span>
					</div>
					<div className="settings-field">
						<span>Cards to show in this basket</span>
						<SelectMenu
							ariaLabel="Cards to show in this basket. Only live, eligible, quoteable cards are shown."
							value={String(devCardLimit)}
							options={Array.from(
								{ length: maxDevCards },
								(_, index) => index + 1,
							).map((limit) => ({
								value: String(limit),
								label: `${limit} ${limit === 1 ? "card" : "cards"}`,
							}))}
							onChange={(limit) => onDevCardLimitChange(Number(limit))}
						/>
						<small>
							Only live, eligible, quoteable cards are shown. The production
							limit is unchanged.
						</small>
					</div>
					<div className="settings-actions">
						<button
							type="button"
							className="button button-outline"
							onClick={() => void onResetDemoWeek()}
						>
							Reset local week limit and build a new basket
						</button>
					</div>
				</section>
			) : null}
		</main>
	);
}

function SelectMenu({
	ariaLabel,
	value,
	options,
	onChange,
}: {
	ariaLabel: string;
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const selected =
		options.find((option) => option.value === value) ?? options[0];

	return (
		<div className="select-menu">
			<button
				type="button"
				className="select-trigger"
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => setOpen((current) => !current)}
				onKeyDown={(event) => {
					if (event.key === "Escape") setOpen(false);
				}}
			>
				<span>{selected?.label ?? "Select an option"}</span>
				<svg viewBox="0 0 16 10" aria-hidden="true">
					<path d="m1 1 7 7 7-7" />
				</svg>
			</button>
			{open ? (
				<div className="select-options" role="listbox" aria-label={ariaLabel}>
					{options.map((option) => {
						const active = option.value === value;
						return (
							<button
								type="button"
								role="option"
								aria-selected={active}
								className={active ? "selected" : ""}
								key={option.value}
								onClick={() => {
									onChange(option.value);
									setOpen(false);
								}}
							>
								{option.label}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function clampTicket(value: string) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 0.1;
	const rounded = Math.round(parsed * 100) / 100;
	return isTicketSizeUsd(rounded)
		? rounded
		: Math.max(0.1, Math.min(100, rounded));
}

function shortAddress(address: string) {
	return `${address.slice(0, 10)}…${address.slice(-8)}`;
}
