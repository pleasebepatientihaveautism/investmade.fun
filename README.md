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
- Exact-ticket 0x AllowanceHolder price checks before a route can enter the live feed.
- Ten-candidate feed pages with additional pages loaded as the user approaches the end of the current page.
- Deterministic budget, asset, quote-freshness, price-impact, and plan-hash validation around the ranking model.
- Private 0G inference in production. Demo and local-live modes can use local ranking evidence when no 0G key is supplied.
- One atomic live buy operation containing one exact USDG approval followed by all 0x swaps.
- Submitted-operation reconciliation against the actual USDG spend and output-token transfers.
- Portfolio balances, cached CoinGecko history, per-position exits, and sequential “Exit all” wallet confirmations.
- PostgreSQL state in production and in-memory state in demo/local-live modes.

The original hackathon research and implementation brief remains in [investmade_fun.md](./investmade_fun.md). It contains historical options and sponsor-track ideas; the current runtime source of truth is this README, [docs/USER_FLOW.md](./docs/USER_FLOW.md), [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md), and the code.

## Real user flow

1. The user opens the landing page and answers five questions:
   cadence, period limit, ticket size, risk preference, and allowed asset classes.
2. The user reviews the plan, accepts the disclosure, and selects **Save plan & connect**.
3. Privy authenticates the user, creates an embedded wallet when needed, and activates the Investmade smart wallet for chain `4663`.
4. The backend opens the cadence epoch and generates the first executable feed page.
5. The user skips or adds cards. Adding a card reserves one ticket inside the selected period limit; it does not move funds.
6. **Review basket** refreshes the selected routes and displays input, estimated output, minimum output, price impact, remaining budget, quote lifetime, and ranking proof.
7. For a live basket, the app preflights the complete smart-wallet operation and opens one Privy confirmation. All buy legs succeed together or the complete operation reverts.
8. The backend stores the submitted operation hash and polls Robinhood Chain until the result is terminal.
9. Activity displays `SUBMITTED`, `SETTLED`, `PARTIAL`, or `FAILED` evidence. A quote or hash alone is never displayed as settlement.
10. Portfolio reads supported balances and can prepare fresh asset-to-USDG exits. Exit calls are signed by the connected wallet one transaction at a time; **Exit all** repeats that flow sequentially for each holding.

See [docs/USER_FLOW.md](./docs/USER_FLOW.md) for screen states, recovery paths, and mode-specific differences.

## Runtime modes

| Mode | Configuration | State and ranking | Market and execution behavior |
|---|---|---|---|
| Demo | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=false` | In-memory sessions; fixture candidates and local ranking unless a 0G key is supplied | Simulated basket and settlement; no broadcast |
| Local live | `INVESTMADE_DEMO_MODE=true`, `LOCAL_LIVE_EXECUTION=true` | In-memory, repeatable cadence sessions; live candidates; local or 0G ranking | Real 0x quotes and real wallet signing; prohibited with `NODE_ENV=production` |
| Production | `INVESTMADE_DEMO_MODE=false` | PostgreSQL; one session/execution boundary per wallet and cadence epoch; verified 0G ranking | Live Robinhood/0x checks, atomic buy submission, and onchain reconciliation |

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
ZERO_EX_API_KEY=...
ZERO_EX_VERIFY_WALLET=0x...
ZERO_EX_VERIFY_TX_ORIGIN=0x...
ZERO_EX_VERIFY_SYMBOLS=AAPL,TSLA
```

Privy authentication and wallet signing are real. Candidate discovery uses Robinhood's canonical `/rhj/assets` and `/rhj/prices` data, while execution uses 0x AllowanceHolder. Sessions remain in memory and ranking evidence can remain local. This mode must not run with `NODE_ENV=production`.

## Production configuration

Production requires:

