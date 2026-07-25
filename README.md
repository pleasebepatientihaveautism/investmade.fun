# investmade.fun

investmade.fun is a non-custodial, fixed-budget allocation app for Robinhood Chain. Users choose a daily, weekly, or monthly cadence and a per-card ticket size. A private 0G model ranks only canonical assets that already passed deterministic eligibility, market-state, permission, and exact-size Uniswap quote gates. The user chooses cards, reviews a bounded basket, and confirms every wallet call.

This repository implements the core MVP described in [investmade_fun.md](./investmade_fun.md). Autonomous mandates and AgentKit execution are intentionally excluded from the core path.

Privy provides email, external-wallet, embedded-wallet, and ERC-4337 smart-wallet support. Every
user gets an embedded signer and a canonical Investmade smart wallet. The browser sends a
short-lived Privy access token with that smart-wallet address; the server verifies the token and
confirms the smart wallet belongs to the authenticated Privy user before accepting live requests.
`PRIVY_APP_SECRET` is server-only and must never be exposed through a Vite-prefixed variable.

## What is implemented

- React/Vite product UI: onboarding, swipe feed, budget rail, review, explicit wallet confirmation, positions, and terminal receipts.
- Privy access-token authentication with server-side embedded/smart-wallet verification.
- One atomic ERC-4337 basket operation: allowance reset/approval, Permit2 setup, and all Uniswap
  swaps are simulated and confirmed together. A failed leg reverts the complete basket.
- First-time, five-question onboarding for cadence, ticket size, risk mode, asset mix, and explicit product-risk acknowledgement; preferences determine session epochs, quote amounts, policy limits, the server-side candidate set, and private-ranking input.
- World ID 4.0 RP signatures and backend verification; production feed generation requires a verified human.
- Canonical Robinhood Chain registry sourced from Uniswap’s Robinhood Stocks list: WETH plus 15 tokenized stock assets; the ten-card feed uses WETH and the first nine listed stocks.
- Each live card displays a USD unit price derived from its fresh server-side Uniswap exact-input quote.
- Live Robinhood asset/price/contract/oracle-pause checks.
- Server-side stock eligibility provider boundary; stock cards fail closed without an affirmative result.
- Live Uniswap permission, approval, exact-input quote, and swap-calldata construction.
- Strict 0G private/TeeML call with `verify_tee: true`; an unverified response is rejected.
- Exact `bigint` USDG arithmetic, input/output commitments, deterministic policy, quote freshness, price-impact caps, and one execution per wallet/epoch.
- Route-independent authorized intent hash plus exact calldata commitments.
- PostgreSQL uniqueness and transaction boundaries for weekly sessions and executions.
- Submitted-transaction reconciliation against the authenticated wallet, expected calldata, Robinhood Chain, terminal receipt status, and output-token transfers to the wallet.
- Always-reachable per-position exit preparation using current wallet balances, stock permissions, token approvals, fresh reverse Uniswap quotes, and explicit wallet confirmation.
- Local demo mode with visibly non-mainnet fixtures. Demo evidence never claims TEE or chain settlement.

## Local demo

```bash
npm ci --cache .npm-cache
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`. The default demo mode uses deterministic fixtures and never broadcasts.

Verification:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

## Production configuration

Set `INVESTMADE_DEMO_MODE=false` and provide every required secret from `.env.example`. Do not put production secrets in browser-prefixed variables.

```bash
npm run db:migrate
npm run build
npm start
```

Production startup fails when Privy, PostgreSQL, Uniswap, 0G, World RP, or session configuration is missing. Stock-token cards additionally require `STOCK_ELIGIBILITY_PROVIDER_URL`; without it, they remain hidden.

In the Privy Dashboard, enable smart wallets for all users and configure Robinhood Chain (`4663`)
as a custom chain with an Alchemy bundler and paymaster. This dashboard step is required before
`useSmartWallets()` can create a chain-4663 client.

The production RPC should be a dedicated provider endpoint. Robinhood’s public endpoint is suitable for development and kill tests, not normal production traffic.

## Execution boundary

The app prepares one atomic smart-wallet operation containing:

1. Optional approval cancellation.
2. Optional exact required USDG approval.
3. One fresh Uniswap quote and transaction-calldata request per selected route.
4. A Permit2 transaction when Uniswap requires one.
5. One Privy confirmation for the complete call set.
6. Submission of the single operation transaction hash to the backend.
7. Terminal receipt reconciliation.

