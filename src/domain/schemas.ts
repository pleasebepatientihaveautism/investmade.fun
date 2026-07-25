import { z } from "zod";
import {
  MAX_CARDS,
  POLICY_VERSION,
  ROBINHOOD_CHAIN_ID,
  DEFAULT_SLOT_BUDGET,
  PERIOD_BUDGET,
  USDG_ADDRESS,
  USDG_DECIMALS
} from "./constants.js";

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const baseUnitsSchema = z.string().regex(/^[0-9]+$/);

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
  ticketSizeUsd: z.number().int().min(1).max(100),
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
    maxCards: z.number().int().min(1).max(MAX_CARDS)
  }),
  preferences: personalizationPreferencesSchema,
  candidates: z.array(candidateSchema).max(MAX_CARDS),
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
  cards: z.array(feedCardSchema).max(MAX_CARDS),
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
  selections: z.array(selectedAssetSchema).min(1).max(MAX_CARDS),
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

export function budgetForTicket(ticketSizeUsd: number) {
  const slotBudget = BigInt(ticketSizeUsd) * 10n ** BigInt(USDG_DECIMALS);
  return {
    periodBudgetBaseUnits: PERIOD_BUDGET.toString(),
    slotBudgetBaseUnits: slotBudget.toString(),
    maxCards: Math.min(MAX_CARDS, Number(PERIOD_BUDGET / slotBudget))
  };
}

export const DEFAULT_BUDGET = budgetForTicket(
  Number(DEFAULT_SLOT_BUDGET / 10n ** BigInt(USDG_DECIMALS))
);
