import { createGrpcTransport } from "@connectrpc/connect-node";
import {
	createAuthInterceptor,
	createRegistry,
	createRequest,
	fetchSubstream,
	streamBlocks,
	unpackMapOutput,
} from "@substreams/core";
import { createPublicClient, http } from "viem";
import {
	ASSET_REGISTRY,
	type RegistryAsset,
	USDG_ADDRESS,
	USDG_DECIMALS,
} from "../../domain/constants.js";

const PACKAGE_URL =
	"https://api.substreams.dev/v1/packages/investmade-robinhood-uniswap-v4/v0.1.1";
const ENDPOINT = "https://robinhood.substreams.pinax.network";
const INITIAL_BLOCK = 9070;
const CACHE_MS = 60_000;
const MAX_POINTS = 80;
const STREAM_TIMEOUT_MS = 8_000;

export type SubstreamsEvent = {
	initializes?: Array<{
		poolId?: string;
		currency0?: string;
		currency1?: string;
	}>;
	swaps?: Array<{
		poolId?: string;
		timestamp?: string | number;
		sqrtPriceX96?: string;
	}>;
};

export type PricePoint = { timestamp: number; price: number };

export class SubstreamsHistoryProvider {
	private cache?: { expiresAt: number; histories: Map<string, PricePoint[]> };
	private inFlight?: Promise<Map<string, PricePoint[]>>;
	private readonly client;

	constructor(
		private readonly token: string,
		rpcUrl: string,
	) {
		this.client = createPublicClient({ transport: http(rpcUrl) });
	}

	async history(asset: RegistryAsset): Promise<PricePoint[]> {
		const histories = await this.allHistories();
		return histories.get(asset.assetId) ?? [];
	}

	private async allHistories(): Promise<Map<string, PricePoint[]>> {
		if (this.cache && this.cache.expiresAt > Date.now()) {
			return this.cache.histories;
		}
		if (this.inFlight) return this.inFlight;
		this.inFlight = this.loadWithTimeout()
			.then((histories) => {
				this.cache = { expiresAt: Date.now() + CACHE_MS, histories };
				return histories;
			})
			.finally(() => {
				this.inFlight = undefined;
			});
		return this.inFlight;
	}

	private async loadWithTimeout(): Promise<Map<string, PricePoint[]>> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error("Substreams history request timed out")),
				STREAM_TIMEOUT_MS,
			);
		});
		try {
			return await Promise.race([this.load(), timeout]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	private async load(): Promise<Map<string, PricePoint[]>> {
		const [substream, head] = await Promise.all([
			fetchSubstream(PACKAGE_URL),
			this.client.getBlockNumber(),
		]);
		const registry = createRegistry(substream);
		const transport = createGrpcTransport({
			baseUrl: ENDPOINT,
			httpVersion: "2",
			interceptors: [createAuthInterceptor(this.token)],
			jsonOptions: { typeRegistry: registry },
		});
		const request = createRequest({
			substreamPackage: substream,
			outputModule: "map_events",
			productionMode: true,
			startBlockNum: INITIAL_BLOCK,
			stopBlockNum: head + 1n,
		});
		const events: SubstreamsEvent[] = [];
		for await (const response of streamBlocks(transport, request, {
			signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
		})) {
			const output = unpackMapOutput(response, registry);
			if (output) events.push(output.toJson({ typeRegistry: registry }) as SubstreamsEvent);
		}
		return buildPriceHistories(events);
	}
}

export function priceFromSqrtPriceX96(
	sqrtPriceX96: string,
	decimals0: number,
	decimals1: number,
): number {
	const sqrtRatio = Number(BigInt(sqrtPriceX96)) / 2 ** 96;
	return sqrtRatio ** 2 * 10 ** (decimals0 - decimals1);
}

export function buildPriceHistories(
	events: SubstreamsEvent[],
): Map<string, PricePoint[]> {
	const assets = Object.values(ASSET_REGISTRY);
	const stable = USDG_ADDRESS.toLowerCase();
	const pools = new Map<
		string,
		{ asset: RegistryAsset; assetIsCurrency0: boolean }
	>();
	const histories = new Map<string, PricePoint[]>();

	for (const event of events) {
		for (const initialized of event.initializes ?? []) {
			const currency0 = initialized.currency0?.toLowerCase();
			const currency1 = initialized.currency1?.toLowerCase();
			const asset = assets.find(
				(item) =>
					item.address.toLowerCase() ===
					(currency0 === stable ? currency1 : currency0),
			);
			if (
				initialized.poolId &&
				asset &&
				(currency0 === stable || currency1 === stable)
			) {
				pools.set(initialized.poolId, {
					asset,
					assetIsCurrency0: currency0 === asset.address.toLowerCase(),
				});
			}
		}
		for (const swap of event.swaps ?? []) {
			const pool = swap.poolId ? pools.get(swap.poolId) : undefined;
			if (!pool || !swap.sqrtPriceX96 || swap.timestamp === undefined) continue;
			const price1Per0 = priceFromSqrtPriceX96(
				swap.sqrtPriceX96,
				pool.assetIsCurrency0 ? pool.asset.decimals : USDG_DECIMALS,
				pool.assetIsCurrency0 ? USDG_DECIMALS : pool.asset.decimals,
			);
			const price = pool.assetIsCurrency0 ? price1Per0 : 1 / price1Per0;
			if (!Number.isFinite(price) || price <= 0) continue;
			const points = histories.get(pool.asset.assetId) ?? [];
			points.push({ timestamp: Number(swap.timestamp), price });
			histories.set(pool.asset.assetId, points.slice(-MAX_POINTS));
		}
	}
	return histories;
}
