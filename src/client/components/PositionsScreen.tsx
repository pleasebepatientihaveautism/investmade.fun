import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useState } from "react";
import { useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import type { Candidate } from "../../domain/schemas";
import { api, type AssetHistoryResponse, type ExitPreparation, type WalletCall } from "../api";
import { calculatePortfolioSnapshot } from "../portfolio";
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
  const [histories, setHistories] = useState<Record<string, AssetHistoryResponse>>({});
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      candidates.map(async (candidate) => {
        try {
          return [candidate.assetId, await api.assetHistory(candidate.assetId)] as const;
        } catch {
          return [
            candidate.assetId,
            { period: "1M", source: "unavailable", points: [] } satisfies AssetHistoryResponse
          ] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setHistories(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  const portfolio = calculatePortfolioSnapshot(
    candidates.map((candidate) => ({
      rawBalance: balances[candidate.assetId] ?? "0",
      decimals: candidate.decimals,
      currentPriceUsd: Number(candidate.quote.unitPriceUsd),
      history: histories[candidate.assetId]
    }))
  );
  const holdings = candidates.filter(
    (candidate) => BigInt(balances[candidate.assetId] ?? "0") > 0n
  );
  const graphHistoryCount = holdings.filter(
    (candidate) => histories[candidate.assetId]?.source === "the-graph"
  ).length;
  const demoHistoryCount = holdings.filter(
    (candidate) => histories[candidate.assetId]?.source === "demo"
  ).length;
  const chartSource =
    graphHistoryCount === holdings.length && holdings.length > 0
      ? "The Graph · balance weighted"
      : graphHistoryCount > 0
        ? "The Graph + live quotes"
        : demoHistoryCount > 0
          ? "Demo price path · balance weighted"
          : "Price history unavailable";

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

  const chartValues = portfolio.points.map((point) => point.value);
  const chartMin = Math.min(...chartValues);
  const chartMax = Math.max(...chartValues);
  const chartSpread = chartMax - chartMin || 1;
  const chartLine = portfolio.points
    .map((point, index) => {
      const x = portfolio.points.length === 1 ? 50 : (index / (portfolio.points.length - 1)) * 100;
      const y = 30 - ((point.value - chartMin) / chartSpread) * 25;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const positive = (portfolio.changeUsd ?? 0) >= 0;

  return (
    <main className="positions-page">
      <header className="positions-heading">
        <div>
          <h1>Portfolio</h1>
          <p>Live wallet value and one-month change from Graph-backed price history when available.</p>
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
      <section className={`portfolio-summary${positive ? " is-up" : " is-down"}`}>
        <div className="portfolio-summary-meta">
          <span>Portfolio value</span>
          <strong>{usdFormatter.format(portfolio.currentValueUsd)}</strong>
          <small>
            {portfolio.changePercent === null || portfolio.changeUsd === null
              ? "1M change unavailable"
              : `${portfolio.changeUsd >= 0 ? "+" : ""}${usdFormatter.format(portfolio.changeUsd)} (${portfolio.changePercent >= 0 ? "+" : ""}${portfolio.changePercent.toFixed(2)}%) · 1M`}
          </small>
        </div>
        <svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Portfolio one month value chart">
          {chartLine ? (
            <>
              <polygon points={`0,34 ${chartLine} 100,34`} />
              <polyline points={chartLine} />
            </>
          ) : (
            <line x1="0" y1="20" x2="100" y2="20" />
          )}
        </svg>
        <div className="portfolio-chart-source">
          <span>1M</span>
          <span>{chartSource}</span>
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