The live buy flow rejects sequential submission. It preflights the complete user operation before
opening Privy, then executes all legs together or reverts them together. A quote, API
acknowledgement, or transaction hash is still never treated as settlement.

For successful buy legs, the receipt records the actual output-token amount transferred to the authenticated wallet. A successful transaction receipt with no matching output transfer is not labeled settled.

Position exits are prepared independently of the weekly session gate. The live UI reads the connected wallet balance, requests a fresh exact-input asset→USDG route, and requires the wallet to confirm each returned approval/swap call.

No server private key exists. The backend cannot broadcast for the user.

## Signing a live Robinhood Chain trade

Live signing is intentionally unavailable while `INVESTMADE_DEMO_MODE=true`. After configuring the
required production services, run with `INVESTMADE_DEMO_MODE=false`, activate and fund the
Investmade Wallet, and use **Review and sign → Confirm once**. Privy shows the complete atomic
basket. investmade.fun stores its single resulting transaction hash and waits for Robinhood Chain
settlement.

The settlement screen links the atomic operation to Blockscout and marks it settled only after the
receipt contains the exact USDG spend and every minimum output transfer to the Investmade Wallet. It
does not label a quote, signature request, or submitted hash as settlement.

For a developer-controlled, single-asset mainnet smoke test without enabling the full production
stack, set `LOCAL_LIVE_EXECUTION=true` while keeping `INVESTMADE_DEMO_MODE=true`. This mode uses
real USDG→WETH Uniswap calldata and Privy authentication, but keeps the ranking/session state in
memory and labels its ranking evidence as a demo. It is intentionally limited to WETH, cannot run
with `NODE_ENV=production`, and is not a production deployment mode.

The Uniswap route is simulated when prepared, and Privy then prepares the complete ERC-4337 user
operation before opening the signing modal. This second preflight includes preceding approval and
Permit2 calls in their real execution order.

## Live integration evidence

On 25 July 2026, the provided Uniswap API credential passed read-only exact-input kill tests on chain `4663`:

| Route | Permission | Quote | Routing |
|---|---|---|---|
| 10 USDG → WETH | N/A | passed | CLASSIC |
| 10 USDG → AAPL | passed | passed | CLASSIC |
| 10 USDG → TSLA | passed | passed | CLASSIC |

The script records only booleans and route type; it never prints the API key, raw calldata, or full provider response:

```bash
set -a
source .env.local
set +a
KILL_TEST_SYMBOL=AAPL npm run verify:uniswap
```

No transaction was broadcast during these kill tests.

## Production blockers that still require operator credentials/funds

Code completeness is not mainnet readiness. Before public launch, the operator must provide and verify:

- A funded Robinhood Chain wallet with ETH gas and USDG.
- A dedicated production RPC.
- A live private 0G model response with `tee_verified: true`.
- World production RP/app configuration and an end-to-end proof.
- A real stock eligibility/compliance service if stock cards are enabled.
- At least one small user-confirmed settlement and one supported-position exit.
- Monitoring, alerting, backups, key rotation, and legal review.

See [docs/PRODUCTION_CHECKLIST.md](./docs/PRODUCTION_CHECKLIST.md) for the release gate.

## Important files

- `src/domain/policy.ts` — deterministic feed and execution rules.
- `src/server/adapters/live-candidates.ts` — Robinhood/eligibility/quote candidate gate.
- `src/server/adapters/zero-g.ts` — private verified 0G inference.
- `src/server/adapters/uniswap.ts` — permission, approval, quote, calldata validation.
- `src/server/app.ts` — auth, World binding, sessions, execution, reconciliation.
- `migrations/001_initial.sql` — durable uniqueness and execution constraints.
- `tests/` — fail-closed, commitment, idempotency, and API flow coverage.
- `design/` — accepted UI concept references.

## Security and privacy

See [SECURITY.md](./SECURITY.md). Raw World proofs, nullifiers, wallet signatures, 0G prompts/completions, Permit2 signatures, API keys, and raw private inference are never intentionally logged.

## Official references

- [Uniswap Trading API integration guide](https://developers.uniswap.org/docs/trading/swapping-api/integration-guide)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [World IDKit integration](https://docs.world.org/world-id/idkit/integrate)
- [0G Compute Router](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview)
