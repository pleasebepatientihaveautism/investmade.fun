const apiKey = process.env.ZERO_EX_API_KEY;
if (!apiKey) throw new Error("ZERO_EX_API_KEY is required");

const wallet = requiredAddress("ZERO_EX_VERIFY_WALLET");
const txOrigin = requiredAddress("ZERO_EX_VERIFY_TX_ORIGIN");
const sellAmount = process.env.ZERO_EX_VERIFY_USDG_AMOUNT ?? "10000000";
const preferredSymbols = (process.env.ZERO_EX_VERIFY_SYMBOLS ?? "")
	.split(",")
	.map((symbol) => symbol.trim().toUpperCase())
	.filter(Boolean);
if (!/^[1-9][0-9]*$/.test(sellAmount)) {
	throw new Error("ZERO_EX_VERIFY_USDG_AMOUNT must be positive base units");
}

const chainId = "4663";
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const [assetResponse, priceResponse] = await Promise.all([
	fetch("https://api.robinhood.com/rhj/assets", {
		signal: AbortSignal.timeout(10_000),
	}),
	fetch("https://api.robinhood.com/rhj/prices", {
		signal: AbortSignal.timeout(10_000),
	}),
]);
if (!assetResponse.ok || !priceResponse.ok) {
	throw new Error("Robinhood registry or price endpoint is unavailable");
}
const assetBody = await assetResponse.json();
const priceBody = await priceResponse.json();
const healthySymbols = new Set(
	(priceBody.quotes ?? [])
		.filter((quote) => !quote.isTradingHalt)
		.map((quote) => quote.tokenSymbol),
);
const stocks = (assetBody.assets ?? [])
	.filter(
		(asset) =>
			asset.status === "ASSET_STATUS_ACTIVE" &&
			healthySymbols.has(asset.tokenSymbol),
	)
	.flatMap((asset) => {
		const deployment = asset.deployments?.find(
			(item) => Number(item.chainId) === Number(chainId),
		);
		return deployment
			? [{ symbol: asset.tokenSymbol, address: deployment.contractAddress }]
			: [];
	})
	.sort((left, right) => {
		const leftIndex = preferredSymbols.indexOf(left.symbol);
		const rightIndex = preferredSymbols.indexOf(right.symbol);
		if (leftIndex >= 0 || rightIndex >= 0) {
			if (leftIndex < 0) return 1;
			if (rightIndex < 0) return -1;
			return leftIndex - rightIndex;
		}
		return left.symbol.localeCompare(right.symbol);
	});

const buys = [];
const stockBuyFailures = [];
for (const stock of stocks) {
	if (buys.length >= 2) break;
	const result = await zeroExQuote(usdg, stock.address, sellAmount);
	if (result.ok) {
		buys.push({ stock, ...result });
	} else if (stockBuyFailures.length < 3) {
		stockBuyFailures.push({
			symbol: stock.symbol,
			status: result.status,
			reason: safeReason(result.body),
		});
	}
}
const first = buys[0];
const reverse = first
	? await zeroExQuote(first.stock.address, usdg, first.body.buyAmount)
	: { ok: false, status: 0, body: {} };
const spenders = new Set(
	buys.map(
		({ body }) =>
			body.issues?.allowance?.spender?.toLowerCase() ??
			body.allowanceTarget?.toLowerCase(),
	),
);
const twoAssetPreparationPassed =
	buys.length === 2 &&
	spenders.size === 1 &&
	!spenders.has(undefined) &&
	buys.every(({ body }) => validTransaction(body.transaction));
const buySimulationPassed =
	Boolean(first) &&
	first.body.issues?.simulationIncomplete === false &&
	!first.body.issues?.balance;
const reverseSimulationPassed =
	reverse.ok &&
	reverse.body.issues?.simulationIncomplete === false &&
	!reverse.body.issues?.balance;

const result = {
	chainId: Number(chainId),
	stockBuyRoutePassed: Boolean(first),
	stockBuySymbol: first?.stock.symbol ?? null,
	stockBuyFailures,
	stockBuySimulationPassed: buySimulationPassed,
	reverseRoutePassed: reverse.ok,
	reverseSimulationPassed,
	twoAssetSymbols: buys.map(({ stock }) => stock.symbol),
	twoAssetPreparationPassed,
	twoAssetQuoteSimulationPassed:
		twoAssetPreparationPassed &&
		buys.every(
			({ body }) =>
				body.issues?.simulationIncomplete === false && !body.issues?.balance,
		),
	routeReadinessPassed:
		buySimulationPassed &&
		reverseSimulationPassed &&
		twoAssetPreparationPassed &&
		buys.every(
			({ body }) =>
				body.issues?.simulationIncomplete === false && !body.issues?.balance,
		),
};
console.log(JSON.stringify(result, null, 2));
if (!result.routeReadinessPassed) process.exitCode = 1;

async function zeroExQuote(sellToken, buyToken, amount) {
	const query = new URLSearchParams({
		chainId,
		sellToken,
		buyToken,
		sellAmount: String(amount),
		taker: wallet,
		recipient: wallet,
		txOrigin,
		slippageBps: "50",
	});
	const response = await fetch(
		`https://api.0x.org/swap/allowance-holder/quote?${query}`,
		{
			headers: {
				"0x-api-key": apiKey,
				"0x-version": "v2",
			},
			signal: AbortSignal.timeout(15_000),
		},
	);
	const body = await response.json();
	return {
		ok:
			response.ok &&
			body.liquidityAvailable === true &&
			BigInt(body.buyAmount ?? 0) > 0n &&
			BigInt(body.minBuyAmount ?? 0) > 0n &&
			validTransaction(body.transaction),
		status: response.status,
		body,
	};
}

function validTransaction(transaction) {
	return Boolean(
		/^0x[a-fA-F0-9]{40}$/.test(transaction?.to ?? "") &&
			/^0x[a-fA-F0-9]+$/.test(transaction?.data ?? "") &&
			transaction?.data !== "0x",
	);
}

function safeReason(body) {
	const value = body?.reason ?? body?.message ?? "Route unavailable";
	return typeof value === "string" ? value.slice(0, 180) : "Route unavailable";
}

function requiredAddress(name) {
	const value = process.env[name];
	if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
		throw new Error(`${name} must be an EVM address`);
	}
	return value;
}
