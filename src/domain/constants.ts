export const ROBINHOOD_CHAIN_ID = 4663;
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;
export const WEEKLY_BUDGET = 100_000_000n;
export const SLOT_BUDGET = 10_000_000n;
export const MAX_CARDS = 10;
export const MAX_SLIPPAGE_BPS = 50;
export const MAX_PRICE_IMPACT_BPS = 100;
export const QUOTE_TTL_SECONDS = 60;
export const POLICY_VERSION = "investmade-policy/v1";

export const ASSET_REGISTRY = {
  WETH: {
    assetId: "rh:4663:WETH",
    symbol: "WETH",
    name: "Wrapped Ether",
    kind: "CRYPTO",
    address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    decimals: 18
  },
  AAPL: {
    assetId: "rh:4663:AAPL",
    symbol: "AAPL",
    name: "AAPL stock token",
    kind: "STOCK_TOKEN",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18
  },
  TSLA: {
    assetId: "rh:4663:TSLA",
    symbol: "TSLA",
    name: "TSLA stock token",
    kind: "STOCK_TOKEN",
    address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    decimals: 18
  }
} as const;

export type RegistryAsset = (typeof ASSET_REGISTRY)[keyof typeof ASSET_REGISTRY];
