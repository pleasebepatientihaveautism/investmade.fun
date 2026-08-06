import { type LinkedAccount, PrivyClient } from "@privy-io/node";
import type { Request } from "express";
import {
	addressSchema,
	appChainSchema,
	solanaAddressSchema,
} from "../domain/schemas.js";

export class PrivyWalletAuth {
	private readonly client: PrivyClient;

	constructor(appId: string, appSecret: string) {
		this.client = new PrivyClient({ appId, appSecret });
	}

	async actor(request: Request): Promise<ExecutionActor> {
		const token = bearerToken(request);
		const chain = appChainSchema
			.optional()
			.default("ROBINHOOD")
			.parse(request.header("x-wallet-chain"));
		const requestedWallet =
			chain === "SOLANA"
				? solanaAddressSchema.parse(request.header("x-wallet-address"))
				: addressSchema
						.parse(request.header("x-wallet-address"))
						.toLowerCase();
		const requestedTxOrigin =
			chain === "SOLANA"
				? requestedWallet
				: addressSchema
						.parse(request.header("x-tx-origin-address"))
						.toLowerCase();
		const claims = await this.client.utils().auth().verifyAccessToken(token);
		const user = await this.client.users()._get(claims.user_id);
		return {
			...executionActorFromLinkedAccounts(
			user.linked_accounts,
			requestedWallet,
			requestedTxOrigin,
			chain,
			),
			userId: claims.user_id,
		};
	}
}

export type ExecutionActor = {
	userId: string;
	wallet: string;
	txOrigin: string;
	chain: "ROBINHOOD" | "SOLANA";
};

export function executionActorFromLinkedAccounts(
	accounts: LinkedAccount[],
	requestedWallet: string,
	requestedTxOrigin: string,
	chain: "ROBINHOOD" | "SOLANA" = "ROBINHOOD",
): Omit<ExecutionActor, "userId"> {
	if (chain === "SOLANA") {
		const wallet = solanaAddressSchema.parse(requestedWallet);
		const walletLinked = accounts.some(
			(account) =>
				isSolanaWallet(account) && account.address === wallet,
		);
		if (!walletLinked) throw new Error("SOLANA_WALLET_NOT_LINKED_TO_PRIVY_USER");
		return { wallet, txOrigin: wallet, chain };
	}
	const wallet = addressSchema.parse(requestedWallet).toLowerCase();
	const txOrigin = addressSchema.parse(requestedTxOrigin).toLowerCase();
	const smartWalletLinked = accounts.some(
		(account) =>
			account.type === "smart_wallet" &&
			account.address.toLowerCase() === wallet,
	);
	const ownerLinked = accounts.some(
		(account) =>
			isEthereumWallet(account) && account.address.toLowerCase() === txOrigin,
	);
	if (!smartWalletLinked)
		throw new Error("SMART_WALLET_NOT_LINKED_TO_PRIVY_USER");
	if (!ownerLinked) throw new Error("TX_ORIGIN_NOT_LINKED_TO_PRIVY_USER");
	return { wallet, txOrigin, chain };
}

export function isInvestmadeWallet(
	account: LinkedAccount,
): account is Extract<
	LinkedAccount,
	{ type: "wallet"; chain_type: "ethereum" } | { type: "smart_wallet" }
> {
	return account.type === "smart_wallet" || isEthereumWallet(account);
}

export function isEthereumWallet(
	account: LinkedAccount,
): account is Extract<
	LinkedAccount,
	{ type: "wallet"; chain_type: "ethereum" }
> {
	return account.type === "wallet" && account.chain_type === "ethereum";
}

export function isSolanaWallet(
	account: LinkedAccount,
): account is Extract<LinkedAccount, { type: "wallet"; chain_type: "solana" }> {
	return account.type === "wallet" && account.chain_type === "solana";
}

function bearerToken(request: Request): string {
	const authorization = request.header("authorization");
	const match = authorization?.match(/^Bearer ([^\s]+)$/i);
	if (!match?.[1]) throw new Error("PRIVY_ACCESS_TOKEN_REQUIRED");
	return match[1];
}
