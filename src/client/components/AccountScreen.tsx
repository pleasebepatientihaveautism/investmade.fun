import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { USDG_ADDRESS } from "../../domain/constants";
import type { OnboardingPreferences } from "../../domain/schemas";

const ACCOUNT_PREFERENCES_KEY = "investmade:onboarding:v2";
const USDG_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

const CADENCE_OPTIONS = ["daily", "weekly", "monthly"] as const;
const RISK_OPTIONS = ["conservative", "balanced", "degen"] as const;

export function AccountScreen({
  wallet,
  preferences,
  demoMode,
  onSave
}: {
  wallet: string;
  preferences: OnboardingPreferences;
  demoMode: boolean;
  onSave: (preferences: OnboardingPreferences) => Promise<void>;
}) {
  const { wallets } = useWallets();
  const activeWallet = wallets.find((candidate) => candidate.linked);
  const [draft, setDraft] = useState(preferences);
  const [balance, setBalance] = useState<string>();
  const [balanceError, setBalanceError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(preferences), [preferences]);

  useEffect(() => {
    if (demoMode || !wallet || !activeWallet) return;
    let cancelled = false;
    activeWallet
      .getEthereumProvider()
      .then(async (provider) => {
        const chainId = (await provider.request({ method: "eth_chainId" })) as string;
        if (Number.parseInt(chainId, 16) !== 4663) {
          throw new Error("Switch your wallet to Robinhood Chain to view your USDG balance.");
        }
        const value = (await provider.request({
          method: "eth_call",
          params: [
            {
              to: USDG_ADDRESS,
              data: encodeFunctionData({
                abi: USDG_BALANCE_OF_ABI,
                functionName: "balanceOf",
                args: [wallet as `0x${string}`]
              })
            },
            "latest"
          ]
        })) as string;
        if (!cancelled) setBalance(formatUnits(BigInt(value), 6));
      })
      .catch((caught) => {
        if (!cancelled) setBalanceError(caught instanceof Error ? caught.message : "Could not read USDG balance.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeWallet, demoMode, wallet]);

  async function save() {
    setSaveError("");
    setSaving(true);
    try {
      const next = { ...draft, riskDisclosureAccepted: true as const };
      localStorage.setItem(ACCOUNT_PREFERENCES_KEY, JSON.stringify({ version: 2, preferences: next }));
      await onSave(next);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="account-page">
      <header className="account-heading">
        <span>Account</span>
        <h1>Your wallet, your plan.</h1>
        <p>Change the preferences that shape your next investment session. Nothing trades until you review and sign.</p>
      </header>

      <section className="account-balance" aria-label="USDG balance">
        <div>
          <span className="account-label">USDG balance</span>
          <strong>{demoMode ? "—" : balance === undefined ? "Loading…" : `${balance} USDG`}</strong>
          <small>{demoMode ? "Demo mode does not invent wallet balances." : balanceError || "Robinhood Chain · wallet-owned funds"}</small>
        </div>
        <code>{wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-8)}` : "Wallet not connected"}</code>
      </section>

      <section className="account-settings" aria-labelledby="settings-title">
        <div className="settings-intro">
          <div>
            <span className="account-label">Investment settings</span>
            <h2 id="settings-title">Your next session</h2>
          </div>
          <span className="settings-limit">100 USDG period limit</span>
        </div>

        <label className="settings-field">
          <span>How often can you use Investmade?</span>
          <select value={draft.cadence} onChange={(event) => setDraft((current) => ({ ...current, cadence: event.target.value as OnboardingPreferences["cadence"] }))}>
            {CADENCE_OPTIONS.map((cadence) => <option value={cadence} key={cadence}>Every {cadence === "daily" ? "day" : cadence === "weekly" ? "week" : "month"}</option>)}
          </select>
          <small>A new session is available once per selected period.</small>
        </label>

        <label className="settings-field">
          <span>Ticket size per accepted card</span>
          <div className="ticket-input"><b>$</b><input type="number" min="1" max="100" step="1" value={draft.ticketSizeUsd} onChange={(event) => setDraft((current) => ({ ...current, ticketSizeUsd: clampTicket(event.target.value) }))} /></div>
          <small>Whole-dollar USDG amount, from $1 to $100.</small>
        </label>

        <fieldset className="settings-field">
          <legend>Risk preference</legend>
          <div className="settings-options">
            {RISK_OPTIONS.map((risk) => (
              <label key={risk} className={draft.riskMode === risk ? "selected" : ""}>
                <input type="radio" name="risk" checked={draft.riskMode === risk} onChange={() => setDraft((current) => ({ ...current, riskMode: risk }))} />
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
                    onChange={() => setDraft((current) => ({
                      ...current,
                      assetClasses: selected
                        ? current.assetClasses.filter((item) => item !== assetClass)
                        : [...current.assetClasses, assetClass]
                    }))}
                  />
                  <b>{assetClass === "CRYPTO" ? "Crypto" : "Tokenized stocks"}</b>
                </label>
              );
            })}
          </div>
          {!draft.assetClasses.length ? <small className="settings-error">Choose at least one asset type.</small> : null}
        </fieldset>

        <div className="settings-actions">
          {saveError ? <p role="alert">{saveError}</p> : null}
          <button type="button" className="button button-primary" disabled={saving || !draft.assetClasses.length} onClick={save}>
            {saving ? "Saving…" : "Save and refresh my feed"}
          </button>
        </div>
      </section>
    </main>
  );
}

function clampTicket(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(100, parsed));
}
