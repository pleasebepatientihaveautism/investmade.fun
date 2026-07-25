import type {
  Candidate,
  ExecutionPlan,
  FeedOutput,
  OnboardingPreferences
} from "../domain/schemas";

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
    kind: "CANCEL_APPROVAL" | "APPROVAL" | "SWAP";
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
  chainId: 4663;
  stableToken: "USDG";
  privy: { appId: string };
  world: null | { appId: string; rpId: string; action: string };
}

let authProvider:
  | {
      getAccessToken: () => Promise<string | null>;
      getWalletAddress: () => string | undefined;
    }
  | undefined;

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
  if (!response.ok) throw new Error(body.message ?? body.error ?? "Request failed");
  return body as T;
}

export const api = {
  config: () => request<PublicConfig>("/api/config"),
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
  generateFeed: (sessionId: string, preferences: OnboardingPreferences) =>
    request<FeedResponse>(`/api/sessions/${sessionId}/feed`, {
      method: "POST",
      body: JSON.stringify(preferences)
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
          amountInBaseUnits: String(ticketSizeUsd * 1_000_000)
        })),
        slippageBps: 50
      })
    }),
  demoSettle: (executionId: string) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/demo-settle`, { method: "POST" }),
  markSubmitted: (executionId: string, transactionHashes: string[]) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/submitted`, {
      method: "POST",
      body: JSON.stringify({ transactionHashes })
    }),
  reconcile: (executionId: string) =>
    request<ExecutionRecord>(`/api/executions/${executionId}/reconcile`, { method: "POST" }),
  prepareExit: (assetId: string, amountInBaseUnits: string) =>
    request<ExitPreparation>(`/api/positions/${encodeURIComponent(assetId)}/exit/quote`, {
      method: "POST",
      body: JSON.stringify({ amountInBaseUnits })
    })
};
