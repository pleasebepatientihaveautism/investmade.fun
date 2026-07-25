import request from "supertest";
import { describe, expect, it } from "vitest";
import { DemoProvider } from "../src/server/adapters/demo.js";
import { createApp } from "../src/server/app.js";
import { loadConfig } from "../src/server/config.js";
import { MemoryStateStore } from "../src/server/store.js";

function testApp() {
  const provider = new DemoProvider();
  return createApp({
    config: loadConfig({
      NODE_ENV: "test",
      INVESTMADE_DEMO_MODE: "true",
      PUBLIC_ORIGIN: "http://localhost:5173",
      SESSION_SECRET: "test-secret-that-is-at-least-32-characters",
      PRIVY_APP_ID: "test-privy-app-id",
      PRIVY_APP_SECRET: "test-privy-app-secret"
    }),
    store: new MemoryStateStore(),
    candidates: provider,
    inference: provider,
    execution: provider
  });
}

const onboardingPreferences = {
  cadence: "weekly",
  ticketSizeUsd: 10,
  riskMode: "balanced",
  assetClasses: ["CRYPTO", "STOCK_TOKEN"],
  riskDisclosureAccepted: true
};

describe("core API flow", () => {
  it("opens one session, generates a bounded feed, and reserves execution once", async () => {
    const app = testApp();
    const opened = await request(app).post("/api/sessions/open").send({ cadence: "weekly" }).expect(200);
    const second = await request(app).post("/api/sessions/open").send({ cadence: "weekly" }).expect(200);
    expect(second.body.id).toBe(opened.body.id);

    const feed = await request(app)
      .post(`/api/sessions/${opened.body.id}/feed`)
      .send(onboardingPreferences)
      .expect(200);
    expect(feed.body.feed.cards).toHaveLength(10);
    expect(feed.body.candidates).toHaveLength(10);
    expect(feed.body.candidates[0].quote.unitPriceUsd).toBe("3212.335367");
    expect(feed.body.proof.teeVerified).toBe(false);

    const body = {
      sessionId: opened.body.id,
      chainId: 4663,
      inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      selections: [
        { assetId: "rh:4663:WETH", amountInBaseUnits: "10000000" }
      ],
      slippageBps: 50
    };
    const prepared = await request(app).post("/api/executions/prepare").send(body).expect(200);
    const retry = await request(app).post("/api/executions/prepare").send(body).expect(200);
    expect(retry.body.plan.executionId).toBe(prepared.body.plan.executionId);

    const settled = await request(app)
      .post(`/api/executions/${prepared.body.plan.executionId}/demo-settle`)
      .expect(200);
    expect(settled.body.status).toBe("SETTLED");
    expect(settled.body.transactionHashes).toHaveLength(1);
    expect(settled.body.settledOutputs).toEqual([
      expect.objectContaining({
        assetId: "rh:4663:WETH",
        amountOutBaseUnits: "3113000000000000",
        status: "success"
      })
    ]);
  });

  it("filters the feed using validated onboarding preferences", async () => {
    const app = testApp();
    const opened = await request(app).post("/api/sessions/open").send({ cadence: "daily" }).expect(200);
    const feed = await request(app)
      .post(`/api/sessions/${opened.body.id}/feed`)
      .send({
        ...onboardingPreferences,
        cadence: "daily",
        ticketSizeUsd: 10,
        riskMode: "conservative",
        assetClasses: ["STOCK_TOKEN"]
      })
      .expect(200);

    expect(feed.body.candidates).toHaveLength(9);
    expect(
      feed.body.candidates.every((candidate: { kind: string }) => candidate.kind === "STOCK_TOKEN")
    ).toBe(true);
    expect(feed.body.feed.cards[0].amountInBaseUnits).toBe("10000000");
    expect(feed.body.candidates[0].quote.amountInBaseUnits).toBe("10000000");

    const prepared = await request(app)
      .post("/api/executions/prepare")
      .send({
        sessionId: opened.body.id,
        chainId: 4663,
        inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        selections: [{ assetId: "rh:4663:AAPL", amountInBaseUnits: "10000000" }],
        slippageBps: 50
      })
      .expect(200);
    expect(prepared.body.plan.totalInputBaseUnits).toBe("10000000");
    expect(prepared.body.plan.quotes[0].amountInBaseUnits).toBe("10000000");
  });

  it("bounds a higher ticket-size feed within the fixed period budget", async () => {
    const app = testApp();
    const opened = await request(app).post("/api/sessions/open").send({ cadence: "monthly" }).expect(200);
    const feed = await request(app)
      .post(`/api/sessions/${opened.body.id}/feed`)
      .send({ ...onboardingPreferences, cadence: "monthly", ticketSizeUsd: 25 })
      .expect(200);

    expect(feed.body.candidates).toHaveLength(4);
    expect(feed.body.feed.cards).toHaveLength(4);
    expect(feed.body.feed.cards.every((card: { amountInBaseUnits: string }) => card.amountInBaseUnits === "25000000")).toBe(true);
  });

  it("rejects a non-canonical selection", async () => {
    const app = testApp();
    const opened = await request(app).post("/api/sessions/open").send({ cadence: "weekly" }).expect(200);
    const response = await request(app)
      .post("/api/executions/prepare")
      .send({
        sessionId: opened.body.id,
        chainId: 4663,
        inputToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
        selections: [{ assetId: "rh:4663:SCAM", amountInBaseUnits: "10000000" }],
        slippageBps: 50
      })
      .expect(422);
    expect(response.body.error).toBe("ASSET_NOT_ELIGIBLE");
  });

  it("keeps a supported exit reachable outside the weekly execution path", async () => {
    const app = testApp();
    const response = await request(app)
      .post("/api/positions/rh%3A4663%3AWETH/exit/quote")
      .send({ amountInBaseUnits: "1000000000000000" })
      .expect(200);
    expect(response.body.asset.symbol).toBe("WETH");
    expect(response.body.quote.tokenOut).toBe(
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
    );
    expect(response.body.walletCalls).toEqual([]);
  });
});
