# investmade.fun

investmade.fun is a non-custodial, fixed-budget allocation app for Robinhood Chain. A user sets a daily, weekly, or monthly spending limit, chooses the USDG amount represented by each decision, receives a ranked feed of executable crypto and tokenized-stock routes, builds a basket, and explicitly signs the complete basket.

The current product is user-controlled. It does not hold funds, run an autonomous mandate, or let an AI sign transactions. The backend ranks and validates; the Privy smart wallet signs and broadcasts.

## Current status

The repository currently implements:

- A React/Vite frontend with onboarding, Basket, Portfolio, Activity, Account, and wallet-management surfaces.
- Privy login, an embedded signer, and a canonical ERC-4337 Investmade Wallet on Robinhood Chain (`4663`).
- Five-question onboarding for cadence, period limit, ticket size, risk preference, and asset mix, followed by a risk acknowledgement.
- Account-scoped preference persistence. Returning authenticated users reuse their saved plan until they change it.
- Canonical WETH, Robinhood stock-token, and opt-in Degen community registries.
- Live Robinhood contract, asset-status, price/halt, and oracle-pause checks for stock tokens.
- Per-wallet Uniswap permission checks and exact-input USDG quotes before a route can enter the live feed.
- Ten-candidate feed pages with additional pages loaded as the user approaches the end of the current page.
- Deterministic budget, asset, quote-freshness, price-impact, and plan-hash validation around the ranking model.
- Private 0G inference in production. Demo and local-live modes can use local ranking evidence when no 0G key is supplied.
- One atomic live buy operation containing the required approval, Permit2, and swap calls.
- Submitted-operation reconciliation against the actual USDG spend and output-token transfers.
- Portfolio balances, optional one-month Graph/Substreams history, per-position exits, and sequential “Exit all” wallet confirmations.
- PostgreSQL state in production and in-memory state in demo/local-live modes.
- Optional World ID verification. It becomes a feed gate only when all three World configuration values are present.

