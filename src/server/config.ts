import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    INVESTMADE_DEMO_MODE: z.enum(["true", "false"]).default("true"),
    LOCAL_LIVE_EXECUTION: z.enum(["true", "false"]).default("false"),
    PORT: z.coerce.number().int().positive().default(8787),
    PUBLIC_ORIGIN: z.string().url().default("http://localhost:5173"),
    SESSION_SECRET: z.string().min(32).default("local-demo-only-secret-change-me-000"),
    PRIVY_APP_ID: z.string().min(1),
    PRIVY_APP_SECRET: z.string().min(1),
    DATABASE_URL: z.string().optional(),
    UNISWAP_API_KEY: z.string().optional(),
    SUBSTREAMS_API_TOKEN: z.string().optional(),
    THE_GRAPH_API_KEY: z.string().optional(),
    COINGECKO_API_KEY: z.string().optional(),
    ZG_ROUTER_API_KEY: z.string().optional(),
    WORLD_APP_ID: z.string().optional(),
    WORLD_RP_ID: z.string().optional(),
    WORLD_RP_SIGNING_KEY: z.string().optional(),
    WORLD_ACTION: z.string().default("investmade-human-v1"),
    ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com")
  })
  .superRefine((env, context) => {
    if (env.LOCAL_LIVE_EXECUTION === "true" && env.INVESTMADE_DEMO_MODE !== "true") {
      context.addIssue({
        code: "custom",
        path: ["LOCAL_LIVE_EXECUTION"],
        message: "LOCAL_LIVE_EXECUTION is only supported with INVESTMADE_DEMO_MODE=true"
      });
    }
    if (env.LOCAL_LIVE_EXECUTION === "true" && env.NODE_ENV === "production") {
      context.addIssue({
        code: "custom",
        path: ["LOCAL_LIVE_EXECUTION"],
        message: "LOCAL_LIVE_EXECUTION must not run in production"
      });
    }
    if (env.INVESTMADE_DEMO_MODE === "false") {
      for (const key of [
        "DATABASE_URL",
        "UNISWAP_API_KEY",
        "ZG_ROUTER_API_KEY"
      ] as const) {
        if (!env[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when INVESTMADE_DEMO_MODE=false`
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema> & {
  demoMode: boolean;
  localLiveExecution: boolean;
  liveExecution: boolean;
  worldVerificationConfigured: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  const demoMode = parsed.INVESTMADE_DEMO_MODE === "true";
  const localLiveExecution = parsed.LOCAL_LIVE_EXECUTION === "true";
  const worldVerificationConfigured = Boolean(
    parsed.WORLD_APP_ID && parsed.WORLD_RP_ID && parsed.WORLD_RP_SIGNING_KEY
  );
  return {
    ...parsed,
    demoMode,
    localLiveExecution,
    liveExecution: localLiveExecution || !demoMode,
    worldVerificationConfigured
  };
}
