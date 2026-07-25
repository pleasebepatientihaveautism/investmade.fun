export const ROBINHOOD_CHAIN_ID = 4663;
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;
export const PERIOD_BUDGET = 100_000_000n;
export const DEFAULT_SLOT_BUDGET = 10_000_000n;
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
  GME: {
    assetId: "rh:4663:GME",
    symbol: "GME",
    name: "GameStop stock token",
    kind: "STOCK_TOKEN",
    address: "0x1b0e319c6a659f002271b69db8a7df2f911c153e",
    decimals: 18
  },
  NVDA: {
    assetId: "rh:4663:NVDA",
    symbol: "NVDA",
    name: "NVIDIA stock token",
    kind: "STOCK_TOKEN",
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    decimals: 18
  },
  SPCX: {
    assetId: "rh:4663:SPCX",
    symbol: "SPCX",
    name: "SpaceX stock token",
    kind: "STOCK_TOKEN",
    address: "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea",
    decimals: 18
  },
  MSTR: {
    assetId: "rh:4663:MSTR",
    symbol: "MSTR",
    name: "Strategy Inc. stock token",
    kind: "STOCK_TOKEN",
    address: "0xec262a75e413fafd0df80480274532c79d42da09",
    decimals: 18
  },
  GOOGL: {
    assetId: "rh:4663:GOOGL",
    symbol: "GOOGL",
    name: "Alphabet Class A stock token",
    kind: "STOCK_TOKEN",
    address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3",
    decimals: 18
  },
  AAPL: {
    assetId: "rh:4663:AAPL",
    symbol: "AAPL",
    name: "Apple stock token",
    kind: "STOCK_TOKEN",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18
  },
  RDDT: {
    assetId: "rh:4663:RDDT",
    symbol: "RDDT",
    name: "Reddit stock token",
    kind: "STOCK_TOKEN",
    address: "0x05b37fb53a299a1b874a619e1c4c404d52c36f4c",
    decimals: 18
  },
  MSFT: {
    assetId: "rh:4663:MSFT",
    symbol: "MSFT",
    name: "Microsoft stock token",
    kind: "STOCK_TOKEN",
    address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74",
    decimals: 18
  },
  TSLA: {
    assetId: "rh:4663:TSLA",
    symbol: "TSLA",
    name: "Tesla stock token",
    kind: "STOCK_TOKEN",
    address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
    decimals: 18
  },
  COST: {
    assetId: "rh:4663:COST",
    symbol: "COST",
    name: "Costco stock token",
    kind: "STOCK_TOKEN",
    address: "0x4ea005168d7f09a7a0ba9d1def21a479950e44c2",
    decimals: 18
  },
  MU: {
    assetId: "rh:4663:MU",
    symbol: "MU",
    name: "Micron Technology stock token",
    kind: "STOCK_TOKEN",
    address: "0xff080c8ce2e5feadaca0da81314ae59d232d4afd",
    decimals: 18
  },
  USAR: {
    assetId: "rh:4663:USAR",
    symbol: "USAR",
    name: "USA Rare Earth stock token",
    kind: "STOCK_TOKEN",
    address: "0xd917b029c761d264c6a312bbbcda868658ef86a6",
    decimals: 18
  },
  INTC: {
    assetId: "rh:4663:INTC",
    symbol: "INTC",
    name: "Intel stock token",
    kind: "STOCK_TOKEN",
    address: "0xc72b96e0e48ecd4dc75e1e45396e26300bc39681",
    decimals: 18
  },
  COIN: {
    assetId: "rh:4663:COIN",
    symbol: "COIN",
    name: "Coinbase stock token",
    kind: "STOCK_TOKEN",
    address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b",
    decimals: 18
  },
  PLTR: {
    assetId: "rh:4663:PLTR",
    symbol: "PLTR",
    name: "Palantir Technologies stock token",
    kind: "STOCK_TOKEN",
    address: "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a",
    decimals: 18
  }
} as const;

/** Public domains used by the AllInvestView ticker-logo CDN for stock token marks. */
export const STOCK_LOGO_DOMAINS: Record<string, string> = {
  GME: "gamestop.com",
  NVDA: "nvidia.com",
  SPCX: "spacex.com",
  MSTR: "strategy.com",
  GOOGL: "google.com",
  AAPL: "apple.com",
  RDDT: "reddit.com",
  MSFT: "microsoft.com",
  TSLA: "tesla.com",
  COST: "costco.com",
  MU: "micron.com",
  USAR: "usare.com",
  INTC: "intel.com",
  COIN: "coinbase.com",
  PLTR: "palantir.com"
};

export type RegistryAsset = (typeof ASSET_REGISTRY)[keyof typeof ASSET_REGISTRY];
