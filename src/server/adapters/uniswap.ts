import { USDG_ADDRESS } from "../../domain/constants.js";
import { unitPriceUsdFromQuote } from "../../domain/price.js";
import type { Candidate, ExecutionRequest } from "../../domain/schemas.js";
import type { ExecutionProvider, WalletCall } from "./types.js";

export class UniswapProvider implements ExecutionProvider {
  constructor(private readonly apiKey: string) {}

  async prepare(wallet: string, request: ExecutionRequest, candidates: Candidate[]) {
    const byId = new Map(candidates.map((candidate) => [candidate.assetId, candidate]));
    const total = request.selections
      .reduce((sum, selection) => sum + BigInt(selection.amountInBaseUnits), 0n)
      .toString();
    const approvalCallsPromise = this.approvalCalls(wallet, USDG_ADDRESS, total);
    const prepared = [];
    // ponytail: execution is one click; serial swaps avoid provider 429s.
    for (const selection of request.selections) {
      const candidate = byId.get(selection.assetId);
      if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
      const raw = await this.quoteRaw(
        wallet,
        candidate,
        selection.amountInBaseUnits,
        request.slippageBps,
        true
      );
      const routing = normalizeRouting(raw.body.routing);
      if (routing !== "CLASSIC") {
        throw new Error(`UNSUPPORTED_MVP_ROUTING_${routing}`);
      }
      const swapBody = await this.swap(raw.body);
      const swapCall: WalletCall = {
        kind: "SWAP",
        assetId: candidate.assetId,
        transaction: validateTransaction(swapBody.swap, wallet)
      };
      prepared.push({
        quote: this.summarizeQuote(
          raw.body,
          candidate,
          selection.amountInBaseUnits,
          candidate.contract
        ),
        swapCall,
        permitCall: this.permitCall(raw.body, wallet)
      });
    }
    const approvalCalls = await approvalCallsPromise;
    const permitCalls = dedupePermitCalls(
      prepared
        .map((item) => item.permitCall)
        .filter((call): call is WalletCall => call !== undefined)
    );
    return {
      quotes: prepared.map((item) => item.quote),
      walletCalls: [...approvalCalls, ...permitCalls, ...prepared.map((item) => item.swapCall)]
    };
  }

  async prepareExit(
    wallet: string,
    candidate: Candidate,
    amountInBaseUnits: string,
    slippageBps: number
  ) {
    if (BigInt(amountInBaseUnits) <= 0n) throw new Error("EXIT_AMOUNT_REQUIRED");
    if (candidate.kind === "STOCK_TOKEN") {
      const allowed = await this.permissionAllowed(wallet, candidate.contract);
      if (!allowed) throw new Error("STOCK_TOKEN_PERMISSION_DENIED");
    }
    const approvalCalls = await this.approvalCalls(
      wallet,
      candidate.contract,
      amountInBaseUnits
    );
    const raw = await this.quotePairRaw(
      wallet,
      candidate.contract,
      USDG_ADDRESS,
      amountInBaseUnits,
      slippageBps,
      true
    );
    const routing = normalizeRouting(raw.body.routing);
    if (routing !== "CLASSIC") {
      throw new Error(`UNSUPPORTED_MVP_ROUTING_${routing}`);
    }
    const swapResponse = await this.swap(raw.body);
    return {
      quote: this.summarizeQuote(raw.body, candidate, amountInBaseUnits, USDG_ADDRESS),
      walletCalls: [
        ...approvalCalls,
        ...([this.permitCall(raw.body, wallet)].filter(
          (call): call is WalletCall => call !== undefined
        )),
        {
          kind: "SWAP" as const,
          assetId: candidate.assetId,
          transaction: validateTransaction(swapResponse.swap, wallet)
        }
      ]
    };
  }

