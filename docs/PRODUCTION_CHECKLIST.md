# Production release checklist

## Automated gate

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] Container runs as non-root and `/api/health` is healthy.
- [ ] Database migration succeeds against a clean database and an existing database.

## Identity and privacy

- [ ] Privy email, external-wallet, and embedded-wallet login flows succeed.
- [ ] Missing, expired, malformed, or wrong-app Privy access tokens fail.
- [ ] A valid token paired with an EVM address not linked to that Privy user fails.
- [ ] World ID 4.0 production proof succeeds.
- [ ] The same nullifier cannot bind to a second wallet.
- [ ] Feed generation fails without World verification.
- [ ] Body logging/APM capture is disabled for auth, World, 0G, and execution routes.
- [ ] Privy app secret, session secret, and RP secrets are stored in the deployment secret manager.

## Market and AI

- [ ] Dedicated Robinhood RPC is configured.
- [ ] WETH contract code and one live exact quote pass.
- [ ] At least one stock token passes registry, eligibility, halt, oracle-pause, permission, and exact quote gates.
- [ ] Unknown eligibility hides all stock cards.
- [ ] 0G private model catalog preflight passes.
- [ ] 0G response reports `tee_verified: true`.
- [ ] Missing/false TEE verification, malformed JSON, invented assets, commitment mismatch, stale evidence, and over-budget output all fail closed.

## Wallet execution

- [ ] Approval cancellation is handled when returned.
- [ ] Approval calldata and swap calldata are displayed separately.
- [ ] Quote refresh invalidates earlier calldata.
- [ ] Every returned call has sender = authenticated wallet, chain = 4663, valid target, and non-empty hex calldata.
- [ ] Wallet explicitly confirms every call.
- [ ] One small USDG → WETH settlement reaches terminal status.
- [ ] One executable stock-token settlement reaches terminal status.
- [ ] A second execution in the same epoch is rejected.
- [ ] Partial execution is displayed leg by leg.
- [ ] One supported-position exit to USDG settles and reconciles.

## Operations

- [ ] HTTPS, CSP, rate limiting, WAF limits, and request-size limits are verified.
- [ ] Privy, WalletConnect, World, and Robinhood RPC CSP flows pass in staging without violations.
- [ ] Database backups and restore drill pass.
- [ ] Metrics cover provider latency/error rate, quote rejection reasons, prepared/submitted/terminal counts, and partial outcomes without sensitive payloads.
- [ ] Alerts cover 0G verification failure, World verification failure, quote outage, elevated partial/failed outcomes, and reconciliation backlog.
- [ ] Key rotation and incident response have named owners.
- [ ] Product disclosures and stock eligibility flow receive legal review.
- [ ] Rollback is tested.

## Stop conditions

Do not launch if any sponsor-critical path uses fixtures, if a stock card bypasses eligibility/state/permission/quote checks, if 0G silently downgrades trust mode, or if the UI marks a hash as settlement.
