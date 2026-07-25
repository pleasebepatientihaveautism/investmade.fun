import type { Candidate, ExecutionRequest, FeedInput, FeedOutput } from "../../domain/schemas.js";

export interface WalletCall {
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
}

export interface CandidateProvider {
  getCandidates(wallet: string, amountInBaseUnits?: string, now?: Date): Promise<Candidate[]>;
}

export interface PrivateInferenceProvider {
  generate(input: FeedInput, candidates: Candidate[]): Promise<{
    output: FeedOutput;
    receipt: {
      network: string;
      model: string;
      provider: string;
      teeVerified: boolean;
      inputCommitment: string;
      outputCommitment: string;
    };
  }>;
}

export interface ExecutionProvider {
  prepare(
    wallet: string,
    request: ExecutionRequest,
    candidates: Candidate[]
  ): Promise<{ quotes: Candidate["quote"][]; walletCalls: WalletCall[] }>;
  prepareExit(
    wallet: string,
    candidate: Candidate,
    amountInBaseUnits: string,
    slippageBps: number
  ): Promise<{ quote: Candidate["quote"]; walletCalls: WalletCall[] }>;
}
