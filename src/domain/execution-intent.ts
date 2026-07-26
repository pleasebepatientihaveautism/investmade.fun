import { USDG_ADDRESS } from "./constants.js";
import type { ExecutionRequest } from "./schemas.js";

export function executionIntent(
	session: { id: string; epochId: string },
	request: ExecutionRequest,
) {
	return {
		version: "investmade-authorized-plan/v1" as const,
		sessionId: session.id,
		epochId: session.epochId,
		chainId: request.chainId,
		inputToken: USDG_ADDRESS,
		selections: [...request.selections].sort((left, right) =>
			left.assetId.localeCompare(right.assetId),
		),
		slippageBps: request.slippageBps,
	};
}
