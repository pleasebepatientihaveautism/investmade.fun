import type {
	AppChain,
	Candidate,
	ExecutionProviderId,
} from "../../domain/schemas";
import { formatTicketSizeUsd } from "../../domain/schemas";
import { AssetMark } from "./AssetMark";
import { Close } from "./Icons";

export function BudgetRail({
	selected,
	onRemove,
	ticketSizeUsd,
	periodLimitUsd,
	executionProvider,
	activeChain,
}: {
	selected: Candidate[];
	onRemove: (assetId: string) => void;
	ticketSizeUsd: number;
	periodLimitUsd: number;
	executionProvider: ExecutionProviderId;
	activeChain: AppChain;
}) {
	const remaining = Math.max(
		0,
		Math.round((periodLimitUsd - selected.length * ticketSizeUsd) * 100) / 100,
	);
	const remainingPercent =
		periodLimitUsd > 0 ? (remaining / periodLimitUsd) * 100 : 0;

	return (
		<aside className="budget-rail" aria-label="Basket and providers">
			<div className="rail-budget">
				<span>
					This month limit: <strong>{formatTicketSizeUsd(remaining)}</strong>{" "}
					{activeChain === "SOLANA" ? "USDC" : "USDG"} left
				</span>
				<span
					className="rail-budget-progress"
					role="progressbar"
					aria-label="Monthly budget left"
					aria-valuemin={0}
					aria-valuemax={periodLimitUsd}
					aria-valuenow={remaining}
				>
					<i style={{ width: `${remainingPercent}%` }} />
				</span>
			</div>
			<div className="budget-meta">
				<span className="quote-provider">
					Execution quotes: <i aria-hidden="true" />{" "}
					{executionProvider === "ZERO_EX"
						? "0x"
						: executionProvider === "JUPITER"
							? "Jupiter"
							: "Uniswap"}
				</span>
				<span className="network-line">
					Chain: <i aria-hidden="true" />{" "}
					{activeChain === "SOLANA" ? "Solana" : "Robinhood"}
				</span>
			</div>
			{selected.length ? (
				<>
					<div className="basket-head">
						<h3>Your basket</h3>
						<span>{selected.length} assets</span>
					</div>
					<div className="basket-list">
						{selected.map((candidate) => (
							<div className="basket-row" key={candidate.assetId}>
								<AssetMark
									symbol={candidate.symbol}
									iconUrl={candidate.iconUrl}
									size="sm"
								/>
								<span className="basket-name">
									<strong>{candidate.symbol}</strong>
									<small>{candidate.name}</small>
								</span>
								<span className="basket-amount">
									<strong>{formatTicketSizeUsd(ticketSizeUsd)}</strong>
									<small>{activeChain === "SOLANA" ? "USDC" : "USDG"}</small>
								</span>
								<button
									type="button"
									onClick={() => onRemove(candidate.assetId)}
									aria-label={`Remove ${candidate.symbol}`}
								>
									<Close />
								</button>
							</div>
						))}
					</div>
				</>
			) : null}
		</aside>
	);
}