  async permissionAllowed(wallet: string, token: string): Promise<boolean> {
    const response = await fetch("https://trade-api.gateway.uniswap.org/v1/permissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      },
      body: JSON.stringify({ walletAddress: wallet, tokens: [token], chainId: 4663 }),
      signal: AbortSignal.timeout(8_000)
    });
    const body = (await response.json()) as any;
    if (!response.ok) throw new Error(`UNISWAP_PERMISSIONS_${response.status}`);
    const permission = body.permissions?.[0] ?? body.results?.[0] ?? body[token] ?? body;
    return permission.isPermissioned !== true || permission.isAllowlisted === true;
  }

  async quote(
    wallet: string,
    candidate: Candidate,
    amountInBaseUnits: string,
    slippageBps: number
  ): Promise<Candidate["quote"]> {
    const raw = await this.quoteRaw(wallet, candidate, amountInBaseUnits, slippageBps, false);
    return this.summarizeQuote(raw.body, candidate, amountInBaseUnits, candidate.contract);
  }

  private async quoteRaw(
    wallet: string,
    candidate: Candidate,
    amountInBaseUnits: string,
    slippageBps: number,
    forExecution: boolean
  ) {
    return this.quotePairRaw(
      wallet,
      USDG_ADDRESS,
      candidate.contract,
      amountInBaseUnits,
      slippageBps,
      forExecution
    );
  }

  private async quotePairRaw(
    wallet: string,
    tokenIn: string,
    tokenOut: string,
    amountInBaseUnits: string,
    slippageBps: number,
    forExecution: boolean
  ) {
    const request = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "x-universal-router-version": "2.1.1"
      },
      body: JSON.stringify({
        type: "EXACT_INPUT",
        amount: amountInBaseUnits,
        tokenInChainId: "4663",
        tokenOutChainId: "4663",
        tokenIn,
        tokenOut,
        swapper: wallet,
        slippageTolerance: slippageBps / 100,
        routingPreference: "BEST_PRICE",
        protocols: ["V2", "V3", "V4"],
        ...(forExecution
          ? {
              generatePermitAsTransaction: true,
              permitAmount: "FULL"
            }
          : {})
      }),
      signal: AbortSignal.timeout(12_000)
    };
    let response = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", request);
    for (let attempt = 0; response.status === 429 && attempt < 2; attempt += 1) {
      await wait(750 * (attempt + 1));
      response = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", request);
    }
    const body = (await response.json()) as any;
    if (!response.ok) throw new Error(`UNISWAP_QUOTE_${response.status}`);
    return { body };
  }

  private summarizeQuote(
    body: any,
    candidate: Candidate,
    amountInBaseUnits: string,
    tokenOut: string
  ): Candidate["quote"] {
    const quote = body.quote ?? body;
    const estimated = String(quote.output?.amount ?? quote.amountOut ?? "0");
    const minimum = String(
      quote.output?.minimumAmount ??
      quote.aggregatedOutputs?.[0]?.minAmount ??
      quote.amountOutMinimum ??
      "0"
    );
    if (BigInt(estimated) <= 0n || BigInt(minimum) <= 0n) throw new Error("UNISWAP_ZERO_OUTPUT");
    return {
      requestId: String(body.requestId ?? crypto.randomUUID()),
      assetId: candidate.assetId,
      tokenOut,
      amountInBaseUnits,
      estimatedAmountOut: estimated,
      minimumAmountOut: minimum,
      unitPriceUsd: unitPriceUsdFromQuote(amountInBaseUnits, estimated, candidate.decimals),
      priceImpactBps: Math.max(0, Math.round(Number(quote.priceImpact ?? 0) * 100)),
      routing: normalizeRouting(body.routing),
      quotedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  private async approvalCalls(
    wallet: string,
    token: string,
    amount: string
  ): Promise<WalletCall[]> {
    const response = await fetch("https://trade-api.gateway.uniswap.org/v1/check_approval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      },
      body: JSON.stringify({
        walletAddress: wallet,
        token,
        amount,
        chainId: 4663
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const body = (await response.json()) as any;
    if (!response.ok) throw new Error(`UNISWAP_APPROVAL_${response.status}`);
    const calls: WalletCall[] = [];
    if (body.cancel) {
      calls.push({
        kind: "CANCEL_APPROVAL",
        transaction: validateTransaction(body.cancel, wallet)
      });
    }
    if (body.approval) {
      calls.push({
        kind: "APPROVAL",
        transaction: validateTransaction(body.approval, wallet)
      });
    }
    return calls;
  }

  private async swap(quoteResponse: any, retry = true): Promise<any> {
    const response = await fetch("https://trade-api.gateway.uniswap.org/v1/swap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "x-universal-router-version": "2.1.1"
      },
      body: JSON.stringify(swapRequest(quoteResponse)),
      signal: AbortSignal.timeout(12_000)
    });
    const body = (await response.json()) as any;
    if (response.status === 429 && retry) {
      // ponytail: one provider-directed retry; add a queue only if this still fails.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      return this.swap(quoteResponse, false);
    }
    if (!response.ok) throw new Error(`UNISWAP_SWAP_${response.status}`);
    return body;
  }

  private permitCall(body: any, wallet: string): WalletCall | undefined {
    if (!body?.permitTransaction) return;
    return {
      kind: "PERMIT",
      transaction: validateTransaction(body.permitTransaction, wallet)
    };
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeRouting(value: unknown): Candidate["quote"]["routing"] {
  return ["CLASSIC", "WRAP", "UNWRAP", "DUTCH_V2", "DUTCH_V3", "PRIORITY"].includes(
    String(value)
  )
    ? (String(value) as Candidate["quote"]["routing"])
    : "CLASSIC";
}

function validateTransaction(raw: any, wallet: string): WalletCall["transaction"] {
  if (
    !raw ||
    typeof raw.to !== "string" ||
    typeof raw.from !== "string" ||
    raw.from.toLowerCase() !== wallet.toLowerCase() ||
    typeof raw.data !== "string" ||
    raw.data === "0x" ||
    Number(raw.chainId) !== 4663
  ) {
    throw new Error("INVALID_UNISWAP_TRANSACTION");
  }
  return {
    to: raw.to,
    from: raw.from,
    data: raw.data,
    value: String(raw.value ?? "0"),
    chainId: 4663,
    gasLimit: raw.gasLimit ? String(raw.gasLimit) : undefined,
    maxFeePerGas: raw.maxFeePerGas ? String(raw.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas
      ? String(raw.maxPriorityFeePerGas)
      : undefined,
    gasPrice: raw.gasPrice ? String(raw.gasPrice) : undefined
  };
}

function swapRequest(body: any): Record<string, unknown> {
  if (!body?.quote || typeof body.quote !== "object") {
    throw new Error("UNISWAP_QUOTE_PAYLOAD_MISSING");
  }
  return {
    quote: body.quote,
    ...(body.permitData ? { permitData: body.permitData } : {}),
    safetyMode: "SAFE",
    deadline: Math.floor(Date.now() / 1000) + 60
  };
}

function dedupePermitCalls(calls: WalletCall[]) {
  const byTarget = new Map<string, WalletCall>();
  for (const call of calls) {
    const target = call.transaction.to.toLowerCase();
    if (!byTarget.has(target)) byTarget.set(target, call);
  }
  return [...byTarget.values()];
}
