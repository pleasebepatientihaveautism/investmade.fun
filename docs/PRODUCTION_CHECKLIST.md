# Production release checklist

This checklist matches the current atomic-buy and PostgreSQL production path.

## Automated gate

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] Database migration succeeds against both a clean database and an existing database.
- [ ] `/api/health` reports `mode: "live"` and chain `4663`.
- [ ] `/api/config` exposes no server secrets.

## Deployment configuration

- [ ] `NODE_ENV=production`
- [ ] `INVESTMADE_DEMO_MODE=false`
- [ ] `LOCAL_LIVE_EXECUTION=false`
- [ ] `DATABASE_URL`, `ZERO_EX_API_KEY`, `COINGECKO_API_KEY`, `ZG_ROUTER_API_KEY`, Privy credentials, and a production session secret are present in the deployment secret store.
- [ ] Dedicated Robinhood Chain RPC is configured.
- [ ] Production and preview origins are allowed by Privy and CSP.
- [ ] CoinGecko batch prices and chart history are configured with honest reference-price labels.

## Identity and wallet

- [ ] Privy email and supported external-wallet login flows succeed on the production origin.
- [ ] A new user receives an embedded signer and canonical Investmade smart-wallet address.
- [ ] Smart wallets are enabled for all users in Privy.
- [ ] Robinhood Chain `4663` has working bundler/paymaster configuration.
- [ ] Missing, expired, malformed, or wrong-app Privy access tokens fail.
- [ ] A valid token paired with a smart-wallet address not owned by that Privy user fails.
- [ ] An external wallet can fund the Investmade Wallet but cannot replace it as the atomic-buy executor.
- [ ] Logout returns the UI to onboarding and clears active in-memory product state.

## Candidate discovery and ranking

- [ ] WETH contract code and CoinGecko market data pass card discovery.
- [ ] At least one stock token passes active registry/deployment, non-halted price, oracle-pause, wallet-permission, and CoinGecko market-data checks.
- [ ] Stale stock price evidence fails in production.
- [ ] An excluded or already-seen asset does not return in the next feed page.
- [ ] Community assets appear only for Degen risk mode.
- [ ] Missing contract code, inactive deployment, halted market, paused oracle, denied permission, or missing CoinGecko price excludes the card.
- [ ] 0G catalog/model preflight passes.
- [ ] 0G response reports `tee_verified: true`.
- [ ] Missing/false TEE verification, malformed output, invented asset, duplicate asset, commitment mismatch, and over-budget output fail closed.

## Onboarding and feed UX

- [ ] All five questions validate their current ranges.
- [ ] Ticket size cannot exceed the period limit.
- [ ] Disclosure acknowledgement is required.
- [ ] Saved preferences resume for the same Privy user and can be reset with **Change my answers**.
- [ ] Basket Add disables when another ticket would exceed the period limit.
- [ ] Feed pagination preserves selected cards and does not duplicate assets.
- [ ] Demo, local-live, and production labels accurately describe the active mode.

## Atomic buy

- [ ] Review automatically refreshes selected candidates and quotes.
- [ ] Removing an asset invalidates prepared calldata.
- [ ] Near-expiry and expired quotes require refresh.
- [ ] Every returned call has the expected chain, sender, target, value, and non-empty calldata.
- [ ] Prepared authorized-plan hash matches the visible basket.
- [ ] Full approval/Permit2/swap call order passes `prepareUserOperation`.
- [ ] The user sees one Privy confirmation for the complete basket.
- [ ] Server rejects submitted buys without `batched: true`.
- [ ] A deliberately reverting leg reverts the complete basket.
- [ ] A second, different basket in the same production cadence epoch is rejected or recovers to the existing terminal receipt.
- [ ] One small USDG → WETH atomic basket reaches terminal settlement.
- [ ] One stock-token atomic basket reaches terminal settlement.

## Reconciliation and Activity

- [ ] `SUBMITTED` is displayed as pending, never settled.
- [ ] Refresh/reopen restores the last execution and selected-card snapshot for the same browser origin.
- [ ] Exact total USDG spend is verified from receipt logs.
- [ ] Every successful leg has an output transfer meeting its minimum.
- [ ] Missing output transfer fails reconciliation.
- [ ] Reverted atomic operation is displayed as failed, not partial or settled.
- [ ] Blockscout link resolves to the stored operation hash.
- [ ] Activity remains honest when the local card snapshot is unavailable.

## Portfolio and exits

- [ ] Supported balances are read for the Investmade Wallet.
- [ ] History source is labeled Graph, mixed, demo, or unavailable accurately.
- [ ] Per-position exit uses a fresh reverse quote and shows minimum USDG output.
- [ ] Approval/swap calls require connected-wallet confirmation and terminal receipts.
- [ ] “Exit all” asks for confirmation and executes holdings sequentially.
- [ ] Failure during “Exit all” stops the remaining sequence and does not relabel earlier/remaining holdings.
- [ ] Buy-session state never blocks preparation of a supported exit.

## Operations and privacy

- [ ] HTTPS, CSP, rate limiting, request-size limits, and proxy trust are verified.
- [ ] Privy, WalletConnect, Robinhood RPC, 0x, and 0G flows pass without CSP violations.
- [ ] `ZERO_EX_VERIFY_WALLET` and `ZERO_EX_VERIFY_TX_ORIGIN` identify the same Privy user's smart wallet and embedded owner, and `npm run verify:0x` reports `routeReadinessPassed: true`.
- [ ] A funded two-asset basket passes the browser's Privy `prepareUserOperation` preflight before any live-readiness claim.
- [ ] Request-body/APM capture is disabled for auth, 0G, and execution routes.
- [ ] Database backup and restore drill passes.
- [ ] Metrics cover provider latency/error rate, candidate rejection reasons, prepared/submitted/terminal counts, and reconciliation backlog without sensitive payloads.
- [ ] Alerts cover Privy auth failures, quote outage, 0G verification failure, failed atomic operations, and reconciliation backlog.
- [ ] Key rotation, incident response, and rollback have named owners.
- [ ] Product disclosures and tokenized-stock legal/permission boundaries receive legal review.

## Stop conditions

Do not launch when:

- production reports demo or local-live mode;
- 0G silently falls back to local ranking;
- a stock route bypasses registry, market, oracle, permission, or quote checks;
- the reviewed basket can diverge from the prepared plan;
- a live buy can submit sequentially instead of atomically;
- a hash or HTTP acknowledgement is shown as settlement;
- exit-all behavior is described as atomic.
