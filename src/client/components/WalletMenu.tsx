import { useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { UserPill } from "@privy-io/react-auth/ui";
import { Dialog, Popover, Select } from "radix-ui";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  Send,
  Settings,
  WalletCards,
  X
} from "lucide-react";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex
} from "viem";
import {
  ASSET_REGISTRY,
  ROBINHOOD_CHAIN_ID,
  USDG_ADDRESS,
  USDG_DECIMALS
} from "../../domain/constants";

const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";

type SendToken = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  address?: Address;
};

type SendStatus = "idle" | "preparing" | "signing" | "success";

const DEFAULT_SEND_TOKEN: SendToken = {
  id: "USDG",
  symbol: "USDG",
  name: "Global Dollar",
  decimals: USDG_DECIMALS,
  address: USDG_ADDRESS
};

const robinhoodClient = createPublicClient({
  transport: http(ROBINHOOD_RPC_URL)
});

const SEND_TOKENS = buildSendTokens();

export function WalletMenu({ wallet }: { wallet: string }) {
  const { logout } = usePrivy();
  const { client: smartWalletClient, getClientForChain } = useSmartWallets();
  const privyAccountTriggerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tokenId, setTokenId] = useState("USDG");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint>();
  const [balanceError, setBalanceError] = useState("");
  const [sendError, setSendError] = useState("");
  const [status, setStatus] = useState<SendStatus>("idle");
  const [transactionHash, setTransactionHash] = useState<Hex>();

  const selectedToken = useMemo(
    () => SEND_TOKENS.find((token) => token.id === tokenId) ?? DEFAULT_SEND_TOKEN,
    [tokenId]
  );
  const amountBaseUnits = parseTokenAmount(amount, selectedToken.decimals);
  const recipientValid =
    isAddress(recipient) && recipient.toLowerCase() !== zeroAddress.toLowerCase();
  const amountValid =
    amountBaseUnits !== undefined &&
    amountBaseUnits > 0n &&
    balance !== undefined &&
    amountBaseUnits <= balance;
  const busy = status === "preparing" || status === "signing";

  useEffect(() => {
    if (!sendOpen || !wallet || !selectedToken) return;
    let cancelled = false;
    setBalance(undefined);
    setBalanceError("");

    readTokenBalance(wallet as Address, selectedToken)
      .then((nextBalance) => {
        if (!cancelled) setBalance(nextBalance);
      })
      .catch((caught) => {
        if (!cancelled) {
          setBalanceError(
            caught instanceof Error ? caught.message : "Could not load token balance."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedToken, sendOpen, wallet]);

  function openSend() {
    setMenuOpen(false);
    setSendOpen(true);
    setSendError("");
    setStatus("idle");
    setTransactionHash(undefined);
  }

  function openPrivyAccount() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      const trigger = privyAccountTriggerRef.current?.querySelector("button");
      if (!trigger) return;
      trigger.tabIndex = -1;
      trigger.click();
    });
  }

  function closeSend(open: boolean) {
    if (busy) return;
    setSendOpen(open);
    if (!open) {
      setRecipient("");
      setAmount("");
      setSendError("");
      setStatus("idle");
      setTransactionHash(undefined);
    }
  }

  async function copyWallet() {
    await navigator.clipboard.writeText(wallet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  async function sendToken() {
    setSendError("");
    if (!recipientValid) {
      setSendError("Enter a valid recipient address.");
      return;
    }
    if (amountBaseUnits === undefined || amountBaseUnits <= 0n) {
      setSendError("Enter a valid amount.");
      return;
    }
    if (balance === undefined || amountBaseUnits > balance) {
      setSendError(`Not enough ${selectedToken.symbol}.`);
      return;
    }

    try {
      setStatus("preparing");
      const client =
        smartWalletClient ?? (await getClientForChain({ id: ROBINHOOD_CHAIN_ID }));
      if (!client || client.account.address.toLowerCase() !== wallet.toLowerCase()) {
        throw new Error("The active Privy smart wallet does not match this account.");
      }

      const call = createSendCall(
        selectedToken,
        recipient as Address,
        amountBaseUnits
      );
      await client.prepareUserOperation({ calls: [call] });
      setStatus("signing");
      const hash = await client.sendTransaction(
        { calls: [call] },
        {
          uiOptions: {
            description: `Send ${amount} ${selectedToken.symbol} to ${shortAddress(recipient)} on Robinhood Chain.`,
            buttonText: `Send ${selectedToken.symbol}`
          }
        }
      );
      setTransactionHash(hash);
      setStatus("success");
      setBalance((current) =>
        current === undefined ? current : current - amountBaseUnits
      );
    } catch (caught) {
      setStatus("idle");
      setSendError(sendErrorMessage(caught));
    }
  }

  return (
    <>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="wallet-menu-trigger"
            aria-label={`Open wallet menu for ${wallet}`}
          >
            <WalletCards aria-hidden="true" />
            {shortAddress(wallet)}
            <ChevronDown className="wallet-menu-chevron" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="wallet-menu-content"
            sideOffset={8}
            align="end"
            collisionPadding={12}
          >
            <div className="wallet-menu-heading">
              <span>Investmade Wallet</span>
              <strong>{shortAddress(wallet)}</strong>
            </div>
            <button type="button" className="wallet-menu-action primary" onClick={openSend}>
              <Send aria-hidden="true" />
              Send tokens
            </button>
            <button
              type="button"
              className="wallet-menu-action"
              onClick={openPrivyAccount}
            >
              <Settings aria-hidden="true" />
              Account settings
            </button>
            <button type="button" className="wallet-menu-action" onClick={() => void copyWallet()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Address copied" : "Copy address"}
            </button>
            <div className="wallet-menu-separator" />
            <button
              type="button"
              className="wallet-menu-action danger"
              onClick={() => void logout()}
            >
              <LogOut aria-hidden="true" />
              Log out
            </button>
            <Popover.Arrow className="wallet-menu-arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <div
        ref={privyAccountTriggerRef}
        className="privy-account-trigger-bridge"
        aria-hidden="true"
      >
        <UserPill expanded={false} size={40} ui={{ minimal: true, background: "secondary" }} />
      </div>

      <Dialog.Root open={sendOpen} onOpenChange={closeSend}>
        <Dialog.Portal>
          <Dialog.Overlay className="send-dialog-overlay" />
          <Dialog.Content className="send-dialog-content">
            {status === "success" && transactionHash ? (
              <div className="send-success">
                <span className="send-success-icon"><Check aria-hidden="true" /></span>
                <Dialog.Title>Transfer submitted</Dialog.Title>
                <Dialog.Description>
                  {amount} {selectedToken.symbol} is on its way to {shortAddress(recipient)}.
                </Dialog.Description>
                <a
                  className="button button-outline"
                  href={`${ROBINHOOD_EXPLORER_URL}/tx/${transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction <ExternalLink aria-hidden="true" />
                </a>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => closeSend(false)}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="send-dialog-header">
                  <div>
                    <span className="account-label">Robinhood Chain · 4663</span>
                    <Dialog.Title>Send from Investmade Wallet</Dialog.Title>
                    <Dialog.Description>
                      Review the details, then confirm once in Privy.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="send-dialog-close"
                      aria-label="Close send dialog"
                      disabled={busy}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="send-from-row">
                  <span>From</span>
                  <code>{wallet}</code>
                </div>

                <div className="send-field">
                  <span id="send-token-label">Token</span>
                  <Select.Root
                    value={tokenId}
                    onValueChange={(value) => {
                      setTokenId(value);
                      setAmount("");
                      setSendError("");
                    }}
                    disabled={busy}
                  >
                    <Select.Trigger className="send-select-trigger" aria-labelledby="send-token-label">
                      <Select.Value />
                      <Select.Icon><ChevronDown aria-hidden="true" /></Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="send-select-content" position="popper" sideOffset={6}>
                        <Select.Viewport>
                          {SEND_TOKENS.map((token) => (
                            <Select.Item
                              className="send-select-item"
                              key={token.id}
                              value={token.id}
                            >
                              <Select.ItemText>
                                {token.symbol} · {token.name}
                              </Select.ItemText>
                              <Select.ItemIndicator><Check aria-hidden="true" /></Select.ItemIndicator>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                  <small>
                    {balance === undefined
                      ? balanceError || "Loading balance…"
                      : `Available: ${formatTokenBalance(balance, selectedToken.decimals)} ${selectedToken.symbol}`}
                  </small>
                </div>

                <label className="send-field">
                  <span>Recipient address</span>
                  <input
                    value={recipient}
                    onChange={(event) => {
                      setRecipient(event.target.value.trim());
                      setSendError("");
                    }}
                    placeholder="0x…"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                </label>

                <label className="send-field">
                  <span>Amount</span>
                  <div className="send-amount-input">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => {
                        setAmount(event.target.value.replace(",", "."));
                        setSendError("");
                      }}
                      placeholder="0.00"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (balance !== undefined) {
                          setAmount(formatUnits(balance, selectedToken.decimals));
                        }
                      }}
                      disabled={busy || balance === undefined || balance === 0n}
                    >
                      Max
                    </button>
                    <strong>{selectedToken.symbol}</strong>
                  </div>
                </label>

                {sendError || balanceError ? (
                  <p className="send-error" role="alert">{sendError || balanceError}</p>
                ) : null}

                <div className="send-dialog-actions">
                  <Dialog.Close asChild>
                    <button type="button" className="button button-outline" disabled={busy}>
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={!recipientValid || !amountValid || busy || Boolean(balanceError)}
                    onClick={() => void sendToken()}
                  >
                    {status === "preparing"
                      ? "Checking transaction…"
                      : status === "signing"
                        ? "Confirm in Privy…"
                        : <>Send {selectedToken.symbol} <Send aria-hidden="true" /></>}
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function buildSendTokens(): SendToken[] {
  const tokens: SendToken[] = [
    { id: "ETH", symbol: "ETH", name: "Robinhood Chain gas token", decimals: 18 },
    DEFAULT_SEND_TOKEN
  ];
  const addresses = new Set(
    tokens.flatMap((token) => token.address ? [token.address.toLowerCase()] : [])
  );

  for (const asset of Object.values(ASSET_REGISTRY)) {
    if (addresses.has(asset.address.toLowerCase())) continue;
    addresses.add(asset.address.toLowerCase());
    tokens.push({
      id: asset.symbol,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      address: asset.address as Address
    });
  }
  return tokens;
}

async function readTokenBalance(wallet: Address, token: SendToken) {
  if (!token.address) return robinhoodClient.getBalance({ address: wallet });
  return robinhoodClient.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [wallet]
  });
}

function createSendCall(token: SendToken, recipient: Address, amount: bigint) {
  if (!token.address) return { to: recipient, value: amount, data: "0x" as Hex };
  return {
    to: token.address,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amount]
    })
  };
}

function parseTokenAmount(value: string, decimals: number) {
  const normalized = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return undefined;
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return undefined;
  }
}

function formatTokenBalance(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const compactFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

function shortAddress(address: string) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function sendErrorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "";
  if (/reject|denied|cancel/i.test(message)) return "Transaction cancelled in Privy.";
  if (/insufficient|balance/i.test(message)) return "The wallet does not have enough funds.";
  if (/paymaster|bundler|user operation|smart wallet/i.test(message)) {
    return "The Investmade Wallet could not prepare this transfer. Check Robinhood Chain smart-wallet settings.";
  }
  return message || "The transfer could not be submitted.";
}
