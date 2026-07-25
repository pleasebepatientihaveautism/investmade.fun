import { DemoProvider } from "./adapters/demo.js";
import { UniswapProvider } from "./adapters/uniswap.js";
import { ZeroGProvider } from "./adapters/zero-g.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStateStore } from "./store.js";
import { PostgresStateStore } from "./postgres-store.js";
import { LiveCandidateProvider } from "./adapters/live-candidates.js";
import { CoinGeckoIconProvider } from "./adapters/coingecko.js";

loadEnvironment({ path: ".env.local" });
loadEnvironment({ path: ".env" });

const config = loadConfig();
const demo = new DemoProvider();
const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

const app = createApp({
  config,
  store: config.demoMode
    ? new MemoryStateStore()
    : new PostgresStateStore(required(config.DATABASE_URL, "DATABASE_URL")),
  candidates: config.demoMode
    ? config.localLiveExecution
      ? new LiveCandidateProvider(config)
      : demo
    : new LiveCandidateProvider(config),
  inference: config.demoMode
    ? demo
    : new ZeroGProvider(required(config.ZG_ROUTER_API_KEY, "ZG_ROUTER_API_KEY")),
  execution: config.liveExecution
    ? new UniswapProvider(required(config.UNISWAP_API_KEY, "UNISWAP_API_KEY"))
    : demo,
  icons: new CoinGeckoIconProvider(config.COINGECKO_API_KEY)
});

app.listen(config.PORT, () => {
  console.log(
    JSON.stringify({
      event: "server_started",
      port: config.PORT,
      mode: config.localLiveExecution ? "local-live" : config.demoMode ? "demo" : "live"
    })
  );
});
import { config as loadEnvironment } from "dotenv";
