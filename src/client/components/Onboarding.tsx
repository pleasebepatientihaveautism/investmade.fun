import { useEffect, useRef, useState } from "react";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { IDKit, orbLegacy } from "@worldcoin/idkit-core";
import {
	isTicketSizeUsd,
	type OnboardingPreferences,
} from "../../domain/schemas";
import type { PublicConfig } from "../api";
import { api } from "../api";
import {
	readAccountPreferences,
	removeAccountPreferences,
	writeAccountPreferences,
} from "../preferences-storage";
import { ArrowRight, Check, Shield } from "./Icons";

type Step =
	| "welcome"
	| "cadence"
	| "ticket"
	| "risk"
	| "assets"
	| "review"
	| "wallet"
	| "world";
type RiskMode = OnboardingPreferences["riskMode"];
type AssetChoice = "CRYPTO" | "STOCK_TOKEN" | "BOTH";
type TicketChoice = 2 | 10 | 25 | "custom";

interface PreferenceDraft {
	cadence?: OnboardingPreferences["cadence"];
	ticketSizeUsd?: number;
	ticketChoice?: TicketChoice;
	customTicketInput: string;
	riskMode?: RiskMode;
	assetChoice?: AssetChoice;
	riskDisclosureAccepted: boolean;
}

const CADENCE_OPTIONS = [
	{
		id: "daily",
		title: "1 day",
		description: "Build a new investment session every day.",
	},
	{
		id: "weekly",
		title: "1 week",
		description: "Build a new investment session every week.",
	},
	{
		id: "monthly",
		title: "1 month",
		description: "Build a new investment session every month.",
	},
] as const;

const TICKET_OPTIONS: Array<{
	id: TicketChoice;
	title: string;
	description: string;
}> = [
	{
		id: 2,
		title: "$2",
		description: "Small test-sized allocation per accepted card.",
	},
	{
		id: 10,
		title: "$10",
		description: "Balanced default allocation per accepted card.",
	},
	{
		id: 25,
		title: "$25",
		description: "Larger allocation with up to four accepted cards.",
	},
	{
		id: "custom",
		title: "Another amount",
		description: "Choose $0.10 to $100.00, including cents.",
	},
];

const RISK_OPTIONS: Array<{
	id: RiskMode;
	title: string;
	description: string;
	tag?: string;
}> = [
	{
		id: "conservative",
		title: "Conservative",
		description:
			"Prefer steadier signals and lower-impact routes. Value can still fall.",
	},
	{
		id: "balanced",
		title: "Balanced",
		description: "Mix opportunity and restraint across eligible markets.",
		tag: "Recommended",
	},
	{
		id: "degen",
		title: "Degen",
		description:
			"Accept more volatility in the ranking. This is not a promise of higher returns.",
	},
];

const ASSET_OPTIONS: Array<{
	id: AssetChoice;
	title: string;
	description: string;
	tag?: string;
}> = [
	{
		id: "BOTH",
		title: "A mix of both",
		description:
			"Let the private ranking compare eligible crypto and stock tokens.",
		tag: "Recommended",
	},
	{
		id: "CRYPTO",
		title: "Crypto",
		description: "Show eligible crypto assets such as WETH.",
	},
	{
		id: "STOCK_TOKEN",
		title: "Tokenized stocks",
		description:
			"Show eligible stock tokens when jurisdiction and market checks pass.",
	},
];

