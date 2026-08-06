import { describe, expect, it } from "vitest";
import { ASSET_REGISTRY } from "../src/domain/constants.js";

describe("runtime Robinhood stock registry boundary", () => {
	it("keeps only deterministic demo/community assets checked in", () => {
		expect(ASSET_REGISTRY.AAPL?.assetId).toBe("rh:4663:AAPL");
		expect(ASSET_REGISTRY.WETH?.kind).toBe("CRYPTO");
		expect(ASSET_REGISTRY.STEEL?.symbol).toBe("STEEL");
		expect(ASSET_REGISTRY.YOINK?.symbol).toBe("YOINK");
		expect(Object.keys(ASSET_REGISTRY).length).toBeLessThan(25);
	});
});
