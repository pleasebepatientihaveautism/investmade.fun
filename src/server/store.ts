import { randomUUID } from "node:crypto";
import type { ExecutionPlan } from "../domain/schemas.js";

export type SessionStatus =
  | "OPEN"
  | "SWIPING"
  | "REVIEW"
  | "AWAITING_SIGNATURE"
  | "SUBMITTED"
  | "SETTLED"
  | "PARTIAL"
  | "FAILED"
  | "CLOSED";

export interface WeeklySession {
  id: string;
  wallet: string;
  epochId: string;
  status: SessionStatus;
  executionId?: string;
  createdAt: string;
}

export interface ExecutionRecord {
  plan: ExecutionPlan;
  status: "PREPARED" | "SUBMITTED" | "SETTLED" | "PARTIAL" | "FAILED";
  transactionHashes: string[];
  settledOutputs: SettledOutput[];
  settledAt?: string;
}

export interface SettledOutput {
  assetId: string;
  amountOutBaseUnits: string;
  transactionHash: string;
  blockNumber?: string;
  status: "success" | "failed";
}

export interface StateStore {
  openSession(wallet: string, epochId: string): Promise<WeeklySession>;
  getSession(id: string): Promise<WeeklySession | undefined>;
  bindHuman(wallet: string, nullifierDigest: string): Promise<void>;
  isHumanVerified(wallet: string): Promise<boolean>;
  reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord>;
  refreshPreparedExecution(id: string, plan: ExecutionPlan): Promise<ExecutionRecord>;
  getExecution(id: string): Promise<ExecutionRecord | undefined>;
  updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes?: string[],
    settledOutputs?: SettledOutput[]
  ): Promise<ExecutionRecord>;
}

export class MemoryStateStore implements StateStore {
  private readonly sessions = new Map<string, WeeklySession>();
  private readonly sessionByEpoch = new Map<string, string>();
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly verifiedWallets = new Set<string>();
  private readonly nullifierWallets = new Map<string, string>();

  async openSession(wallet: string, epochId: string): Promise<WeeklySession> {
    const key = `${wallet.toLowerCase()}:${epochId}`;
    const existingId = this.sessionByEpoch.get(key);
    if (existingId) {
      const existing = this.sessions.get(existingId);
      if (!existing) throw new Error("SESSION_INDEX_CORRUPT");
      return existing;
    }

    const session: WeeklySession = {
      id: randomUUID(),
      wallet: wallet.toLowerCase(),
      epochId,
      status: "OPEN",
      createdAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this.sessionByEpoch.set(key, session.id);
    return session;
  }

  async getSession(id: string): Promise<WeeklySession | undefined> {
    return this.sessions.get(id);
  }

  async bindHuman(wallet: string, nullifierDigest: string): Promise<void> {
    const owner = this.nullifierWallets.get(nullifierDigest);
    if (owner && owner !== wallet.toLowerCase()) throw new Error("WORLD_PROOF_ALREADY_BOUND");
    this.nullifierWallets.set(nullifierDigest, wallet.toLowerCase());
    this.verifiedWallets.add(wallet.toLowerCase());
  }

  async isHumanVerified(wallet: string): Promise<boolean> {
    return this.verifiedWallets.has(wallet.toLowerCase());
  }

  async reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    if (session.executionId) {
      const existing = this.executions.get(session.executionId);
      if (existing?.plan.authorizedPlanHash === plan.authorizedPlanHash) return existing;
      throw new Error("EPOCH_ALREADY_EXECUTED");
    }
    const record: ExecutionRecord = {
      plan,
      status: "PREPARED",
      transactionHashes: [],
      settledOutputs: []
    };
    this.executions.set(plan.executionId, record);
    this.sessions.set(sessionId, {
      ...session,
      status: "AWAITING_SIGNATURE",
      executionId: plan.executionId
    });
    return record;
  }

  async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    return this.executions.get(id);
  }

  async refreshPreparedExecution(id: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const existing = this.executions.get(id);
    if (!existing) throw new Error("EXECUTION_NOT_FOUND");
    if (
      existing.status !== "PREPARED" ||
      existing.plan.authorizedPlanHash !== plan.authorizedPlanHash
    ) {
      throw new Error("EPOCH_ALREADY_EXECUTED");
    }
    const refreshed = { ...existing, plan: { ...plan, executionId: id } };
    this.executions.set(id, refreshed);
    return refreshed;
  }

  async updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes: string[] = [],
    settledOutputs: SettledOutput[] = []
  ): Promise<ExecutionRecord> {
    const existing = this.executions.get(id);
    if (!existing) throw new Error("EXECUTION_NOT_FOUND");
    const updated = {
      ...existing,
      status,
      transactionHashes,
      settledOutputs,
      settledAt: ["SETTLED", "PARTIAL", "FAILED"].includes(status)
        ? new Date().toISOString()
        : undefined
    };
    this.executions.set(id, updated);
    return updated;
  }
}
