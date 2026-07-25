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
              "Rank only supplied candidates. Return JSON matching investmade-feed-output/v1. Never add assets or change amounts."
          },
          { role: "user", content: JSON.stringify(input) }
        ],
        response_format: { type: "json_object" },
        verify_tee: true,
        temperature: 0.2,
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
