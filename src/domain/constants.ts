export const ROBINHOOD_CHAIN_ID = 4663;
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;
export const PERIOD_BUDGET = 100_000_000n;
export const DEFAULT_SLOT_BUDGET = 10_000_000n;
/** Candidate discovery page size. This limits request latency, not basket size. */
export const FEED_PAGE_SIZE = 10;
export const MAX_SLIPPAGE_BPS = 50;
export const MAX_PRICE_IMPACT_BPS = 100;
/** Community routes are opt-in Degen-only and capped at 10% price impact. */
export const MAX_DEGEN_PRICE_IMPACT_BPS = 1_000;
export const QUOTE_TTL_SECONDS = 60;
export const POLICY_VERSION = "investmade-policy/v1";

const CURATED_ASSET_REGISTRY = {
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

/**
 * Community tokens discovered in live Robinhood Chain Uniswap pools. They are
 * intentionally available only when a user opts into Degen mode. Every route
 * is still re-quoted live before it can be shown or executed.
 */
export const DEGEN_COMMUNITY_ASSETS = {
  STEEL: {
    assetId: "rh:4663:community:0af77e27f535256965944e617a386570f5c0432a",
    symbol: "STEEL",
    name: "Steel",
    kind: "CRYPTO" as const,
    address: "0x0AF77e27F535256965944E617a386570f5C0432a",
    decimals: 18
  },
  YOINK: {
    assetId: "rh:4663:community:a2718f80f1fe0cdec69c9023ee006807dd487a8c",
    symbol: "YOINK",
    name: "YOINK",
    kind: "CRYPTO" as const,
    address: "0xA2718f80f1FE0CdeC69c9023ee006807dD487a8c",
    decimals: 18
  }
} as const;

export const DEGEN_COMMUNITY_ASSET_IDS = new Set<string>(
  Object.values(DEGEN_COMMUNITY_ASSETS).map((asset) => asset.assetId)
);

export function isDegenCommunityAsset(assetId: string): boolean {
  return DEGEN_COMMUNITY_ASSET_IDS.has(assetId);
}

/**
 * The canonical Uniswap verified-token list for Robinhood Chain, plus WETH
 * which is the currently supported non-stock output route. This list is a
 * candidate universe; every token must still pass live permission, health, and
 * quote gates before it can appear in a basket or be signed.
 */
export const ASSET_REGISTRY: Record<string, RegistryAsset> = {
  WETH: CURATED_ASSET_REGISTRY.WETH,
  ...DEGEN_COMMUNITY_ASSETS,
  ...Object.fromEntries(
    UNISWAP_ROBINHOOD_TOKENS.map((token) => [
      token.symbol,
      {
        assetId: `rh:4663:${token.symbol}`,
        symbol: token.symbol,
        name: `${token.name} stock token`,
        kind: "STOCK_TOKEN" as const,
        address: token.address,
        decimals: token.decimals
      }
    ])
  )
};

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

/**
 * CoinGecko IDs matched by Robinhood Chain contract address on 2026-07-26.
 * ARM, DRAM, NASA, NOK, and RVI are not listed by CoinGecko and keep the
 * existing stock-logo fallback.
 */
export const COINGECKO_COIN_IDS: Record<string, string> = {
  ETH: "ethereum",
  USDG: "global-dollar",
  WETH: "robinhood-wrapped-eth-robinhood-chain",
  STEEL: "steel-2",
  YOINK: "yoink-4",
  AAOI: "applied-optoelectronics-robinhood-tokenized-stock",
  AAPL: "apple-robinhood-tokenized-stock",
  AMAT: "applied-materials-robinhood-tokenized-stock",
  AMD: "amd-robinhood-tokenized-stock",
  AMZN: "amazon-robinhood-tokenized-stock",
  APLD: "applied-digital-robinhood-tokenized-stock",
  ASML: "asml-holding-nv-robinhood-tokenized-stock",
  ASTS: "ast-spacemobile-robinhood-tokenized-stock",
  AVGO: "broadcom-robinhood-tokenized-stock",
  BA: "boeing-robinhood-tokenized-stock",
  BABA: "alibaba-robinhood-tokenized-stock",
  BE: "bloom-energy-robinhood-tokenized-stock",
  CBRS: "cerebras-systems-robinhood-tokenized-stock",
  CCL: "carnival-corporation-robinhood-tokenized-stock",
  CELH: "celsius-robinhood-tokenized-stock",
  CLSK: "cleanspark-robinhood-tokenized-stock",
  COIN: "coinbase-robinhood-tokenized-stock",
  COST: "costco-robinhood-tokenized-stock",
  CRCL: "circle-internet-group-robinhood-tokenized-stock",
  CRWD: "crowdstrike-holdings-robinhood-tokenized-stock",
  CRWV: "coreweave-robinhood-tokenized-stock",
  DDOG: "datadog-robinhood-tokenized-stock",
  DELL: "dell-robinhood-tokenized-stock",
  ELF: "e-l-f-beauty-robinhood-tokenized-stock",
  EWY: "ishares-msci-south-korea-fund-robinhood-tokenized-stock",
  F: "ford-motor-robinhood-tokenized-stock",
  FLNC: "fluence-energy-robinhood-tokenized-stock",
  FUTU: "futu-holdings-robinhood-tokenized-stock",
  GLW: "corning-robinhood-tokenized-stock",
  GME: "gamestop-robinhood-tokenized-stock",
  GOOGL: "alphabet-class-a-robinhood-tokenized-stock",
  INOD: "innodata-robinhood-tokenized-stock",
  INTC: "intel-robinhood-tokenized-stock",
  INTU: "intuit-robinhood-tokenized-stock",
  IONQ: "ionq-robinhood-tokenized-stock",
  IREN: "iren-limited-robinhood-tokenized-stock",
  LITE: "lumentum-robinhood-tokenized-stock",
  LLY: "eli-lilly-robinhood-tokenized-stock",
  LULU: "lululemon-robinhood-tokenized-stock",
  LUNR: "intuitive-machines-robinhood-tokenized-stock",
  MDB: "mongodb-robinhood-tokenized-stock",
  META: "meta-platforms-robinhood-tokenized-stock",
  MRVL: "marvell-technology-robinhood-tokenized-stock",
  MSFT: "microsoft-robinhood-tokenized-stock",
  MSTR: "strategy-inc-robinhood-tokenized-stock",
  MU: "micron-technology-robinhood-tokenized-stock",
  MXL: "maxlinear-robinhood-tokenized-stock",
  NBIS: "nebius-group-robinhood-tokenized-stock",
  NFLX: "netflix-robinhood-tokenized-stock",
  NNE: "nano-nuclear-energy-robinhood-tokenized-stock",
  NOW: "servicenow-robinhood-tokenized-stock",
  NU: "nu-robinhood-tokenized-stock",
  NVDA: "nvidia-robinhood-tokenized-stock",
  NVTS: "navitas-semiconductor-robinhood-tokenized-stock",
  ORCL: "oracle-robinhood-tokenized-stock",
  P: "everpure-robinhood-tokenized-stock",
  PENG: "penguin-solutions-robinhood-tokenized-stock",
  PLTR: "palantir-technologies-robinhood-tokenized-stock",
  POET: "poet-technologies-robinhood-tokenized-stock",
  PR: "permian-resources-robinhood-tokenized-stock",
  QBTS: "d-wave-quantum-robinhood-tokenized-stock",
  QCOM: "qualcomm-robinhood-tokenized-stock",
  QQQ: "invesco-qqq-robinhood-tokenized-stock",
  QUBT: "quantum-computing-robinhood-tokenized-stock",
  RBLX: "roblox-robinhood-tokenized-stock",
  RDDT: "reddit-robinhood-tokenized-stock",
  RDW: "redwire-robinhood-tokenized-stock",
  RGTI: "rigetti-computing-robinhood-tokenized-stock",
  RIVN: "rivian-automotive-robinhood-tokenized-stock",
  RKLB: "rocket-lab-corporation-robinhood-tokenized-stock",
  SATS: "echostar-robinhood-tokenized-stock",
  SGOV: "ishares-0-3-month-treasury-bond-etf-robinhood-tokenized-stock",
  SHOP: "shopify-robinhood-tokenized-stock",
  SLV: "ishares-silver-trust-robinhood-tokenized-stock",
  SMCI: "super-micro-computer-robinhood-tokenized-stock",
  SNDK: "sandisk-corporation-robinhood-tokenized-stock",
  SOFI: "sofi-technologies-robinhood-tokenized-stock",
  SOXX: "ishares-semiconductor-etf-robinhood-tokenized-stock",
  SPCX: "spacex-robinhood-tokenized-stock",
  SPMO: "invesco-s-p-500-momentum-etf-robinhood-tokenized-stock",
  SPY: "spdr-s-p-500-etf-trust-robinhood-tokenized-stock",
  TSEM: "tower-semiconductor-robinhood-tokenized-stock",
  TSLA: "tesla-robinhood-tokenized-stock",
  TSM: "taiwan-semiconductor-manufacturing-robinhood-tokenized-stock",
  TTWO: "take-two-interactive-software-robinhood-tokenized-stock",
  UMC: "united-microelectronics-robinhood-tokenized-stock",
  UPS: "ups-robinhood-tokenized-stock",
  USAR: "usa-rare-earth-robinhood-tokenized-stock",
  USO: "united-states-oil-fund-robinhood-tokenized-stock",
  WDAY: "workday-robinhood-tokenized-stock",
  XLK: "state-street-technology-select-sector-spdr-etf-robinhood-tokenized-stock",
  XNDU: "xanadu-quantum-robinhood-tokenized-stock",
  XOM: "exxon-mobil-robinhood-tokenized-stock",
  ZM: "zoom-robinhood-tokenized-stock",
  ZS: "zscaler-robinhood-tokenized-stock"
};

/**
 * Company marks parsed from Forge's public company directory and stored
 * locally so the app does not hotlink Forge or depend on its Cloudflare gate.
 * Symbols without a Forge directory match fall back to the ticker-logo flow.
 */
export const FORGE_STOCK_ICONS: Record<string, string> = {
  CBRS: "/assets/forge/cbrs.webp",
  CRCL: "/assets/forge/crcl.webp",
  CRWV: "/assets/forge/crwv.webp",
  RDDT: "/assets/forge/rddt.webp",
  SPCX: "/assets/forge/spcx.webp"
};

export type RegistryAsset = {
  assetId: string;
  symbol: string;
  name: string;
  kind: "CRYPTO" | "STOCK_TOKEN";
  address: string;
  decimals: number;
};
import { UNISWAP_ROBINHOOD_TOKENS } from "./uniswap-robinhood-tokens.js";
