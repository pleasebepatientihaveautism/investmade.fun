import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY, USDG_ADDRESS } from "../src/domain/constants.js";
import {
	buildPriceHistories,
	priceFromSqrtPriceX96,
} from "../src/server/adapters/substreams-history.js";

describe("Substreams price history", () => {
	it("maps Uniswap v4 sqrt prices into the matching USDG asset history", () => {
		const sqrtOne = (2n ** 96n).toString();
		expect(priceFromSqrtPriceX96(sqrtOne, 18, 18)).toBe(1);

		const weth = ASSET_REGISTRY.WETH;
		if (!weth) throw new Error("WETH fixture missing");
		const histories = buildPriceHistories([
			{
				initializes: [
					{
						poolId: "pool",
						currency0: weth.address,
						currency1: USDG_ADDRESS,
					},
				],
				swaps: [
					{ poolId: "pool", timestamp: "123", sqrtPriceX96: sqrtOne },
				],
			},
		]);

		expect(histories.get(weth.assetId)).toEqual([
			{ timestamp: 123, price: 1_000_000_000_000 },
		]);
	});
});
