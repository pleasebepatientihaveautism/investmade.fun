import { sha256 } from "../../domain/canonical.js";
import { feedOutputSchema, type Candidate, type FeedInput } from "../../domain/schemas.js";
import type { PrivateInferenceProvider } from "./types.js";

export class ZeroGProvider implements PrivateInferenceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = "0gm-1.0-35b-a3b"
  ) {}

  async generate(input: FeedInput, _candidates: Candidate[]) {
    const response = await fetch("https://router-api.0g.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-0G-Provider-Trust-Mode": "private"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              `You are the Investmade Private Allocation Jury running inside 0G TeeML.
Privately deliberate as three roles: a market-regime analyst, a risk officer, and a preference matcher.
Return only their final consensus as valid JSON with this exact shape:
{"schemaVersion":"investmade-feed-output/v1","sessionId":"<copy input>","inputCommitment":"<copy input>","policyVersion":"<copy input>","regime":"CRYPTO_BULLISH|CRYPTO_NEUTRAL|CRYPTO_BEARISH|RISK_OFF","cards":[{"assetId":"<copy candidate>","action":"BUY","rank":1,"amountInBaseUnits":"<copy slotBudgetBaseUnits>","scoreBps":0,"evidenceIds":["<copy candidate evidence IDs>"],"reason":"<one sentence consensus>"}],"warnings":[]}
Rank only supplied candidates. Copy identifiers, policy version, commitment, amount, and evidence IDs exactly.
Include every supplied candidate exactly once, up to maxCards, with sequential ranks starting at 1.
Use scoreBps as the jury's 0–10000 consensus confidence score.
Never add assets, promise returns, change amounts, or output private deliberation.`
          },
          { role: "user", content: JSON.stringify(input) }
        ],
        response_format: { type: "json_object" },
        verify_tee: true,
        temperature: 0.2,
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 2500,
        stream: false
      }),
      signal: AbortSignal.timeout(25_000)
    });
    const body = (await response.json()) as any;
    if (!response.ok) throw new Error(`ZG_HTTP_${response.status}`);
    if (body.x_0g_trace?.tee_verified !== true) {
      throw new Error("UNVERIFIED_PRIVATE_INFERENCE");
    }
    const content = body.choices?.[0]?.message?.content;
    const output = feedOutputSchema.parse(JSON.parse(content));
    return {
      output,
      receipt: {
        network: "0G mainnet",
        model: this.model,
        provider: String(body.x_0g_trace?.provider ?? "unknown"),
        teeVerified: true,
        inputCommitment: input.inputCommitment,
        outputCommitment: sha256(output)
      }
    };
  }
}
