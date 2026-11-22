import test from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.OFFICE_URL || "http://127.0.0.1:8787";

test("static assets and security headers are served", async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.ok(res.headers.get("content-security-policy")?.includes("script-src 'self'"));

  const jsRes = await fetch(`${BASE}/office.js`);
  assert.equal(jsRes.status, 200);
});

test("demo seed populates bots, needs, goals, and usage", async () => {
  const res = await fetch(`${BASE}/api/demo/seed`, { method: "POST" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.snapshot.bots.length, 6);
  assert.ok(body.snapshot.pendingNeeds.length >= 2);
  assert.ok(body.snapshot.objectives.length >= 3);
  assert.ok(body.snapshot.usageSummary.totalTokens > 0);
  assert.ok(body.snapshot.usageSummary.totalCostUsd > 0);
});

test("zero-overhead GET /api/ping supports shorthand codes and creates need", async () => {
  const pingRes = await fetch(
    `${BASE}/api/ping?b=mini-bot&n=MiniBot&s=wait&t=Deploy+hotfix&in=500&out=200&need=Approve+hotfix`
  );
  assert.equal(pingRes.status, 200);
  const pingBody = await pingRes.json();
  assert.equal(pingBody.ok, true);
  assert.equal(pingBody.botId, "mini-bot");
  assert.ok(pingBody.needId);

  const statusRes = await fetch(`${BASE}/api/bot/mini-bot/status`);
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.equal(statusBody.openNeeds, 1);

  const resolveRes = await fetch(`${BASE}/api/needs/${pingBody.needId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve", note: "Ship it" }),
  });
  assert.equal(resolveRes.status, 200);

  const statusAfter = await (await fetch(`${BASE}/api/bot/mini-bot/status`)).json();
  assert.equal(statusAfter.openNeeds, 0);
  assert.equal(statusAfter.latestDecision, "approved");
  assert.equal(statusAfter.note, "Ship it");
});

test("objectives CRUD and settings guardrails work end-to-end", async () => {
  const createRes = await fetch(`${BASE}/api/objectives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Ship V2 Office",
      ownerBotId: "atlas-research",
      targetLabel: "100% tested",
      progress: 50,
    }),
  });
  assert.equal(createRes.status, 200);
  const { id } = await createRes.json();

  const patchRes = await fetch(`${BASE}/api/objectives/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ progress: 100 }),
  });
  assert.equal(patchRes.status, 200);

  const settingsRes = await fetch(`${BASE}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dailyCostCapUsd: 15, autoIdleMinutes: 7 }),
  });
  assert.equal(settingsRes.status, 200);
  const settingsData = await settingsRes.json();
  assert.equal(settingsData.settings.dailyCostCapUsd, 15);
  assert.equal(settingsData.settings.autoIdleMinutes, 7);

  const csvRes = await fetch(`${BASE}/api/export.csv`);
  assert.equal(csvRes.status, 200);
  const csvText = await csvRes.text();
  assert.ok(csvText.startsWith("timestamp,bot_id,model,tokens_in,tokens_out"));
});

test("direct bot movement command updates status", async () => {
  const cmdRes = await fetch(`${BASE}/api/bots/atlas-research/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "meeting" }),
  });
  assert.equal(cmdRes.status, 200);

  const snap = await (await fetch(`${BASE}/api/snapshot`)).json();
  const atlas = snap.bots.find((b) => b.id === "atlas-research");
  assert.equal(atlas.status, "meeting");
});
