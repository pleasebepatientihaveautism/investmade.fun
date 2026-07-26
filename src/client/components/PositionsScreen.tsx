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

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2
});

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
  const activeWallet = wallets.find((candidate) => candidate.linked);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<Record<string, ExitPreparation>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [isExitingAll, setIsExitingAll] = useState(false);
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

  const portfolioValueUsd = candidates.reduce(
    (total, candidate) =>
      total +
      (Number(balances[candidate.assetId] ?? "0") / 10 ** candidate.decimals) *
        Number(candidate.quote.unitPriceUsd),
    0,
  );
  const holdings = candidates.filter(
    (candidate) => BigInt(balances[candidate.assetId] ?? "0") > 0n
  );

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

  async function exitAll() {
    if (!activeWallet || !holdings.length || isExitingAll) return;
    const accepted = window.confirm(
      `Exit all ${holdings.length} holdings? Your wallet will ask you to approve and sign each required transaction.`
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
          [candidate.assetId]: "Preparing fresh quote…"
        }));
        const exit = await api.prepareExit(candidate.assetId, amount);
        if (!exit.walletCalls.length) {
          throw new Error(`${candidate.symbol} returned no executable exit calls.`);
        }
        setPrepared((current) => ({ ...current, [candidate.assetId]: exit }));
        setStatus((current) => ({ ...current, [candidate.assetId]: "Confirm in wallet…" }));
        for (const call of exit.walletCalls) {
          const hash = (await provider.request({
            method: "eth_sendTransaction",
            params: [walletTransaction(call)]
          })) as string;
          const receipt = (await waitForReceipt(provider, hash)) as { status?: string };
          if (receipt.status !== "0x1") throw new Error(`${candidate.symbol} exit reverted.`);
        }
        setStatus((current) => ({ ...current, [candidate.assetId]: "Exit settled" }));
        setBalances((current) => ({ ...current, [candidate.assetId]: "0" }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not exit all holdings.");
    } finally {
      setIsExitingAll(false);
    }
  }

  return (
    <main className="positions-page">
      <header className="positions-heading">
        <div>
          <h1>Portfolio</h1>
          <p>Live wallet value from current executable quotes.</p>
        </div>
        {!demoMode && (
          <button
            type="button"
            className="button button-primary exit-all-button"
            disabled={!holdings.length || isExitingAll}
            onClick={exitAll}
          >
            {isExitingAll ? "Exiting…" : "Exit all"}
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
        Exit supported assets with a fresh reverse Uniswap quote. Exits stay available outside
        your buy session.
      </p>
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
            const balance = formatPositionBalance(BigInt(rawBalance), candidate.decimals);
            const unitPrice = usdFormatter.format(Number(candidate.quote.unitPriceUsd));
            return (
              <article className="position-row" key={candidate.assetId}>
                <AssetMark symbol={candidate.symbol} size="sm" />
                <div className="position-identity">
                  <b>{candidate.symbol}</b>
                  <small>{candidate.name}</small>
                </div>
                <div className="position-metrics">
                  <b>{balance} {candidate.symbol}</b>
                  <small>{unitPrice} each</small>
                </div>
                <button
                  type="button"
                  className="button button-sell"
                  disabled={BigInt(rawBalance) <= 0n || settled}
                  onClick={() => (exit ? confirm(candidate) : prepare(candidate))}
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
                    {formatUnits(BigInt(exit.quote.minimumAmountOut), 6)} USDG minimum · fresh for 60 seconds
                  </small>
                )}
                {status[candidate.assetId] && status[candidate.assetId] !== "Ready for wallet confirmation" && (
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

function formatPositionBalance(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function walletTransaction(call: WalletCall) {
  const { transaction } = call;
  const hasEip1559Fees = Boolean(transaction.maxFeePerGas && transaction.maxPriorityFeePerGas);
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
    ...(!hasEip1559Fees && transaction.gasPrice ? { gasPrice: toHex(transaction.gasPrice) } : {})
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
