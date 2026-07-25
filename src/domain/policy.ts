import {
  ASSET_REGISTRY,
  MAX_CARDS,
  MAX_PRICE_IMPACT_BPS,
  POLICY_VERSION,
  QUOTE_TTL_SECONDS,
  SLOT_BUDGET,
  WEEKLY_BUDGET
} from "./constants.js";
import { sha256 } from "./canonical.js";
import {
  feedOutputSchema,
  type Candidate,
  type ExecutionRequest,
  type FeedInput,
  type FeedOutput
} from "./schemas.js";

export class PolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const registryById = new Map<string, (typeof ASSET_REGISTRY)[keyof typeof ASSET_REGISTRY]>(
  Object.values(ASSET_REGISTRY).map((asset) => [asset.assetId, asset])
);

export function eligibleCandidates(candidates: Candidate[], now = new Date()): Candidate[] {
  return candidates.filter((candidate) => {
    const registered = registryById.get(candidate.assetId);
    const quoteAgeMs = now.getTime() - new Date(candidate.quote.quotedAt).getTime();
    return Boolean(
      registered &&
        registered.address.toLowerCase() === candidate.contract.toLowerCase() &&
        candidate.eligible &&
        candidate.marketHealthy &&
        candidate.permissionAllowed &&
        candidate.quote.priceImpactBps <= MAX_PRICE_IMPACT_BPS &&
        quoteAgeMs >= 0 &&
        quoteAgeMs <= QUOTE_TTL_SECONDS * 1_000 &&
        new Date(candidate.quote.expiresAt).getTime() > now.getTime()
    );
  });
}

export function validateFeed(
  raw: unknown,
  input: FeedInput,
  candidates: Candidate[]
): FeedOutput {
  const feed = feedOutputSchema.parse(raw);
  if (feed.sessionId !== input.sessionId) {
    throw new PolicyError("SESSION_MISMATCH", "The AI output references a different session.");
  }
  if (feed.inputCommitment !== input.inputCommitment) {
    throw new PolicyError("COMMITMENT_MISMATCH", "The AI output commitment does not match.");
  }

  const allowed = new Map(eligibleCandidates(candidates).map((candidate) => [candidate.assetId, candidate]));
  const seen = new Set<string>();
  let total = 0n;

  for (const card of feed.cards) {
    if (!allowed.has(card.assetId)) {
      throw new PolicyError("ASSET_NOT_ELIGIBLE", `Asset ${card.assetId} did not pass the candidate gate.`);
    }
    if (seen.has(card.assetId)) {
      throw new PolicyError("DUPLICATE_ASSET", `Asset ${card.assetId} appeared more than once.`);
    }
    if (BigInt(card.amountInBaseUnits) !== SLOT_BUDGET) {
      throw new PolicyError("INVALID_SLOT_SIZE", "Every card must use the fixed 10 USDG slot.");
    }
    seen.add(card.assetId);
    total += BigInt(card.amountInBaseUnits);
  }

  if (feed.cards.length > MAX_CARDS || total > WEEKLY_BUDGET) {
    throw new PolicyError("BUDGET_EXCEEDED", "The feed exceeds the weekly budget.");
  }
  return feed;
}

export function validateExecutionSelection(
  request: ExecutionRequest,
  candidates: Candidate[],
  now = new Date()
): void {
  const eligible = new Set(eligibleCandidates(candidates, now).map((candidate) => candidate.assetId));
  const seen = new Set<string>();
  let total = 0n;

  for (const selection of request.selections) {
    if (!eligible.has(selection.assetId)) {
      throw new PolicyError("ASSET_NOT_ELIGIBLE", `${selection.assetId} is not currently executable.`);
    }
    if (seen.has(selection.assetId)) {
      throw new PolicyError("DUPLICATE_ASSET", "Each asset may appear only once.");
    }
    if (BigInt(selection.amountInBaseUnits) !== SLOT_BUDGET) {
      throw new PolicyError("INVALID_SLOT_SIZE", "Execution must preserve the authorized slot size.");
    }
    seen.add(selection.assetId);
    total += BigInt(selection.amountInBaseUnits);
  }

  if (request.selections.length > MAX_CARDS || total > WEEKLY_BUDGET) {
    throw new PolicyError("BUDGET_EXCEEDED", "Execution exceeds the weekly budget.");
  }
}

export function policyHash(): `sha256:${string}` {
  return sha256({
    policyVersion: POLICY_VERSION,
    weeklyBudget: WEEKLY_BUDGET.toString(),
    slotBudget: SLOT_BUDGET.toString(),
    maxCards: MAX_CARDS,
    maxPriceImpactBps: MAX_PRICE_IMPACT_BPS
  });
}
