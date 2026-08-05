import {
	executionRequestSchema,
	type ExecutionRequest,
} from "./schemas.js";

export function executionIntent(
	session: {
		id: string;
		epochId: string;
		executionProvider: "ZERO_EX" | "UNISWAP" | "JUPITER";
		chain: "ROBINHOOD" | "SOLANA";
		wallet: string;
	},
	request: ExecutionRequest,
) {
	const parsed = executionRequestSchema.parse(request);
	return {
		version: "investmade-authorized-plan/v3" as const,
		sessionId: session.id,
		epochId: session.epochId,
		provider: session.executionProvider,
		chain: parsed.chain,
		network:
			parsed.chain === "ROBINHOOD"
				? { chainId: parsed.chainId }
				: { cluster: parsed.cluster },
		signingWallet: session.wallet,
		inputToken: parsed.inputToken,
		selections: [...parsed.selections].sort((left, right) =>
			left.assetId.localeCompare(right.assetId),
		),
		slippageBps: parsed.slippageBps,
	};
}
