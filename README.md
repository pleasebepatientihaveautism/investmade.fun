# investmade.fun

investmade.fun is a non-custodial, fixed-budget allocation app for Robinhood Chain. Users choose a daily, weekly, or monthly cadence and a per-card ticket size. A private 0G model ranks only canonical assets that already passed deterministic eligibility, market-state, permission, and exact-size Uniswap quote gates. The user chooses cards, reviews a bounded basket, and confirms every wallet call.

This repository implements the core MVP described in [investmade_fun.md](./investmade_fun.md). Autonomous mandates and AgentKit execution are intentionally excluded from the core path.

Privy provides email, external-wallet, and embedded-wallet authentication. The browser sends a
short-lived Privy access token with the active wallet address; the server verifies the token and
confirms that address is linked to the authenticated Privy user before accepting live requests.
`PRIVY_APP_SECRET` is server-only and must never be exposed through a Vite-prefixed variable.

## What is implemented

- React/Vite product UI: onboarding, swipe feed, budget rail, review, explicit wallet confirmation, positions, and terminal receipts.
- Privy access-token authentication with server-side linked-wallet verification.
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

The production RPC should be a dedicated provider endpoint. Robinhood’s public endpoint is suitable for development and kill tests, not normal production traffic.

## Execution boundary

The app prepares a sequence of wallet calls:

1. Optional approval cancellation.
2. Optional exact required USDG approval.
3. One fresh, simulated Uniswap calldata request per selected route.
4. Explicit wallet confirmation for each call.
5. Submission of only the swap transaction hashes to the backend.
6. Terminal receipt reconciliation.

The UI does not promise an atomic basket. It never treats a quote, API acknowledgement, or transaction hash as settlement.

For successful buy legs, the receipt records the actual output-token amount transferred to the authenticated wallet. A successful transaction receipt with no matching output transfer is not labeled settled.

Position exits are prepared independently of the weekly session gate. The live UI reads the connected wallet balance, requests a fresh exact-input asset→USDG route, and requires the wallet to confirm each returned approval/swap call.

No server private key exists. The backend cannot broadcast for the user.

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
