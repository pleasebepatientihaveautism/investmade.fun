import { expect, it, vi } from "vitest";
import { ZeroGProvider } from "../src/server/adapters/zero-g.js";
import { DemoProvider } from "../src/server/adapters/demo.js";
import { feedInputSchema } from "../src/domain/schemas.js";
import { sha256 } from "../src/domain/canonical.js";

it("requests private verified 0G ranking", async () => {
  const demo = new DemoProvider();
  const candidates = await demo.getCandidates("0x0", "10000000");
  const unsigned = {
    schemaVersion: "investmade-feed-input/v1" as const,
    sessionId: "test-session",
    epochId: "test-epoch",
    policyVersion: "investmade-policy/v1" as const,
    budget: {
      periodBudgetBaseUnits: "100000000",
      slotBudgetBaseUnits: "10000000",
      maxCards: 10
    },
    preferences: {
      cadence: "weekly" as const,
      ticketSizeUsd: 10,
      riskMode: "balanced" as const,
      assetClasses: ["CRYPTO", "STOCK_TOKEN"] as const
    },
    candidates
  };
  const input = feedInputSchema.parse({
    ...unsigned,
    inputCommitment: sha256(unsigned)
  });
  const fixture = await demo.generate(input, candidates);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(fixture.output) } }],
        x_0g_trace: { tee_verified: true, provider: "0xprovider" }
      }),
      { status: 200 }
    )
  );

  const result = await new ZeroGProvider("secret").generate(input, candidates);
  const request = fetchMock.mock.calls[0];
  const init = request?.[1] as RequestInit;
  const body = JSON.parse(String(init.body));

  expect((init.headers as Record<string, string>)["X-0G-Provider-Trust-Mode"]).toBe("private");
  expect(body.verify_tee).toBe(true);
  expect(result.receipt.teeVerified).toBe(true);
  fetchMock.mockRestore();
});
