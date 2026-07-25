import type { LinkedAccount } from "@privy-io/node";
import { describe, expect, it } from "vitest";
import { isEthereumWallet } from "../src/server/auth.js";

describe("Privy linked wallet boundary", () => {
  it("accepts an Ethereum wallet account", () => {
    expect(
      isEthereumWallet({
        type: "wallet",
        chain_type: "ethereum",
        address: "0x71f30000000000000000000000000000000009a2"
      } as LinkedAccount)
    ).toBe(true);
  });

  it("rejects non-Ethereum and non-wallet accounts", () => {
    expect(
      isEthereumWallet({
        type: "wallet",
        chain_type: "solana",
        address: "8VQwqjke"
      } as LinkedAccount)
    ).toBe(false);
    expect(
      isEthereumWallet({
        type: "email",
        address: "user@example.com"
      } as LinkedAccount)
    ).toBe(false);
  });
});