The original hackathon research and implementation brief remains in [investmade_fun.md](./investmade_fun.md). It contains historical options and sponsor-track ideas; the current runtime source of truth is this README, [docs/USER_FLOW.md](./docs/USER_FLOW.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and the code.

## Real user flow

1. The user opens the landing page and answers five questions:
   cadence, period limit, ticket size, risk preference, and allowed asset classes.
2. The user reviews the plan, accepts the disclosure, and selects **Save plan & connect**.
3. Privy authenticates the user, creates an embedded wallet when needed, and activates the Investmade smart wallet for chain `4663`.
4. If World verification is configured in live mode, the user completes that check. Otherwise the app continues directly.
5. The backend opens the cadence epoch and generates the first executable feed page.
6. The user skips or adds cards. Adding a card reserves one ticket inside the selected period limit; it does not move funds.
7. **Review basket** refreshes the selected routes and displays input, estimated output, minimum output, price impact, remaining budget, quote lifetime, and ranking proof.
8. For a live basket, the app preflights the complete smart-wallet operation and opens one Privy confirmation. All buy legs succeed together or the complete operation reverts.
9. The backend stores the submitted operation hash and polls Robinhood Chain until the result is terminal.
10. Activity displays `SUBMITTED`, `SETTLED`, `PARTIAL`, or `FAILED` evidence. A quote or hash alone is never displayed as settlement.
11. Portfolio reads supported balances and can prepare fresh asset-to-USDG exits. Exit calls are signed by the connected wallet one transaction at a time; **Exit all** repeats that flow sequentially for each holding.

See [docs/USER_FLOW.md](./docs/USER_FLOW.md) for screen states, recovery paths, and mode-specific differences.

## Runtime modes

| Mode | Configuration | State and ranking | Market and execution behavior |
|---|---|---|---|
| Demo | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=false` | In-memory sessions; fixture candidates and local ranking unless a 0G key is supplied | Simulated basket and settlement; no broadcast |
| Local live | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=true` | In-memory, repeatable cadence sessions; live candidates; local or 0G ranking | Real Uniswap quotes and real wallet signing; prohibited with `NODE_ENV=production` |
| Production | `INVESTMADE_DEMO_MODE=false` | PostgreSQL; one session/execution boundary per wallet and cadence epoch; verified 0G ranking | Live Robinhood/Uniswap checks, atomic buy submission, and onchain reconciliation |

`GET /api/config` and `GET /api/health` expose the active public mode. Local and production browser sessions are origin-scoped, so being connected on `localhost` does not authenticate the production domain.

## Run locally

```bash
npm ci --cache .npm-cache
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The default `.env.example` configuration is demo mode and never broadcasts.

Run the project checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## Local-live smoke testing

Local-live is for developer-controlled Robinhood Chain testing without production persistence:

```dotenv
INVESTMADE_DEMO_MODE=true
LOCAL_LIVE_EXECUTION=true
UNISWAP_API_KEY=...
```

Privy authentication and wallet signing are real. Candidate discovery and execution use live Robinhood/Uniswap data, but sessions remain in memory and ranking evidence can remain local. This mode must not run with `NODE_ENV=production`.

## Production configuration

Production requires:

- `INVESTMADE_DEMO_MODE=false`
- `DATABASE_URL`
- `UNISWAP_API_KEY`
- `ZG_ROUTER_API_KEY`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- a production-length `SESSION_SECRET`

World is optional. It is enabled only when `WORLD_APP_ID`, `WORLD_RP_ID`, and `WORLD_RP_SIGNING_KEY` are all configured. Graph/Substreams history and CoinGecko icons are optional enrichment paths.

```bash
npm run db:migrate
npm run build
npm start
```

In Privy, enable smart wallets for all users and configure Robinhood Chain `4663` with working bundler/paymaster infrastructure. Use a dedicated production RPC rather than the public Robinhood endpoint for normal traffic.

## Buy execution boundary

For each reviewed live basket, the backend:

1. Regenerates selected candidates and requests fresh exact-input Uniswap routes.
2. Revalidates the exact ticket size, period limit, selected asset IDs, quote freshness, price impact, sender, chain, targets, and calldata.
3. Returns approval-reset, approval, Permit2, and swap calls plus hashes binding the calls to the authorized plan.
4. Lets the browser verify that the prepared plan still matches the visible review basket.
5. Prepares the complete ERC-4337 user operation.
6. Opens one Privy confirmation and submits one atomic operation.
7. Reconciles the terminal receipt, exact USDG spend, and output-token transfers.

An HTTP success, quote response, wallet acknowledgement, or transaction hash is not settlement proof.

## Portfolio and exits

Portfolio is independent of the buy-session gate:

- It reads balances for supported candidate assets.
- It values holdings with the latest candidate unit price.
- It uses one-month The Graph/Substreams history when enough data exists; otherwise the UI labels history as unavailable.
- **Get exit quote** requests a fresh exact-input asset-to-USDG route.
- **Confirm sell** submits each approval/swap call through the connected wallet and waits for its receipt.
- **Exit all** processes holdings sequentially and may stop after an error. It is not one atomic basket operation.

## Live Uniswap evidence

On 25 July 2026, the configured Uniswap credential passed read-only exact-input checks on chain `4663`:

| Route | Permission | Quote | Routing |
|---|---|---|---|
| 10 USDG → WETH | N/A | passed | CLASSIC |
| 10 USDG → AAPL | passed | passed | CLASSIC |
| 10 USDG → TSLA | passed | passed | CLASSIC |

Run the read-only check without printing the API key:

```bash
set -a
source .env.local
set +a
KILL_TEST_SYMBOL=AAPL npm run verify:uniswap
```

The script does not broadcast.

## Production readiness

The codebase contains the production path, but public-mainnet readiness still requires operator evidence:

- A funded Investmade Wallet with ETH gas and USDG.
- Dedicated production RPC and operational monitoring.
- A live 0G response with `tee_verified: true`.
- Successful small atomic buy and supported-position exit tests.
- World end-to-end verification only if the World gate is enabled.
- Database backup/restore, alerting, key rotation, incident response, and legal review.

Use [docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md) as the release gate.

## Important files

- `src/client/App.tsx` — top-level UI state and navigation.
- `src/client/components/Onboarding.tsx` — real onboarding and wallet activation flow.
- `src/client/components/ReviewScreen.tsx` — quote refresh, review, preflight, signing, and reconciliation.
- `src/client/components/ReceiptScreen.tsx` — submitted and terminal activity evidence.
- `src/client/components/PositionsScreen.tsx` — holdings, history, and exit flow.
- `src/server/bootstrap.ts` — mode-dependent provider and storage wiring.
- `src/server/app.ts` — API, auth, session, feed, execution, and reconciliation routes.
- `src/server/adapters/live-candidates.ts` — live registry, state, permission, and quote discovery.
- `src/server/adapters/uniswap.ts` — permissions, approvals, quotes, and wallet calldata.
- `src/server/adapters/zero-g.ts` — strict private inference.
- `src/domain/policy.ts` — deterministic feed and execution rules.
- `migrations/001_initial.sql` — production session and execution constraints.

## Security

See [SECURITY.md](./SECURITY.md). Provider credentials, World proof payloads, wallet signatures, Permit2 signatures, and raw private inference must remain out of logs and browser-visible configuration.

## References

- [Uniswap Trading API integration guide](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [World IDKit integration](https://docs.world.org/world-id/idkit/integrate)
- [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview)