- `INVESTMADE_DEMO_MODE=false`
- `DATABASE_URL`
- `ZERO_EX_API_KEY`
- `JUPITER_API_KEY`, `SOLANA_RPC_URL`, and `SOLANA_WS_URL` to enable Solana
- `ZG_ROUTER_API_KEY`
- `PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- a production-length `SESSION_SECRET`

CoinGecko batch prices, chart history, and icons are market-data enrichment paths.

```bash
npm run db:migrate
npm run build
npm start
```

In Privy, enable smart wallets for all users and configure Robinhood Chain `4663` with working bundler/paymaster infrastructure. Use a dedicated production RPC rather than the public Robinhood endpoint for normal traffic.

Privy is configured to create both Ethereum and Solana embedded wallets and to
surface Solana external-wallet connectors such as Phantom. Solana uses USDC as
the budget asset and Jupiter Swap V2 `/build` to compose up to three routes into
one versioned transaction. The backend simulates that complete transaction,
locks its message commitment, submits only the matching signed transaction, and
reconciles confirmed token balance changes before settlement.

## Buy execution boundary

For each reviewed live basket, the backend:

1. Regenerates selected candidates and requests fresh exact-input 0x AllowanceHolder routes.
2. Revalidates the exact ticket size, period limit, selected asset IDs, quote freshness, price impact, authenticated smart wallet and embedded-owner `txOrigin`, chain, tokens, and calldata.
3. Requires one shared AllowanceHolder spender, returns one exact-total USDG approval followed by the swap calls, and binds every call to the authorized plan.
4. Lets the browser verify that the prepared plan still matches the visible review basket.
5. Prepares the complete ERC-4337 user operation.
6. Opens one Privy confirmation and submits one atomic operation.
7. Reconciles the terminal receipt, exact USDG spend, and output-token transfers.

An HTTP success, quote response, wallet acknowledgement, or transaction hash is not settlement proof.

## Portfolio and exits

Portfolio is independent of the buy-session gate:

- It reads balances for supported candidate assets.
- It values holdings with the latest candidate unit price.
- It uses cached CoinGecko history when enough data exists; otherwise the UI labels history as unavailable.
- **Get exit quote** requests a fresh exact-input asset-to-USDG route.
- **Confirm sell** submits each approval/swap call through the connected wallet and waits for its receipt.
- **Exit all** processes holdings sequentially and may stop after an error. It is not one atomic basket operation.

## Live 0x verification

The read-only verifier discovers active chain-4663 stocks from Robinhood, requests representative 0x AllowanceHolder quotes, checks a reverse route, and verifies that two buy routes share one approval spender. Put a stock already held by the verification wallet first in `ZERO_EX_VERIFY_SYMBOLS` so its reverse simulation can succeed. It reports route readiness only when the buy, reverse, and two-asset 0x quote simulations are complete for the supplied funded smart wallet. Full live readiness additionally requires the browser's two-asset `prepareUserOperation` preflight to succeed.

Run the read-only check without printing the API key:

```bash
set -a
source .env
set +a
npm run verify:0x
```

The script does not broadcast.

## Production readiness

The codebase contains the production path, but public-mainnet readiness still requires operator evidence:

- A funded Investmade Wallet with USDG. Gas sponsorship remains a separate Privy/paymaster acceptance test and must not be described as gasless until verified with no ETH.
- Dedicated production RPC and operational monitoring.
- A live 0G response with `tee_verified: true`.
- Successful small atomic buy and supported-position exit tests.
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
- `src/server/adapters/zero-ex.ts` — 0x price/quote validation, exact approvals, and swap calldata.
- `src/server/adapters/zero-g.ts` — strict private inference.
- `src/domain/policy.ts` — deterministic feed and execution rules.
- `migrations/001_initial.sql` — production session and execution constraints.

## Security

See [SECURITY.md](./SECURITY.md). Provider credentials, wallet signatures, and raw private inference must remain out of logs and browser-visible configuration.

## References

- [0x supported chains](https://docs.0x.org/docs/introduction/supported-chains)
- [0x contract guidance](https://docs.0x.org/docs/core-concepts/contracts)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview)
