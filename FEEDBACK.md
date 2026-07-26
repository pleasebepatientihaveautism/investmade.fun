# Uniswap Trading API feedback

## Integration

investmade.fun uses the Uniswap Trading API as its core execution layer for fixed-size USDG
allocations into crypto and tokenized stocks on Robinhood Chain. The server calls `/permissions`,
`/check_approval`, `/quote`, and `/swap`, requests Permit2 as a transaction when required, validates
the returned sender, chain, and calldata, and leaves signing and broadcasting to the user's
ERC-4337 smart wallet.

## What worked well

- The same exact-input API flow returned `CLASSIC` routes for WETH, AAPL, and TSLA on chain 4663.
- `/permissions` made the tokenized-asset boundary explicit.
- `/check_approval` and `/swap` returned wallet-ready transaction objects, which let the app remain
  non-custodial.
- Request IDs and routing types are useful for sanitized receipts and support escalation.
- Supporting tokenized stocks through the same quote and swap flow as crypto made it possible to
  create one coherent portfolio experience.

## Friction

- Quote generation for a multi-asset feed was slower than expected. Building ten executable cards
  requires multiple exact-size requests, and parallel requests can receive `429` responses. We
  added bounded concurrency, serial execution preparation, retry delays, and caching to keep the
  experience reliable.
- The Trading API and Robinhood stock-token list do not provide consistent stock logos or other
  presentation-ready image metadata. We had to source and maintain asset imagery separately.
- There is no first-class basket endpoint that accepts multiple token outputs and returns one
  coordinated set of approval, Permit2, and swap calls. We request each route separately and then
  assemble and simulate the calls inside one ERC-4337 smart-wallet operation.
- There is no historical-price endpoint for Robinhood Chain tokenized stocks. We built and deployed
  a custom The Graph Substreams package that indexes Uniswap v4 `Initialize` and `Swap` events and
  converts them into portfolio price history.
- The difference between examples that wrap `quote` and examples that spread the full quote
  response is easy to misread. One canonical request-body example per current API version would
  prevent integration errors.
- Tokenized-stock permission requirements and Universal Router version compatibility should be
  visible directly in supported-chain metadata.
- A documented quote-expiry field would be safer than an application-side TTL.

## Requested improvements

1. Add a bulk quote endpoint for several output tokens at the same input amount.
2. Add a first-class basket-planning endpoint that returns coordinated approvals, Permit2 calls,
   swaps, expiry information, and explicit atomicity requirements.
3. Include canonical image URLs and presentation metadata for supported tokenized stocks.
4. Return an explicit `expiresAt` for every quote.
5. Publish a generated TypeScript client with discriminated quote-route types.
6. Include permission and Universal Router compatibility in supported-chain or permission metadata.
7. Provide an official historical-data path, or link to recommended Subgraph/Substreams packages,
   for tokenized-stock prices.
8. Provide sanitized response fixtures for Robinhood Chain stock-token routes.
