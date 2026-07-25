import { PrivyClient, type LinkedAccount } from "@privy-io/node";
import type { Request } from "express";
import { addressSchema } from "../domain/schemas.js";

export class PrivyWalletAuth {
  private readonly client: PrivyClient;

  constructor(appId: string, appSecret: string) {
    this.client = new PrivyClient({ appId, appSecret });
  }

  async wallet(request: Request): Promise<string> {
    const token = bearerToken(request);
    const requestedWallet = addressSchema
      .parse(request.header("x-wallet-address"))
      .toLowerCase();
    const claims = await this.client.utils().auth().verifyAccessToken(token);
    const user = await this.client.users()._get(claims.user_id);
    const linked = user.linked_accounts.some(
      (account) =>
        isEthereumWallet(account) && account.address.toLowerCase() === requestedWallet
    );
    if (!linked) throw new Error("WALLET_NOT_LINKED_TO_PRIVY_USER");
    return requestedWallet;
  }
}

export function isEthereumWallet(
  account: LinkedAccount
): account is Extract<LinkedAccount, { type: "wallet"; chain_type: "ethereum" }> {
  return account.type === "wallet" && account.chain_type === "ethereum";
}

function bearerToken(request: Request): string {
  const authorization = request.header("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) throw new Error("PRIVY_ACCESS_TOKEN_REQUIRED");
  return match[1];
}
