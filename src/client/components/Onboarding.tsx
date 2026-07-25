import { useEffect, useState } from "react";
import { useConnectOrCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { IDKit, orbLegacy } from "@worldcoin/idkit-core";
import type { PublicConfig } from "../api";
import { api } from "../api";
import { ArrowRight, Shield } from "./Icons";

export function Onboarding({
  config,
  onComplete,
  privyReady
}: {
  config: PublicConfig;
  onComplete: () => void;
  privyReady: boolean;
}) {
  const { authenticated, login } = usePrivy();
  const { connectOrCreateWallet } = useConnectOrCreateWallet();
  const { wallets } = useWallets();
  const activeWallet = wallets.find((candidate) => candidate.linked) ?? wallets[0];
  const wallet = activeWallet?.address.toLowerCase() ?? "";
  const [step, setStep] = useState<"wallet" | "world">("wallet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (authenticated && activeWallet?.linked) setStep("world");
  }, [activeWallet?.linked, authenticated]);

  async function connect() {
    if (!privyReady) return;
    setBusy(true);
    setError("");
    try {
      if (!authenticated) {
        login();
        return;
      }
      if (!activeWallet) {
        connectOrCreateWallet();
        return;
      }
      if (!activeWallet.linked) await activeWallet.loginOrLink();
      await activeWallet.switchChain(4663);
      setStep("world");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Privy wallet authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyHuman() {
    if (!config.world || !activeWallet || !wallet) return;
    setBusy(true);
    setError("");
    try {
      await activeWallet.switchChain(4663);
      const rp = await api.worldSignature();
      const request = await IDKit.request({
        app_id: config.world.appId as `app_${string}`,
        action: config.world.action,
        rp_context: {
          rp_id: config.world.rpId as `rp_${string}`,
          nonce: rp.nonce,
          created_at: rp.created_at,
          expires_at: rp.expires_at,
          signature: rp.sig
        },
        allow_legacy_proofs: true,
        environment: "production"
      }).preset(orbLegacy({ signal: wallet }));
      const proof = await request.pollUntilCompletion();
      await api.verifyWorld(proof);
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "World verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-copy">
        <h1>Your weekly market swipe, bounded by you.</h1>
        <p>investmade.fun ranks only executable candidates. Your 100 USDG stays in your wallet until you review and sign.</p>
        <div className="onboarding-points">
          <p><span>1</span><b>Authenticate with Privy</b><small>Use an external wallet or a secure embedded wallet. Authentication cannot move funds.</small></p>
          <p><span>2</span><b>Verify one human</b><small>World establishes uniqueness, never spending authority.</small></p>
          <p><span>3</span><b>Build your basket</b><small>Every 10 USDG slot is checked again before execution.</small></p>
        </div>
      </section>
      <section className="onboarding-action">
        <Shield />
        <h2>{step === "wallet" ? "Connect or create your wallet" : "Verify you’re human"}</h2>
        <p>{step === "wallet" ? "Privy · Robinhood Chain · 4663" : "Bound to your authenticated investmade.fun account"}</p>
        {error && <div className="error-message" role="alert">{error}</div>}
        <button
          type="button"
          className="button button-primary"
          onClick={step === "wallet" ? connect : verifyHuman}
          disabled={busy || !privyReady}
        >
          {busy ? "Waiting…" : step === "wallet" ? "Continue with Privy" : "Open World verification"} <ArrowRight />
        </button>
        <small>No deposit. No trading mandate. No autonomous execution.</small>
      </section>
    </main>
  );
}
