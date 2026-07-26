import {
	ASSET_REGISTRY,
	MAX_DEGEN_PRICE_IMPACT_BPS,
	MAX_PRICE_IMPACT_BPS,
  POLICY_VERSION,
	QUOTE_TTL_SECONDS
} from "./constants.js";
import { isDegenCommunityAsset } from "./constants.js";
import { sha256 } from "./canonical.js";
import {
  feedOutputSchema,
  ticketSizeToBaseUnits,
  TICKET_SIZE_INCREMENT_BASE_UNITS,
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
		const maxPriceImpactBps = isDegenCommunityAsset(candidate.assetId)
			? MAX_DEGEN_PRICE_IMPACT_BPS
			: MAX_PRICE_IMPACT_BPS;
    return Boolean(
      registered &&
        registered.address.toLowerCase() === candidate.contract.toLowerCase() &&
        candidate.eligible &&
        candidate.marketHealthy &&
        candidate.permissionAllowed &&
		candidate.quote.priceImpactBps <= maxPriceImpactBps &&
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
    if (card.amountInBaseUnits !== input.budget.slotBudgetBaseUnits) {
      throw new PolicyError("INVALID_SLOT_SIZE", "Every card must use the selected ticket size.");
    }
    seen.add(card.assetId);
    total += BigInt(card.amountInBaseUnits);
  }

  if (
    feed.cards.length > input.budget.maxCards ||
    total > BigInt(input.budget.periodBudgetBaseUnits)
  ) {
    throw new PolicyError("BUDGET_EXCEEDED", "The feed exceeds the period budget.");
  }
  return feed;
}

export function validateExecutionSelection(
  request: ExecutionRequest,
  candidates: Candidate[],
  now = new Date()
): void {
  validateExecutionAssets(request, candidates);
  const eligible = new Set(eligibleCandidates(candidates, now).map((candidate) => candidate.assetId));

  for (const selection of request.selections) {
    if (!eligible.has(selection.assetId)) {
      throw new PolicyError("ASSET_NOT_ELIGIBLE", `${selection.assetId} is not currently executable.`);
    }
  }
}

export function validateExecutionAssets(
  request: ExecutionRequest,
  candidates: Candidate[]
): void {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.assetId, candidate]));
  const seen = new Set<string>();
  let total = 0n;
  const periodBudget = ticketSizeToBaseUnits(request.periodLimitUsd);
  const minTicket = ticketSizeToBaseUnits(0.1);
  const increment = TICKET_SIZE_INCREMENT_BASE_UNITS;

  for (const selection of request.selections) {
    const amount = BigInt(selection.amountInBaseUnits);
    if (amount < minTicket || amount % increment !== 0n) {
      throw new PolicyError("INVALID_SLOT_SIZE", "Each allocation must be at least 0.10 USDG in 0.01 increments.");
    }
    const candidate = candidatesById.get(selection.assetId);
    const registered = registryById.get(selection.assetId);
    if (
      !candidate ||
      !registered ||
      registered.address.toLowerCase() !== candidate.contract.toLowerCase() ||
      !candidate.eligible ||
      !candidate.marketHealthy ||
      !candidate.permissionAllowed
    ) {
      throw new PolicyError("ASSET_NOT_ELIGIBLE", `${selection.assetId} is not currently executable.`);
    }
    if (seen.has(selection.assetId)) {
      throw new PolicyError("DUPLICATE_ASSET", "Each asset may appear only once.");
    }
    seen.add(selection.assetId);
    total += amount;
  }

  if (total > periodBudget) {
    throw new PolicyError("BUDGET_EXCEEDED", "Execution exceeds the period budget.");
  }
}

export function policyHash(
  selections: ExecutionRequest["selections"],
  periodLimitUsd: number,
): `sha256:${string}` {
  const periodBudget = ticketSizeToBaseUnits(periodLimitUsd);
  return sha256({
    policyVersion: POLICY_VERSION,
    periodBudget: periodBudget.toString(),
    selections: [...selections].sort((left, right) => left.assetId.localeCompare(right.assetId)),
    maxPriceImpactBps: MAX_PRICE_IMPACT_BPS
  });
}
