import { CoinGeckoIconProvider } from "./adapters/coingecko.js";
import { DemoProvider } from "./adapters/demo.js";
import { LiveCandidateProvider } from "./adapters/live-candidates.js";
import { SubstreamsHistoryProvider } from "./adapters/substreams-history.js";
import { UniswapProvider } from "./adapters/uniswap.js";
import { ZeroGProvider } from "./adapters/zero-g.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresStateStore } from "./postgres-store.js";
import { MemoryStateStore } from "./store.js";

export function createServerApp() {
	const config = loadConfig();
	const demo = new DemoProvider();
	const required = (value: string | undefined, name: string) => {
		if (!value) throw new Error(`${name}_REQUIRED`);
		return value;
	};

	return createApp({
		config,
		store: config.demoMode
			? new MemoryStateStore()
			: new PostgresStateStore(required(config.DATABASE_URL, "DATABASE_URL")),
		candidates: config.demoMode
			? config.localLiveExecution
				? new LiveCandidateProvider(config)
				: demo
			: new LiveCandidateProvider(config),
		inference: config.ZG_ROUTER_API_KEY
			? new ZeroGProvider(config.ZG_ROUTER_API_KEY)
			: demo,
		execution: config.liveExecution
			? new UniswapProvider(required(config.UNISWAP_API_KEY, "UNISWAP_API_KEY"))
			: demo,
		icons: new CoinGeckoIconProvider(config.COINGECKO_API_KEY),
		history: config.SUBSTREAMS_API_TOKEN || config.THE_GRAPH_API_KEY
			? new SubstreamsHistoryProvider(
					config.SUBSTREAMS_API_TOKEN ?? config.THE_GRAPH_API_KEY ?? "",
					config.ROBINHOOD_RPC_URL,
				)
			: undefined,
	});
}
