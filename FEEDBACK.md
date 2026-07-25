# Uniswap Trading API feedback

## Integration

investmade.fun uses the Trading API as a server-side quote and transaction builder for exact 10 USDG allocations on Robinhood Chain. The flow calls `/permissions`, `/check_approval`, `/quote`, and `/swap`, preserves Universal Router version `2.1.1`, validates the returned sender/chain/calldata, and leaves signing/broadcasting to the user’s wallet.

## What worked well

- The same exact-input API flow returned `CLASSIC` routes for WETH, AAPL, and TSLA on chain 4663.
- `/permissions` made the tokenized-asset boundary explicit.
- `/check_approval` and `/swap` returned wallet-ready transaction objects, which let the app keep a non-custodial architecture.
- Request IDs and routing types are useful for sanitized receipts and support escalation.

## Friction

- The difference between examples that wrap `quote` and examples that spread the full quote response is easy to misread. One canonical request-body example per current API version would prevent integration errors.
- Multi-leg basket guidance is still easy to overstate. Clearer documentation distinguishing multiple wallet calls, EIP-5792 presentation, and true atomicity would help.
- Tokenized-pool permission requirements and Universal Router version compatibility should be visible directly in supported-chain metadata.
- A documented quote-expiry field would be safer than an application-side TTL.

## Requested improvements

1. Publish a generated TypeScript client with discriminated quote-route types.
2. Return an explicit `expiresAt` for every quote.
3. Add a first-class multi-quote basket planning endpoint that reports atomicity and wallet requirements.
4. Include permission/router compatibility in the permission response.
5. Provide sanitized response fixtures for Robinhood Chain stock-token routes.
