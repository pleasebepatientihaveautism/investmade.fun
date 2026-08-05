import { CoinGeckoIconProvider } from "./adapters/coingecko.js";
import { DemoProvider } from "./adapters/demo.js";
import { DeterministicRanker } from "./adapters/deterministic-ranker.js";
import { LiveCandidateProvider } from "./adapters/live-candidates.js";
import { JupiterProvider } from "./adapters/jupiter.js";
import type { ExecutionProviderId } from "../domain/schemas.js";
import type {
	CandidateProvider,
	ExecutionProvider,
} from "./adapters/types.js";
import { UniswapProvider } from "./adapters/uniswap.js";
import { ZeroExProvider } from "./adapters/zero-ex.js";
import { ZeroExSolanaProvider } from "./adapters/zero-ex-solana.js";
import { ZeroGProvider } from "./adapters/zero-g.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { PostgresStateStore } from "./postgres-store.js";
import { MemoryStateStore } from "./store.js";

export function createServerApp() {
	const config = loadConfig();
	const demo = new DemoProvider();
	const demoUniswap = new DemoProvider("UNISWAP");
	const deterministic = new DeterministicRanker();
	const required = (value: string | undefined, name: string) => {
		if (!value) throw new Error(`${name}_REQUIRED`);
		return value;
	};
	const store = config.demoMode
		? new MemoryStateStore()
		: new PostgresStateStore(required(config.DATABASE_URL, "DATABASE_URL"));
	const coinGecko = new CoinGeckoIconProvider(
		config.COINGECKO_API_KEY,
		fetch,
		store,
	);
	const executionProviders: Partial<
		Record<ExecutionProviderId, ExecutionProvider>
	> = {};
	const solanaExecutionProviders: Partial<
		Record<ExecutionProviderId, ExecutionProvider>
	> = {};
	const solanaCandidateProviders: Partial<
		Record<ExecutionProviderId, CandidateProvider>
	> = {};
	let jupiterProvider: JupiterProvider | undefined;
	if (config.ZERO_EX_API_KEY) {
		executionProviders.ZERO_EX = new ZeroExProvider(config.ZERO_EX_API_KEY);
	}
	if (config.UNISWAP_API_KEY) {
		executionProviders.UNISWAP = new UniswapProvider(config.UNISWAP_API_KEY);
	}
	if (
		config.JUPITER_API_KEY &&
		config.SOLANA_RPC_URL &&
		config.SOLANA_WS_URL
	) {
		jupiterProvider = new JupiterProvider(
			config.JUPITER_API_KEY,
			config.SOLANA_RPC_URL,
			fetch,
			store,
		);
		solanaExecutionProviders.JUPITER = jupiterProvider;
		solanaCandidateProviders.JUPITER = jupiterProvider;
		if (config.ZERO_EX_API_KEY) {
			const zeroExSolana = new ZeroExSolanaProvider(
				config.ZERO_EX_API_KEY,
				config.SOLANA_RPC_URL,
				jupiterProvider,
			);
			solanaExecutionProviders.ZERO_EX = zeroExSolana;
			solanaCandidateProviders.ZERO_EX = zeroExSolana;
		}
	}
	const candidateProviders: Partial<
		Record<ExecutionProviderId, CandidateProvider>
	> = {};
	if (config.liveExecution) {
		for (const id of ["ZERO_EX", "UNISWAP"] as const) {
			const execution = executionProviders[id];
			if (execution) {
				candidateProviders[id] = new LiveCandidateProvider(config, execution);
			}
		}
	}
	const defaultExecution =
		executionProviders.ZERO_EX ?? executionProviders.UNISWAP ?? demo;
	const defaultCandidates =
		candidateProviders.ZERO_EX ?? candidateProviders.UNISWAP ?? demo;
	const zeroG = config.ZG_ROUTER_API_KEY
		? new ZeroGProvider(config.ZG_ROUTER_API_KEY)
		: undefined;
	const inference = zeroG ?? deterministic;

	return createApp({
		config,
		store,
		candidates: defaultCandidates,
		candidateProviders: config.liveExecution
			? candidateProviders
			: { ZERO_EX: demo, UNISWAP: demoUniswap },
		inference,
		rankingProviders: {
			...(zeroG ? { ZERO_G: zeroG } : {}),
			DETERMINISTIC: deterministic,
		},
		execution: defaultExecution,
		executionProviders: config.liveExecution
			? executionProviders
			: { ZERO_EX: demo, UNISWAP: demoUniswap },
		solanaExecutionProviders,
		solanaCandidateProviders,
		icons: coinGecko,
		marketData: coinGecko,
		history: coinGecko,
	});
}
