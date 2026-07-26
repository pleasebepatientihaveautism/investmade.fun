import { z } from "zod";
import {
  POLICY_VERSION,
  ROBINHOOD_CHAIN_ID,
  DEFAULT_SLOT_BUDGET,
  USDG_ADDRESS,
  USDG_DECIMALS
} from "./constants.js";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const baseUnitsSchema = z.string().regex(/^[0-9]+$/);
export const MIN_TICKET_SIZE_USD = 0.1;
export const MIN_PERIOD_LIMIT_USD = 10;
export const MAX_PERIOD_LIMIT_USD = 100;
export const TICKET_SIZE_INCREMENT_USD = 0.01;
export const TICKET_SIZE_INCREMENT_BASE_UNITS = 10_000n;

export function isTicketSizeUsd(value: number): boolean {
  const cents = value * 100;
  return (
    Number.isFinite(value) &&
    value >= MIN_TICKET_SIZE_USD &&
    value <= 100 &&
    Math.abs(cents - Math.round(cents)) < 1e-8
  );
}

export function isPeriodLimitUsd(value: number): boolean {
  const cents = value * 100;
  return (
    Number.isFinite(value) &&
    value >= MIN_PERIOD_LIMIT_USD &&
    value <= MAX_PERIOD_LIMIT_USD &&
    Math.abs(cents - Math.round(cents)) < 1e-8
  );
}

export function ticketSizeToBaseUnits(ticketSizeUsd: number): bigint {
  if (!isTicketSizeUsd(ticketSizeUsd)) throw new Error("INVALID_TICKET_SIZE");
  return BigInt(Math.round(ticketSizeUsd * 10 ** USDG_DECIMALS));
}

export function formatTicketSizeUsd(ticketSizeUsd: number): string {
  return ticketSizeUsd.toFixed(2);
}

export const quoteSchema = z.object({
  requestId: z.string().min(1),
  assetId: z.string().min(1),
  tokenOut: addressSchema,
  amountInBaseUnits: baseUnitsSchema,
  estimatedAmountOut: baseUnitsSchema,
  minimumAmountOut: baseUnitsSchema,
  unitPriceUsd: z.string().regex(/^\d+(\.\d+)?$/),
  priceImpactBps: z.number().int().nonnegative(),
  routing: z.enum(["CLASSIC", "WRAP", "UNWRAP", "DUTCH_V2", "DUTCH_V3", "PRIORITY"]),
  quotedAt: z.string().datetime(),
  expiresAt: z.string().datetime()
});

export const candidateSchema = z.object({
  assetId: z.string().min(1),
  symbol: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["CRYPTO", "STOCK_TOKEN"]),
  contract: addressSchema,
  decimals: z.number().int().min(0).max(36),
  eligible: z.boolean(),
  marketHealthy: z.boolean(),
  permissionAllowed: z.boolean(),
  quote: quoteSchema,
  crowdScoreBps: z.number().int().min(0).max(10_000),
  reason: z.string().min(1).max(280),
  evidenceIds: z.array(z.string().min(1)).min(1)
});

export const personalizationPreferencesSchema = z.object({
  cadence: z.enum(["daily", "weekly", "monthly"]),
  periodLimitUsd: z.number().refine(isPeriodLimitUsd, {
    message: "Period limit must be from $10.00 to $100.00 in $0.01 increments."
  }).optional(),
  ticketSizeUsd: z.number().refine(isTicketSizeUsd, {
    message: "Ticket size must be from $0.10 to $100.00 in $0.01 increments."
  }),
  riskMode: z.enum(["conservative", "balanced", "degen"]),
  assetClasses: z
    .array(z.enum(["CRYPTO", "STOCK_TOKEN"]))
    .min(1)
    .max(2)
    .refine((values) => new Set(values).size === values.length, {
      message: "Asset classes must be unique"
    })
});

export const onboardingPreferencesSchema = personalizationPreferencesSchema.extend({
  riskDisclosureAccepted: z.literal(true)
});

export const feedInputSchema = z.object({
  schemaVersion: z.literal("investmade-feed-input/v1"),
  sessionId: z.string().min(1),
  epochId: z.string().min(1),
  policyVersion: z.literal(POLICY_VERSION),
  budget: z.object({
    periodBudgetBaseUnits: baseUnitsSchema,
    slotBudgetBaseUnits: baseUnitsSchema,
    maxCards: z.number().int().min(1)
  }),
  preferences: personalizationPreferencesSchema,
  candidates: z.array(candidateSchema),
  inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/)
});

export const feedCardSchema = z.object({
  assetId: z.string().min(1),
  action: z.literal("BUY"),
  rank: z.number().int().positive(),
  amountInBaseUnits: baseUnitsSchema,
  scoreBps: z.number().int().min(0).max(10_000),
  evidenceIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).max(280)
});

export const feedOutputSchema = z.object({
  schemaVersion: z.literal("investmade-feed-output/v1"),
  sessionId: z.string().min(1),
  inputCommitment: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policyVersion: z.literal(POLICY_VERSION),
  regime: z.enum(["CRYPTO_BULLISH", "CRYPTO_NEUTRAL", "CRYPTO_BEARISH", "RISK_OFF"]),
  cards: z.array(feedCardSchema),
  warnings: z.array(z.string())
});

export const selectedAssetSchema = z.object({
  assetId: z.string().min(1),
  amountInBaseUnits: baseUnitsSchema
});

export const executionRequestSchema = z.object({
  sessionId: z.string().min(1),
  chainId: z.literal(ROBINHOOD_CHAIN_ID),
  inputToken: z.literal(USDG_ADDRESS),
  periodLimitUsd: z.number().refine(isPeriodLimitUsd, {
    message: "Period limit must be from $10.00 to $100.00 in $0.01 increments."
  }).default(100),
  selections: z.array(selectedAssetSchema).min(1),
  slippageBps: z.number().int().min(1).max(100)
});

export const executionPlanSchema = z.object({
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  epochId: z.string().min(1),
  chainId: z.literal(ROBINHOOD_CHAIN_ID),
  inputToken: z.literal(USDG_ADDRESS),
  totalInputBaseUnits: baseUnitsSchema,
  authorizedPlanHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policyHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  callCommitments: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  quotes: z.array(quoteSchema).min(1),
  generatedAt: z.string().datetime()
});

export type Candidate = z.infer<typeof candidateSchema>;
export type PersonalizationPreferences = z.infer<typeof personalizationPreferencesSchema>;
export type OnboardingPreferences = z.infer<typeof onboardingPreferencesSchema>;
export type FeedInput = z.infer<typeof feedInputSchema>;
export type FeedOutput = z.infer<typeof feedOutputSchema>;
export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export type ExecutionPlan = z.infer<typeof executionPlanSchema>;

export function budgetForTicket(ticketSizeUsd: number, periodLimitUsd = 100) {
  const slotBudget = ticketSizeToBaseUnits(ticketSizeUsd);
  const periodBudget = ticketSizeToBaseUnits(periodLimitUsd);
  if (slotBudget > periodBudget) throw new Error("TICKET_EXCEEDS_PERIOD_LIMIT");
  return {
    periodBudgetBaseUnits: periodBudget.toString(),
    slotBudgetBaseUnits: slotBudget.toString(),
    maxCards: Number(periodBudget / slotBudget)
  };
}

export const DEFAULT_BUDGET = budgetForTicket(
  Number(DEFAULT_SLOT_BUDGET / 10n ** BigInt(USDG_DECIMALS))
);
