const apiKey = process.env.UNISWAP_API_KEY;
if (!apiKey) throw new Error("UNISWAP_API_KEY is required");

const wallet = process.env.KILL_TEST_WALLET ?? "0x71f30000000000000000000000000000000009a2";
if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error("Invalid KILL_TEST_WALLET");
const symbol = process.env.KILL_TEST_SYMBOL ?? "WETH";
const tokens = {
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d"
};
const tokenOut = tokens[symbol];
if (!tokenOut) throw new Error("KILL_TEST_SYMBOL must be WETH, AAPL, or TSLA");

let permissionAllowed = true;
let permissionChecked = false;
if (symbol !== "WETH") {
  const permissionResponse = await fetch(
    "https://trade-api.gateway.uniswap.org/v1/permissions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({ walletAddress: wallet, tokens: [tokenOut], chainId: 4663 }),
      signal: AbortSignal.timeout(10_000)
    }
  );
  const permissionBody = await permissionResponse.json();
  const permission =
    permissionBody.permissions?.[0] ??
    permissionBody.results?.[0] ??
    permissionBody[tokenOut] ??
    permissionBody;
  permissionChecked = permissionResponse.ok;
  permissionAllowed =
    permissionResponse.ok &&
    (permission.isPermissioned !== true || permission.isAllowlisted === true);
}

const response = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "x-universal-router-version": "2.1.1",
    "x-permit2-disabled": "true"
  },
  body: JSON.stringify({
    type: "EXACT_INPUT",
    amount: "10000000",
    tokenInChainId: "4663",
    tokenOutChainId: "4663",
    tokenIn: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    tokenOut,
    swapper: wallet,
    slippageTolerance: 0.5,
    routingPreference: "BEST_PRICE"
  }),
  signal: AbortSignal.timeout(15_000)
});

const body = await response.json();
const quote = body.quote ?? {};
const amountOut =
  quote.output?.amount ??
  quote.orderInfo?.outputs?.[0]?.startAmount ??
  null;

let approvalResponse;
let swapResponse;
let swapBody;
if (response.ok) {
  approvalResponse = await fetch("https://trade-api.gateway.uniswap.org/v1/check_approval", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-permit2-disabled": "true"
    },
    body: JSON.stringify({
      walletAddress: wallet,
      token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      amount: "10000000",
      chainId: 4663
    }),
    signal: AbortSignal.timeout(15_000)
  });
  swapResponse = await fetch("https://trade-api.gateway.uniswap.org/v1/swap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.1.1",
      "x-permit2-disabled": "true"
    },
    body: JSON.stringify({
      quote: body.quote,
      refreshGasPrice: false,
      simulateTransaction: false,
      safetyMode: "SAFE",
      deadline: Math.floor(Date.now() / 1000) + 60
    }),
    signal: AbortSignal.timeout(15_000)
  });
  swapBody = await swapResponse.json();
}
const swap = swapBody?.swap;
const swapCalldataValid = Boolean(
  swapResponse?.ok &&
  /^0x[a-fA-F0-9]{40}$/.test(swap?.to ?? "") &&
  /^0x[a-fA-F0-9]{40}$/.test(swap?.from ?? "") &&
  typeof swap?.data === "string" &&
  swap.data.length > 2 &&
  Number(swap?.chainId) === 4663
);

console.log(
  JSON.stringify({
    authenticated: response.status !== 401 && response.status !== 403,
    symbol,
    permissionChecked,
    permissionAllowed,
    httpStatus: response.status,
    routeAvailable: response.ok && Boolean(amountOut),
    routing: body.routing ?? null,
    requestIdPresent: typeof body.requestId === "string",
    outputAmountPresent: Boolean(amountOut),
    quoteIdPresent: typeof quote.quoteId === "string",
    quoteChainId: quote.chainId ?? null,
    quoteInputTokenPresent: typeof quote.input?.token === "string",
    quoteOutputTokenPresent: typeof quote.output?.token === "string",
    permitDataPresent: Boolean(body.permitData),
    approvalCheckPassed: approvalResponse?.ok ?? false,
    swapSimulationPassed: swapResponse?.ok ?? false,
    swapCalldataValid,
    swapHttpStatus: swapResponse?.status ?? null,
    swapErrorCode: swapResponse?.ok
      ? null
      : swapBody?.errorCode ?? swapBody?.error ?? swapBody?.code ?? "UNKNOWN",
    errorCode: response.ok ? null : body.errorCode ?? body.error ?? body.code ?? "UNKNOWN"
  })
);

if (!response.ok || !approvalResponse?.ok || !swapResponse?.ok || !swapCalldataValid) process.exitCode = 1;
