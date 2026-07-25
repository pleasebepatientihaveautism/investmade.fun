import { formatUnits } from "viem";
import { useEffect, useState } from "react";
import type { OnboardingPreferences } from "../../domain/schemas";
import { formatTicketSizeUsd, isTicketSizeUsd } from "../../domain/schemas";
import { api } from "../api";

const ACCOUNT_PREFERENCES_KEY = "investmade:onboarding:v2";
const CADENCE_OPTIONS = ["daily", "weekly", "monthly"] as const;
const RISK_OPTIONS = ["conservative", "balanced", "degen"] as const;

export function AccountScreen({
  wallet,
  preferences,
  developerMode,
  devCardLimit,
  maxDevCards,
  onDevCardLimitChange,
  onResetDemoWeek,
  onSave
}: {
  wallet: string;
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

  useEffect(() => setDraft(preferences), [preferences]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setBalance(undefined);
    setBalanceError("");
    api.usdgBalance(wallet)
      .then(({ balanceBaseUnits, decimals }) => {
        if (!cancelled) setBalance(formatUnits(BigInt(balanceBaseUnits), decimals));
      })
      .catch((caught) => {
        if (!cancelled) setBalanceError(caught instanceof Error ? caught.message : "Could not read USDG balance.");
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
          <strong>{balance === undefined ? (balanceError ? "—" : "Loading…") : `${balance} USDG`}</strong>
          <small>{balanceError || "Live Robinhood Chain balance via Alchemy"}</small>
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
          <div className="ticket-input"><b>$</b><input type="number" min="0.1" max="100" step="0.01" inputMode="decimal" value={formatTicketSizeUsd(draft.ticketSizeUsd)} onChange={(event) => setDraft((current) => ({ ...current, ticketSizeUsd: clampTicket(event.target.value) }))} /></div>
          <small>USDG amount from $0.10 to $100.00, in $0.01 increments.</small>
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

      {developerMode ? (
        <section className="account-settings" aria-labelledby="developer-settings-title">
          <div className="settings-intro">
            <div>
              <span className="account-label">Local developer controls</span>
              <h2 id="developer-settings-title">Test another basket</h2>
            </div>
            <span className="settings-limit">Local only</span>
          </div>
          <label className="settings-field">
            <span>Cards to show in this basket</span>
            <select value={devCardLimit} onChange={(event) => onDevCardLimitChange(Number(event.target.value))}>
              {Array.from({ length: maxDevCards }, (_, index) => index + 1).map((limit) => (
                <option value={limit} key={limit}>{limit} {limit === 1 ? "card" : "cards"}</option>
              ))}
            </select>
            <small>Only live, eligible, quoteable cards are shown. The production limit is unchanged.</small>
          </label>
          <div className="settings-actions">
            <button type="button" className="button button-outline" onClick={() => void onResetDemoWeek()}>
              Reset local week limit and build a new basket
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}

function clampTicket(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.1;
  const rounded = Math.round(parsed * 100) / 100;
  return isTicketSizeUsd(rounded) ? rounded : Math.max(0.1, Math.min(100, rounded));
}
