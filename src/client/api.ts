import type {
  Candidate,
  ExecutionPlan,
  FeedOutput,
  OnboardingPreferences
} from "../domain/schemas";
import { ticketSizeToBaseUnits } from "../domain/schemas";

export interface WeeklySession {
  id: string;
  epochId: string;
  status: string;
}

export interface FeedResponse {
  candidates: Candidate[];
  feed: FeedOutput;
  proof: {
    network: string;
    model: string;
    provider: string;
    teeVerified: boolean;
    inputCommitment: string;
    outputCommitment: string;
  };
}

export interface ExecutionRecord {
  plan: ExecutionPlan;
  status: "PREPARED" | "SUBMITTED" | "SETTLED" | "PARTIAL" | "FAILED";
  submissionMode: "SEQUENTIAL" | "BATCH";
  transactionHashes: string[];
  settledOutputs: Array<{
    assetId: string;
    amountOutBaseUnits: string;
    transactionHash: string;
    blockNumber?: string;
    status: "success" | "failed";
  }>;
  settledAt?: string;
  walletCalls?: Array<{
    kind: "CANCEL_APPROVAL" | "APPROVAL" | "PERMIT" | "SWAP";
    assetId?: string;
    transaction: {
      to: string;
      from: string;
      data: string;
      value: string;
      chainId: number;
      gasLimit?: string;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasPrice?: string;
    };
  }>;
}

export type WalletCall = NonNullable<ExecutionRecord["walletCalls"]>[number];

export interface ExitPreparation {
  asset: { assetId: string; symbol: string; decimals: number };
  quote: Candidate["quote"];
  walletCalls: WalletCall[];
}

export interface PublicConfig {
  demoMode: boolean;
  executionMode: "demo" | "local-live" | "live";
  chainId: 4663;
  stableToken: "USDG";
  maxCards: number;
  privy: { appId: string };
  world: null | { appId: string; rpId: string; action: string };
}

export interface AssetIconsResponse {
  icons: Record<string, string>;
}

export interface TokenBalanceResponse {
  asset: "USDG";
  chainId: 4663;
  decimals: number;
  balanceBaseUnits: string;
}

let authProvider:
  | {
      getAccessToken: () => Promise<string | null>;
      getWalletAddress: () => string | undefined;
    }
  | undefined;

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function configureApiAuth(provider: typeof authProvider) {
  authProvider = provider;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await authProvider?.getAccessToken();
  const wallet = authProvider?.getWalletAddress();
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(wallet ? { "X-Wallet-Address": wallet } : {}),
      ...init?.headers
    }
  });
  const body = await response.json();
  if (!response.ok) {
    const details =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const code = typeof details.error === "string" ? details.error : "REQUEST_FAILED";
    const message =
      typeof details.message === "string"
        ? details.message
        : apiErrorMessage(code);
    throw new ApiError(code, message, details);
  }
  return body as T;
}

function apiErrorMessage(code: string) {
  if (code === "SESSION_NOT_FOUND") return "This basket session expired. Start another basket.";
  if (code === "EPOCH_ALREADY_EXECUTED") {
    return "Quotes were prepared for a different basket. Start another basket to change it.";
  }
  if (code === "EXECUTION_TERMINAL") {
    return "This basket has already been submitted. Open its receipt or start another basket.";
  }
  if (code === "INVALID_REQUEST") {
    return "Choose at least one eligible asset before continuing.";
  }
  return "The basket could not be prepared. Please try again.";
}

export const api = {
  config: () => request<PublicConfig>("/api/config"),
  assetIcons: () => request<AssetIconsResponse>("/api/assets/icons"),
  usdgBalance: (wallet: string) => request<TokenBalanceResponse>(`/api/balances/${encodeURIComponent(wallet)}/usdg`),
  worldSignature: () =>
    request<{
      sig: string;
      nonce: string;
      created_at: number;
      expires_at: number;
      app_id: string;
      rp_id: string;
      action: string;
    }>("/api/world/rp-signature", { method: "POST" }),
  verifyWorld: (proof: unknown) =>
    request<{ success: true; proofOfHumanVerified: true }>("/api/world/verify", {
      method: "POST",
      body: JSON.stringify(proof)
    }),
  openSession: (cadence: OnboardingPreferences["cadence"]) =>
    request<WeeklySession>("/api/sessions/open", {
      method: "POST",
      body: JSON.stringify({ cadence })
    }),
  generateFeed: (
    sessionId: string,
    preferences: OnboardingPreferences,
    candidateLimit?: number
  ) =>
    request<FeedResponse>(`/api/sessions/${sessionId}/feed`, {
      method: "POST",
      body: JSON.stringify({ ...preferences, candidateLimit })
    }),
  prepareExecution: (sessionId: string, assetIds: string[], ticketSizeUsd: number) =>
    request<ExecutionRecord>("/api/executions/prepare", {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        chainId: 4663,
        inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        selections: assetIds.map((assetId) => ({
          assetId,
          amountInBaseUnits: ticketSizeToBaseUnits(ticketSizeUsd).toString()
        })),
        slippageBps: 50
      })
    }),
  demoSettle: (executionId: string) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/demo-settle`, { method: "POST" }),
  markSubmitted: (executionId: string, transactionHashes: string[], batched = false) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/submitted`, {
      method: "POST",
      body: JSON.stringify({ transactionHashes, batched })
    }),
  reconcile: (executionId: string) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/reconcile`, { method: "POST" }),
  execution: (executionId: string) =>
    request<ExecutionRecord>(`/api/executions/${executionId}`),
  prepareExit: (assetId: string, amountInBaseUnits: string) =>
    request<ExitPreparation>(`/api/positions/${encodeURIComponent(assetId)}/exit/quote`, {
      method: "POST",
      body: JSON.stringify({ amountInBaseUnits })
    })
};
