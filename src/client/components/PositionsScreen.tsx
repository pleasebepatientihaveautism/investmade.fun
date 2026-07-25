import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useState } from "react";
import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import type { Candidate } from "../../domain/schemas";
import { api, type ExitPreparation, type WalletCall } from "../api";
import { AssetMark } from "./AssetMark";
import { ArrowRight, Check, Shield } from "./Icons";

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

export function PositionsScreen({
  candidates,
  wallet,
  demoMode
}: {
  candidates: Candidate[];
  wallet: string;
  demoMode: boolean;
}) {
  const { wallets } = useWallets();
  const activeWallet = wallets.find((candidate) => candidate.linked) ?? wallets[0];
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<Record<string, ExitPreparation>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (demoMode || !wallet || !activeWallet) return;
    let cancelled = false;
    activeWallet.getEthereumProvider()
      .then((provider) => Promise.all(
        candidates.map(async (candidate) => {
          const data = encodeFunctionData({
            abi: balanceOfAbi,
            functionName: "balanceOf",
            args: [wallet as `0x${string}`]
          });
          const value = (await provider.request({
            method: "eth_call",
            params: [{ to: candidate.contract, data }, "latest"]
          })) as string;
          return [candidate.assetId, BigInt(value).toString()] as const;
        })
      ))
      .then((entries) => {
        if (!cancelled) setBalances(Object.fromEntries(entries));
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Could not read wallet balances.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWallet, candidates, demoMode, wallet]);

  async function prepare(candidate: Candidate) {
    const amount = balances[candidate.assetId] ?? "0";
    if (BigInt(amount) <= 0n) return;
    setError("");
    setStatus((current) => ({ ...current, [candidate.assetId]: "Preparing fresh quote…" }));
    try {
      const result = await api.prepareExit(candidate.assetId, amount);
      setPrepared((current) => ({ ...current, [candidate.assetId]: result }));
      setStatus((current) => ({ ...current, [candidate.assetId]: "Ready for wallet confirmation" }));
    } catch (caught) {
      setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
      setError(caught instanceof Error ? caught.message : "Could not prepare exit.");
    }
  }

  async function confirm(candidate: Candidate) {
    const exit = prepared[candidate.assetId];
    if (!exit?.walletCalls.length || !activeWallet) return;
    setError("");
    setStatus((current) => ({ ...current, [candidate.assetId]: "Confirm in wallet…" }));
    try {
      await activeWallet.switchChain(4663);
      const provider = await activeWallet.getEthereumProvider();
      for (const call of exit.walletCalls) {
        const hash = (await provider.request({
          method: "eth_sendTransaction",
          params: [walletTransaction(call)]
        })) as string;
        const receipt = (await waitForReceipt(provider, hash)) as { status?: string };
        if (receipt.status !== "0x1") throw new Error("Exit transaction reverted.");
      }
      setStatus((current) => ({ ...current, [candidate.assetId]: "Exit settled" }));
      setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Exit confirmation failed.");
      setStatus((current) => ({ ...current, [candidate.assetId]: "" }));
    }
  }

  return (
    <main className="positions-page">
      <header className="positions-heading">
        <h1>Positions</h1>
        <p>
          Exit supported assets with a fresh reverse Uniswap quote. Exits remain available outside
          the weekly buy window.
        </p>
      </header>
      <div className="exit-disclosure">
        <Shield />
        <p>
          <b>Non-custodial exit</b>
          The app prepares calls; your wallet shows and signs every approval and swap.
        </p>
      </div>
      {demoMode ? (
        <div className="positions-empty">
          Demo mode does not invent wallet balances or settlement. Start live mode with a funded
          wallet to prepare an exit.
        </div>
      ) : (
        <section className="positions-list">
          {candidates.map((candidate) => {
            const rawBalance = balances[candidate.assetId] ?? "0";
            const exit = prepared[candidate.assetId];
            const settled = status[candidate.assetId] === "Exit settled";
            return (
              <article className="position-row" key={candidate.assetId}>
                <AssetMark symbol={candidate.symbol} size="md" />
                <span className="position-name">
                  <b>{candidate.symbol}</b>
                  <small>{candidate.name}</small>
                </span>
                <span className="position-balance">
                  <b>{formatUnits(BigInt(rawBalance), candidate.decimals)}</b>
                  <small>Wallet balance</small>
                </span>
                {exit && (
                  <span className="position-quote">
                    <b>{formatUnits(BigInt(exit.quote.minimumAmountOut), 6)} USDG minimum</b>
                    <small>Fresh for 60 seconds</small>
                  </span>
                )}
                <button
                  type="button"
                  className="button button-primary"
                  disabled={BigInt(rawBalance) <= 0n || settled}
                  onClick={() => (exit ? confirm(candidate) : prepare(candidate))}
                >
                  {settled ? (
                    <>
                      <Check /> Settled
                    </>
                  ) : exit ? (
                    <>
                      Confirm exit <ArrowRight />
                    </>
                  ) : (
                    "Get fresh exit quote"
                  )}
                </button>
                {status[candidate.assetId] && (
                  <small className="position-status">{status[candidate.assetId]}</small>
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

function walletTransaction(call: WalletCall) {
  return {
    from: call.transaction.from,
    to: call.transaction.to,
    data: call.transaction.data,
    value: toHex(call.transaction.value),
    ...(call.transaction.gasLimit ? { gas: toHex(call.transaction.gasLimit) } : {})
  };
}

function toHex(value: string) {
  return `0x${BigInt(value).toString(16)}`;
}

async function waitForReceipt(provider: EIP1193Provider, hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash]
    });
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Exit transaction is still pending. Check your wallet before retrying.");
}