export function Onboarding({
	config,
	onComplete,
	privyReady,
}: {
	config: PublicConfig;
	onComplete: (preferences: OnboardingPreferences) => void;
	privyReady: boolean;
}) {
	const { authenticated, login, user } = usePrivy();
	const { createWallet } = useCreateWallet();
	const { client: smartWalletClient, getClientForChain } = useSmartWallets();
	const { wallets } = useWallets();
	const embeddedWallet = wallets.find(
		(candidate) =>
			candidate.walletClientType === "privy" ||
			candidate.walletClientType === "privy-v2",
	);
	const requiresWorldVerification = config.executionMode === "live";
	const wallet = (
		user?.smartWallet?.address ??
		smartWalletClient?.account.address ??
		""
	).toLowerCase();
	const [step, setStep] = useState<Step>("welcome");
	const [draft, setDraft] = useState<PreferenceDraft>(emptyDraft);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const completingDemo = useRef(false);
	const pendingPlan = useRef(false);
	const hydratedUserId = useRef<string | undefined>(undefined);
	const completedPreferences = toCompletedPreferences(draft);

	useEffect(() => {
		const userId = authenticated ? user?.id : undefined;
		if (!userId || pendingPlan.current || hydratedUserId.current === userId)
			return;
		hydratedUserId.current = userId;
		const storedPreferences = readAccountPreferences(userId);
		if (!storedPreferences) return;
		setDraft(draftFromPreferences(storedPreferences));
		setStep("wallet");
	}, [authenticated, user?.id]);

	useEffect(() => {
		if (step !== "wallet" || !completedPreferences) return;
		if (!authenticated || !embeddedWallet || !wallet || !smartWalletClient)
			return;
		if (user?.id) writeAccountPreferences(user.id, completedPreferences);
		if (requiresWorldVerification) {
			setStep("world");
			return;
		}
		if (completingDemo.current) return;
		completingDemo.current = true;
		onComplete(completedPreferences);
	}, [
		authenticated,
		completedPreferences,
		embeddedWallet,
		onComplete,
		requiresWorldVerification,
		smartWalletClient,
		user?.id,
		wallet,
		step,
	]);

	async function connect() {
		if (!privyReady) return;
		setBusy(true);
		setError("");
		try {
			if (!authenticated) {
				login();
				return;
			}
			if (!embeddedWallet) {
				await createWallet();
				return;
			}
			const client =
				smartWalletClient ?? (await getClientForChain({ id: 4663 }));
			if (!client?.account.address) throw new Error("SMART_WALLET_NOT_READY");
			if (requiresWorldVerification) setStep("world");
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : "";
			setError(
				/smart wallet|configured|bundler|chain/i.test(message)
					? "Investmade Wallet is not configured for Robinhood Chain yet. Enable chain 4663 in Privy Smart Wallet settings."
					: message || "Privy wallet activation failed.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function verifyHuman() {
		if (!config.world || !wallet || !completedPreferences) return;
		setBusy(true);
		setError("");
		try {
			const rp = await api.worldSignature();
			const request = await IDKit.request({
				app_id: config.world.appId as `app_${string}`,
				action: config.world.action,
				rp_context: {
					rp_id: config.world.rpId as `rp_${string}`,
					nonce: rp.nonce,
					created_at: rp.created_at,
					expires_at: rp.expires_at,
					signature: rp.sig,
				},
				allow_legacy_proofs: true,
				environment: "production",
			}).preset(orbLegacy({ signal: wallet }));
			const proof = await request.pollUntilCompletion();
			await api.verifyWorld(proof);
			onComplete(completedPreferences);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "World verification failed.",
			);
		} finally {
			setBusy(false);
		}
	}

	function savePlan() {
		const preferences = toCompletedPreferences(draft);
		if (!preferences) return;
		pendingPlan.current = true;
		setStep("wallet");
	}

	function changeAnswers() {
		if (authenticated && user?.id) removeAccountPreferences(user.id);
		completingDemo.current = false;
		pendingPlan.current = false;
		hydratedUserId.current = authenticated ? user?.id : undefined;
		setDraft(emptyDraft());
		setStep("welcome");
		requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
	}

	return (
		<main className="onboarding-page">
			<section className="onboarding-copy">
				<span className="eyebrow">Your investment plan</span>
				<h1>Your market swipe, bounded by you.</h1>
				<p>
					Answer five short questions. investmade.fun uses them only to
					constrain and rank executable candidates. Your 100 USDG stays in your
					wallet until you review and sign.
				</p>
				<div className="onboarding-points">
					<p>
						<span>1</span>
						<b>Your pace and ticket</b>
						<small>
							Choose daily, weekly, or monthly, then set the amount for each
							accepted card.
						</small>
					</p>
					<p>
						<span>2</span>
						<b>Private personalization</b>
						<small>
							Your cadence, ticket, risk mode, and asset mix become bounded 0G
							input.
						</small>
					</p>
					<p>
						<span>3</span>
						<b>You approve execution</b>
						<small>
							AI ranks; deterministic policy checks; your wallet signs.
						</small>
					</p>
				</div>
			</section>

			<section className="onboarding-action">
				{isQuestionStep(step) ? (
					<QuestionFlow
						step={step}
						draft={draft}
						onDraft={setDraft}
						onStep={setStep}
						onSave={savePlan}
					/>
				) : (
					<>
						<Shield />
						<span className="onboarding-kicker">
							{step === "wallet" ? "Plan saved" : "Final identity check"}
						</span>
						<h2>
							{step === "wallet"
								? "Activate your Investmade Wallet"
								: "Verify you’re human"}
						</h2>
						<p>
							{step === "wallet"
								? "One smart wallet · one atomic basket · Robinhood Chain"
								: "Bound to your authenticated investmade.fun account"}
						</p>
						{completedPreferences ? (
							<PlanSummary preferences={completedPreferences} compact />
						) : null}
						{error ? (
							<div className="error-message" role="alert">
								{error}
							</div>
						) : null}
						<button
							type="button"
							className="button button-primary"
							onClick={step === "wallet" ? connect : verifyHuman}
							disabled={busy || !privyReady}
						>
							{busy
								? "Waiting…"
								: step === "wallet"
									? authenticated
										? embeddedWallet
											? smartWalletClient
												? "Investmade Wallet ready"
												: "Activate Investmade Wallet"
											: "Create Investmade Wallet"
										: "Continue with Privy"
									: "Open World verification"}{" "}
							<ArrowRight />
						</button>
						<button
							type="button"
							className="onboarding-text-button"
							onClick={changeAnswers}
						>
							Change my answers
						</button>
						<small>
							{config.demoMode
								? "Local demo: Privy is real; trading and settlement are simulated."
								: "No deposit. No trading mandate. No autonomous execution."}
						</small>
					</>
				)}
			</section>
		</main>
	);
}

function QuestionFlow({
	step,
	draft,
	onDraft,
	onStep,
	onSave,
}: {
	step: Extract<
		Step,
		"welcome" | "cadence" | "ticket" | "risk" | "assets" | "review"
	>;
	draft: PreferenceDraft;
	onDraft: React.Dispatch<React.SetStateAction<PreferenceDraft>>;
	onStep: (step: Step) => void;
	onSave: () => void;
}) {
	const questionNumber =
		["cadence", "ticket", "risk", "assets", "review"].indexOf(step) + 1;

	if (step === "welcome") {
		return (
			<>
				<span className="onboarding-kicker">New here?</span>
				<h2>Build your investment guardrails</h2>
				<p>
					Choose how often you invest and the amount for each accepted card. The
					100 USDG period limit stays fixed; unused funds remain in your wallet.
				</p>
				<div className="onboarding-trust-note">
					<Shield />
					<span>
						<b>Non-custodial</b>Your answers never authorize a transaction.
					</span>
				</div>
				<button
					type="button"
					className="button button-primary"
					onClick={() => onStep("cadence")}
				>
					Answer 5 questions <ArrowRight />
				</button>
			</>
		);
	}

	return (
		<>
			<div className="question-progress">
				<span>Question {questionNumber} of 5</span>
				<div aria-hidden="true">
					{[1, 2, 3, 4, 5].map((number) => (
						<i
							className={number <= questionNumber ? "active" : ""}
							key={number}
						/>
					))}
				</div>
			</div>

			{step === "cadence" ? (
				<>
					<span className="onboarding-kicker">Investment frequency</span>
					<h2>How often do you want to invest?</h2>
					<p>
						Each period gets a separate session and a 100 USDG spending limit.
					</p>
					<div className="question-options">
						{CADENCE_OPTIONS.map((option) => (
							<button
								type="button"
								className={
									draft.cadence === option.id
										? "question-option selected"
										: "question-option"
								}
								onClick={() =>
									onDraft((current) => ({ ...current, cadence: option.id }))
								}
								key={option.id}
							>
								<span>
									<b>{option.title}</b>
								</span>
								<small>{option.description}</small>
								{draft.cadence === option.id ? <Check /> : null}
							</button>
						))}
					</div>
					<QuestionActions
						back={() => onStep("welcome")}
						next={() => onStep("ticket")}
						nextDisabled={!draft.cadence}
					/>
				</>
			) : null}

			{step === "ticket" ? (
				<>
					<span className="onboarding-kicker">Ticket size</span>
					<h2>How much per accepted card?</h2>
					<p>
						Choose $2, $10, $25, or enter another amount such as $0.10 or $0.25.
					</p>
					<div className="question-options ticket-options">
						{TICKET_OPTIONS.map((option) => (
							<button
								type="button"
								className={
									draft.ticketChoice === option.id
										? "question-option selected"
										: "question-option"
								}
								onClick={() =>
									onDraft((current) => ({
										...current,
										ticketChoice: option.id,
										ticketSizeUsd:
											typeof option.id === "number"
												? option.id
												: customTicket(current.customTicketInput),
									}))
								}
								key={option.id}
							>
								<span>
									<b>{option.title}</b>
									{option.id === 10 ? <em>Recommended</em> : null}
								</span>
								<small>{option.description}</small>
								{draft.ticketChoice === option.id ? <Check /> : null}
							</button>
						))}
					</div>
					{draft.ticketChoice === "custom" ? (
						<label className="custom-ticket">
							<span>Custom ticket size</span>
							<span>
								<b>$</b>
								<input
									type="number"
									min="0.1"
									max="100"
									step="0.01"
									inputMode="decimal"
									value={draft.customTicketInput}
									onChange={(event) => {
										const value = event.target.value;
										onDraft((current) => ({
											...current,
											customTicketInput: value,
											ticketSizeUsd: customTicket(value),
										}));
									}}
									placeholder="0.10–100.00"
									aria-describedby="custom-ticket-help"
								/>
							</span>
							<small id="custom-ticket-help">
								USDG amount from $0.10 to $100.00, in $0.01 increments.
							</small>
						</label>
					) : null}
					<QuestionActions
						back={() => onStep("cadence")}
						next={() => onStep("risk")}
						nextDisabled={!draft.ticketSizeUsd}
					/>
				</>
			) : null}

			{step === "risk" ? (
				<>
					<span className="onboarding-kicker">Risk preference</span>
					<h2>How should we rank opportunity?</h2>
					<p>This changes ranking, not deterministic safety checks.</p>
					<div className="question-options">
						{RISK_OPTIONS.map((option) => (
							<button
								type="button"
								className={
									draft.riskMode === option.id
										? "question-option selected"
										: "question-option"
								}
								onClick={() =>
									onDraft((current) => ({ ...current, riskMode: option.id }))
								}
								key={option.id}
							>
								<span>
									<b>{option.title}</b>
									{option.tag ? <em>{option.tag}</em> : null}
								</span>
								<small>{option.description}</small>
								{draft.riskMode === option.id ? <Check /> : null}
							</button>
						))}
					</div>
					<QuestionActions
						back={() => onStep("ticket")}
						next={() => onStep("assets")}
						nextDisabled={!draft.riskMode}
					/>
				</>
			) : null}

			{step === "assets" ? (
				<>
					<span className="onboarding-kicker">Asset mix</span>
					<h2>What can appear in your feed?</h2>
					<p>
						Tokenized stocks appear only after eligibility and market checks
						pass.
					</p>
					<div className="question-options">
						{ASSET_OPTIONS.map((option) => (
							<button
								type="button"
								className={
									draft.assetChoice === option.id
										? "question-option selected"
										: "question-option"
								}
								onClick={() =>
									onDraft((current) => ({
										...current,
										assetChoice: option.id,
									}))
								}
								key={option.id}
							>
								<span>
									<b>{option.title}</b>
									{option.tag ? <em>{option.tag}</em> : null}
								</span>
								<small>{option.description}</small>
								{draft.assetChoice === option.id ? <Check /> : null}
							</button>
						))}
					</div>
					<QuestionActions
						back={() => onStep("risk")}
						next={() => onStep("review")}
						nextDisabled={!draft.assetChoice}
					/>
				</>
			) : null}

			{step === "review" ? (
				<>
					<span className="onboarding-kicker">Review</span>
					<h2>Your investment plan</h2>
					<PlanSummary preferences={toPreviewPreferences(draft)} />
					<label className="risk-acknowledgement">
						<input
							type="checkbox"
							checked={draft.riskDisclosureAccepted}
							onChange={(event) =>
								onDraft((current) => ({
									...current,
									riskDisclosureAccepted: event.target.checked,
								}))
							}
						/>
						<span>
							I understand AI provides a ranking, not financial advice; assets
							can lose value; tokenized stocks depend on eligibility; and every
							trade requires my wallet approval.
						</span>
					</label>
					<QuestionActions
						back={() => onStep("assets")}
						next={onSave}
						nextLabel="Save plan & connect"
						nextDisabled={!draft.riskDisclosureAccepted}
					/>
				</>
			) : null}
		</>
	);
}

function QuestionActions({
	back,
	next,
	nextDisabled,
	nextLabel = "Continue",
}: {
	back: () => void;
	next: () => void;
	nextDisabled: boolean;
	nextLabel?: string;
}) {
	return (
		<div className="question-actions">
			<button type="button" className="button button-outline" onClick={back}>
				Back
			</button>
			<button
				type="button"
				className="button button-primary"
				onClick={next}
				disabled={nextDisabled}
			>
				{nextLabel} <ArrowRight />
			</button>
		</div>
	);
}

function PlanSummary({
	preferences,
	compact = false,
}: {
	preferences: OnboardingPreferences;
	compact?: boolean;
}) {
	const risk = RISK_OPTIONS.find(
		(option) => option.id === preferences.riskMode,
	)?.title;
	const assets =
		preferences.assetClasses.length === 2
			? "Crypto + tokenized stocks"
			: preferences.assetClasses[0] === "CRYPTO"
				? "Crypto"
				: "Tokenized stocks";
	return (
		<div className={compact ? "plan-summary compact" : "plan-summary"}>
			<p>
				<span>Frequency</span>
				<b>{cadenceLabel(preferences.cadence)}</b>
			</p>
			<p>
				<span>Ticket size</span>
				<b>{preferences.ticketSizeUsd} USDG per card</b>
			</p>
			<p>
				<span>Period limit</span>
				<b>100 USDG · up to {maxCardsFor(preferences.ticketSizeUsd)} cards</b>
			</p>
			<p>
				<span>Risk mode</span>
				<b>{risk}</b>
			</p>
			<p>
				<span>Asset mix</span>
				<b>{assets}</b>
			</p>
		</div>
	);
}

function isQuestionStep(
	step: Step,
): step is Extract<
	Step,
	"welcome" | "cadence" | "ticket" | "risk" | "assets" | "review"
> {
	return ["welcome", "cadence", "ticket", "risk", "assets", "review"].includes(
		step,
	);
}

function assetClassesFrom(
	choice?: AssetChoice,
): OnboardingPreferences["assetClasses"] {
	if (choice === "CRYPTO") return ["CRYPTO"];
	if (choice === "STOCK_TOKEN") return ["STOCK_TOKEN"];
	if (choice === "BOTH") return ["CRYPTO", "STOCK_TOKEN"];
	return [];
}

function assetChoiceFrom(
	assetClasses: OnboardingPreferences["assetClasses"],
): AssetChoice {
	return assetClasses.length === 2 ? "BOTH" : (assetClasses[0] ?? "BOTH");
}

function toCompletedPreferences(
	draft: PreferenceDraft,
): OnboardingPreferences | undefined {
	const assetClasses = assetClassesFrom(draft.assetChoice);
	if (
		!draft.cadence ||
		!draft.ticketSizeUsd ||
		!draft.riskMode ||
		!assetClasses.length ||
		!draft.riskDisclosureAccepted
	)
		return;
	return {
		cadence: draft.cadence,
		ticketSizeUsd: draft.ticketSizeUsd,
		riskMode: draft.riskMode,
		assetClasses,
		riskDisclosureAccepted: true,
	};
}

function toPreviewPreferences(draft: PreferenceDraft): OnboardingPreferences {
	return {
		cadence: draft.cadence ?? "weekly",
		ticketSizeUsd: draft.ticketSizeUsd ?? 10,
		riskMode: draft.riskMode ?? "balanced",
		assetClasses: assetClassesFrom(draft.assetChoice),
		riskDisclosureAccepted: true,
	};
}

function emptyDraft(): PreferenceDraft {
	return {
		customTicketInput: "",
		riskDisclosureAccepted: false,
	};
}

function draftFromPreferences(
	preferences: OnboardingPreferences,
): PreferenceDraft {
	return {
		cadence: preferences.cadence,
		ticketSizeUsd: preferences.ticketSizeUsd,
		ticketChoice: isPresetTicket(preferences.ticketSizeUsd)
			? preferences.ticketSizeUsd
			: "custom",
		customTicketInput: isPresetTicket(preferences.ticketSizeUsd)
			? ""
			: String(preferences.ticketSizeUsd),
		riskMode: preferences.riskMode,
		assetChoice: assetChoiceFrom(preferences.assetClasses),
		riskDisclosureAccepted: true,
	};
}

function customTicket(value: string): number | undefined {
	const parsed = Number(value);
	const rounded = Math.round(parsed * 100) / 100;
	return isTicketSizeUsd(rounded) ? rounded : undefined;
}

function isPresetTicket(value: number): value is 2 | 10 | 25 {
	return value === 2 || value === 10 || value === 25;
}

function maxCardsFor(ticketSizeUsd: number) {
	return Math.min(3, Math.floor(100 / ticketSizeUsd));
}

function cadenceLabel(cadence: OnboardingPreferences["cadence"]) {
	if (cadence === "daily") return "Every day";
	if (cadence === "monthly") return "Every month";
	return "Every week";
}
