import { Pool, type PoolClient } from "pg";
import type { ExecutionPlan } from "../domain/schemas.js";
import type {
  ExecutionRecord,
  SettledOutput,
  StateStore,
  WeeklySession
} from "./store.js";

interface SessionRow {
  id: string;
  wallet: string;
  epoch_id: string;
  status: WeeklySession["status"];
  execution_id: string | null;
  created_at: Date;
}

interface ExecutionRow {
  plan: ExecutionPlan;
  status: ExecutionRecord["status"];
  transaction_hashes: string[];
  settled_outputs: SettledOutput[];
  settled_at: Date | null;
}

export class PostgresStateStore implements StateStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: databaseUrl.includes("localhost") ? false : { rejectUnauthorized: true }
    });
  }

  async openSession(wallet: string, epochId: string): Promise<WeeklySession> {
    const result = await this.pool.query<SessionRow>(
      `INSERT INTO weekly_sessions (wallet, epoch_id, status)
       VALUES ($1, $2, 'OPEN')
       ON CONFLICT (wallet, epoch_id)
       DO UPDATE SET wallet = EXCLUDED.wallet
       RETURNING id, wallet, epoch_id, status, execution_id, created_at`,
      [wallet.toLowerCase(), epochId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("SESSION_UPSERT_FAILED");
    return mapSession(row);
  }

  async getSession(id: string): Promise<WeeklySession | undefined> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, wallet, epoch_id, status, execution_id, created_at
       FROM weekly_sessions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapSession(result.rows[0]) : undefined;
  }

  async bindHuman(wallet: string, nullifierDigest: string): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO human_verifications (wallet, nullifier_digest)
       VALUES ($1, $2)
       ON CONFLICT (wallet)
       DO UPDATE SET verified_at = now()
       WHERE human_verifications.nullifier_digest = EXCLUDED.nullifier_digest`,
      [wallet.toLowerCase(), nullifierDigest]
    );
    if (result.rowCount !== 1) throw new Error("WORLD_PROOF_ALREADY_BOUND");
  }

  async isHumanVerified(wallet: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM human_verifications WHERE wallet = $1 LIMIT 1`,
      [wallet.toLowerCase()]
    );
    return result.rowCount === 1;
  }

  async reserveExecution(sessionId: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sessionResult = await client.query<SessionRow>(
        `SELECT id, wallet, epoch_id, status, execution_id, created_at
         FROM weekly_sessions WHERE id = $1 FOR UPDATE`,
        [sessionId]
      );
      const session = sessionResult.rows[0];
      if (!session) throw new Error("SESSION_NOT_FOUND");
      if (session.execution_id) {
        const existing = await this.getExecutionWithClient(client, session.execution_id);
        if (existing?.plan.authorizedPlanHash === plan.authorizedPlanHash) {
          await client.query("COMMIT");
          return existing;
        }
        throw new Error("EPOCH_ALREADY_EXECUTED");
      }
      await client.query(
        `INSERT INTO executions (id, session_id, authorized_plan_hash, plan, status)
         VALUES ($1, $2, $3, $4::jsonb, 'PREPARED')`,
        [plan.executionId, sessionId, plan.authorizedPlanHash, JSON.stringify(plan)]
      );
      await client.query(
        `UPDATE weekly_sessions
         SET execution_id = $1, status = 'AWAITING_SIGNATURE'
         WHERE id = $2`,
        [plan.executionId, sessionId]
      );
      await client.query("COMMIT");
      return {
        plan,
        status: "PREPARED",
        transactionHashes: [],
        settledOutputs: []
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getExecution(id: string): Promise<ExecutionRecord | undefined> {
    const client = await this.pool.connect();
    try {
      return await this.getExecutionWithClient(client, id);
    } finally {
      client.release();
    }
  }

  async refreshPreparedExecution(id: string, plan: ExecutionPlan): Promise<ExecutionRecord> {
    const result = await this.pool.query<ExecutionRow>(
      `UPDATE executions
       SET plan = $2::jsonb, updated_at = now()
       WHERE id = $1
         AND status = 'PREPARED'
         AND authorized_plan_hash = $3
       RETURNING plan, status, transaction_hashes, settled_outputs, settled_at`,
      [id, JSON.stringify({ ...plan, executionId: id }), plan.authorizedPlanHash]
    );
    if (!result.rows[0]) throw new Error("EPOCH_ALREADY_EXECUTED");
    return mapExecution(result.rows[0]);
  }

  async updateExecution(
    id: string,
    status: ExecutionRecord["status"],
    transactionHashes: string[] = [],
    settledOutputs: SettledOutput[] = []
  ): Promise<ExecutionRecord> {
    const terminal = ["SETTLED", "PARTIAL", "FAILED"].includes(status);
    const result = await this.pool.query<ExecutionRow>(
      `UPDATE executions
       SET status = $2,
           transaction_hashes = $3,
           settled_outputs = $4::jsonb,
           settled_at = CASE WHEN $5 THEN now() ELSE settled_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING plan, status, transaction_hashes, settled_outputs, settled_at`,
      [id, status, transactionHashes, JSON.stringify(settledOutputs), terminal]
    );
    if (!result.rows[0]) throw new Error("EXECUTION_NOT_FOUND");
    return mapExecution(result.rows[0]);
  }

  private async getExecutionWithClient(client: PoolClient, id: string) {
    const result = await client.query<ExecutionRow>(
      `SELECT plan, status, transaction_hashes, settled_outputs, settled_at
       FROM executions WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapExecution(result.rows[0]) : undefined;
  }
}

function mapSession(row: SessionRow): WeeklySession {
  return {
    id: row.id,
    wallet: row.wallet,
    epochId: row.epoch_id,
    status: row.status,
    executionId: row.execution_id ?? undefined,
    createdAt: row.created_at.toISOString()
  };
}

function mapExecution(row: ExecutionRow): ExecutionRecord {
  return {
    plan: row.plan,
    status: row.status,
    transactionHashes: row.transaction_hashes,
    settledOutputs: row.settled_outputs,
    settledAt: row.settled_at?.toISOString()
  };
}
