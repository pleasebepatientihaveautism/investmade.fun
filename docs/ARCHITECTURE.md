# Architecture

```mermaid
flowchart LR
  F["Email or external funding wallet"] --> E["Privy embedded signer"]
  E --> W["Investmade ERC-4337 wallet"]
  W --> S["Verified Privy access token"]
  S --> H["World proof binding"]
  H --> E["Weekly epoch session"]
  E --> R["Robinhood registry and state"]
  E --> L["Eligibility service"]
  R --> C["Candidate gate"]
  L --> C
  C --> UQ["Uniswap permission and exact quote"]
  UQ --> Z["0G private verified ranking"]
  Z --> P["Deterministic policy"]
  P --> UI["Swipe and review UI"]
  UI --> UF["Fresh approval, Permit2, and swap calls"]
  UF --> PUF["Full user-operation preflight"]
  PUF --> W
  W -->|"One atomic confirmation"| RH["Robinhood Chain"]
  RH --> X["Receipt reconciliation"]
  X --> DB["PostgreSQL"]
```

## Trust boundaries

- Browser input carries a short-lived Privy access token and the canonical Investmade smart-wallet
  address. The backend verifies the token with Privy and confirms the smart wallet is linked to that user before applying
  Zod validation to request data.
- World proof payloads are forwarded server-side and bound to the authenticated wallet. Only an HMAC digest of the nullifier is stored.
- Stock eligibility is a separate server-side dependency. World is not treated as KYC.
- 0G receives minimized structured candidates, not keys, signatures, World identifiers, or raw proof payloads.
- The model cannot invent addresses or amounts. Its output must match the input commitment and candidate set.
- Uniswap credentials and calls stay server-side. The browser receives only wallet-signable transactions that were checked for chain, sender, non-empty calldata, and commitment.
- The Privy smart-wallet client broadcasts one ERC-4337 batch. The backend reconciles its receipt,
  exact USDG spend, every minimum output transfer, and terminal outcome. It does not assume the
  outer EntryPoint transaction sender is the smart wallet.

## State guarantees

- Unique `(wallet, epoch_id)` weekly session.
- Unique execution per weekly session.
- A prepared execution may refresh quotes/call commitments only when the authorized basket hash is unchanged.
- Submitted or terminal executions cannot return to a prepared state.
- Exits are a separate workflow and are not blocked by the weekly buy state.
