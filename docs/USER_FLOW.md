# Current user flow

This document describes the user-visible flow implemented in the current codebase. It is not the original hackathon pitch or a future roadmap.

## Navigation model

Before onboarding completes, the header exposes the investmade.fun home action and Privy wallet connection. After authentication and plan activation, the primary navigation contains:

- **Basket** — ranked cards, selected budget, and basket review.
- **Portfolio** — supported wallet balances, one-month value context, and exits.
- **Activity** — the latest submitted or terminal basket receipt available to this browser session.
- **Account** — Investmade Wallet address, USDG balance, plan settings, and developer controls where applicable.

The wallet menu exposes the Investmade Wallet, connected funding wallet, top-up, send, copy-address, and logout actions. The funding wallet can fund the Investmade Wallet; it is not the live atomic-buy executor.

## 1. Landing and plan creation

The unauthenticated production page starts with **Build your investment guardrails**.

The user answers five questions:

1. **Investment period** — daily, weekly, or monthly cadence.
2. **Period limit** — maximum USDG spend for each cadence epoch; custom values range from `10.00` to `100.00`.
3. **Decision size** — USDG represented by one add action; custom values range from `0.10` to the chosen period limit.
4. **Risk preference** — conservative, balanced, or degen. This changes ranking and whether community assets may enter discovery; it does not bypass deterministic safety checks.
5. **Asset mix** — crypto, tokenized stocks, or both.

The review step shows the plan and requires the user to acknowledge that ranking is not financial advice, assets can lose value, stock-token routes depend on eligibility/permission checks, and every trade requires wallet approval.

Selecting **Save plan & connect** records the completed plan for the authenticated Privy user after authentication succeeds. Returning users with stored preferences resume at wallet activation instead of answering the questions again. **Change my answers** clears the stored plan for that account.

## 2. Privy and Investmade Wallet activation

The wallet stage can perform several actions depending on the user state:

- Open Privy login.
- Create a Privy embedded wallet when one does not exist.
- Obtain or activate the smart-wallet client for Robinhood Chain `4663`.
- Confirm that the active smart-wallet address is the Investmade Wallet used by the API.

The server receives a short-lived Privy access token plus the smart-wallet address. For live requests, it verifies the token and confirms that address belongs to the authenticated Privy user.

## 3. Session and feed generation

After wallet activation:

1. `POST /api/sessions/open` creates or returns a session for the selected cadence.
2. Demo and local-live modes add a basket nonce, making new baskets repeatable within the same cadence period.
3. Production uses the cadence epoch directly, enforcing its persistent wallet/epoch boundary.
4. `POST /api/sessions/:sessionId/feed` derives an exact base-unit budget from the period limit and ticket size.
5. Candidate discovery filters by the selected asset classes and risk mode.
6. Live stock-token candidates must have deployed contract code, active Robinhood registry state, non-halted market data, an unpaused oracle, wallet permission, and a CoinGecko market price.
7. Production also requires fresh Robinhood price evidence. Local-live deliberately tolerates stale off-hours stock timestamps while still checking active/non-halted/onchain state.
8. The ranking provider receives only the bounded candidate packet and preferences. Deterministic policy validates the returned asset IDs, commitments, budgets, and market-data availability.

The first response contains up to ten candidates. As the user approaches the final three cards, the client requests another page while excluding already seen and selected assets. Loading stops when discovery returns no additional eligible page.

## 4. Building a basket

Each card shows the asset, ticket amount, current CoinGecko reference price, CoinGecko history when available, ranking reason, and proof details.

- **Skip** advances without allocating budget.
- **Add** includes the asset when another ticket still fits inside the period limit.
- **Review basket** becomes available after at least one asset is selected.

No funds move during card decisions. The budget rail shows selected count, ticket size, remaining USDG, cadence, chain, and whether execution is demo or live.

## 5. Review and quote refresh

Opening review automatically prepares the basket:

1. The backend regenerates the selected candidates using current live data.
2. It requests fresh 0x AllowanceHolder quotes and wallet calls.
3. It verifies that selected assets, amounts, period limit, and policy still match.
4. The UI displays total input, remainder, estimated and minimum output, price impact, quote lifetime, smart-wallet readiness, and ranking proof.

Removing an asset invalidates the prepared record and calldata. Expired or nearly expired quotes require refresh before signing. A session-not-found response triggers a bounded recovery that opens a new local/demo session and retains still-available selections.

## 6. Live buy signing

The live buy path requires the canonical Investmade smart wallet:

1. The client checks that the prepared plan hash still matches the visible review basket.
2. The client prepares the complete ERC-4337 user operation containing all approval-reset, approval, Permit2, and swap calls.
3. Privy displays one confirmation for the total basket.
4. `sendTransaction({ calls })` submits one operation.
5. The browser reports the single hash to `POST /api/executions/:executionId/submitted` with the atomic-batch marker.
6. The app polls reconciliation until terminal or until the bounded polling window ends.

All live buy calls execute atomically. The backend does not offer sequential EOA submission as a fallback.

In demo mode, the same review surface calls the demo-settle endpoint and clearly labels the result as simulated.

## 7. Activity and recovery

Activity renders:

- `SUBMITTED` — operation exists but settlement is not yet terminal; the user can check again.
- `SETTLED` — exact USDG spend and expected output transfers were verified.
- `PARTIAL` — supported by the receipt model for non-atomic or legacy records; the current atomic buy path should normally settle or fail as a whole.
- `FAILED` — the operation or its verified outputs failed.

The receipt includes the authorized plan hash, policy hash, ranking output commitment, terminal state, per-asset output records, and a Blockscout link for live transactions.

The last execution ID and selected-card snapshot are stored locally per Investmade Wallet so a submitted operation can be reloaded after a browser refresh. This browser persistence is origin-specific.

## 8. Portfolio and exits

Portfolio reads supported token balances for the Investmade Wallet and values them using current candidate prices. One-month change is shown only when enough history exists; the source label distinguishes Graph-backed, demo, mixed, and unavailable data.

For one position:

1. **Get exit quote** requests a fresh exact-input asset-to-USDG route.
2. The UI shows the minimum USDG output and a 60-second freshness label.
3. **Confirm sell** switches the connected wallet to chain `4663`.
4. Each returned approval/swap call is submitted and awaited in order.
5. The row is marked settled only after every required receipt succeeds.

**Exit all** asks for browser confirmation, then processes holdings sequentially. It is not atomic across positions and stops on an error. Previously completed exits remain completed.

## 9. Account and funding

Account shows:

- Investmade Wallet address and copy action.
- Connected funding-wallet address when present.
- Live USDG balance.
- Cadence, period limit, ticket size, risk mode, and asset classes.
- Save-plan action that regenerates the feed with the updated settings.
- Local developer reset controls when running local-live.

Top-up sends USDG from the linked external funding wallet to the Investmade Wallet. It does not deposit into a server-controlled account.

## Mode differences visible to users

| Surface | Demo | Local live | Production |
|---|---|---|---|
| Privy wallet | Real | Real | Real |
| Feed candidates | Fixtures with market prices | Live Robinhood + CoinGecko | Live Robinhood + CoinGecko |
| Ranking proof | Local unless 0G configured | Local unless 0G configured | Verified 0G required |
| Buy signing | Simulated | Real | Real |
| Session persistence | Memory, repeatable | Memory, repeatable | PostgreSQL, cadence-bound |
| Receipt | Explicit demo receipt | Live chain receipt | Live chain receipt |
