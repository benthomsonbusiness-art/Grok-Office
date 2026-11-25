import test from "node:test";
import assert from "node:assert/strict";
import { PROXY_BODY_TOO_LARGE, runProxyGuard } from "../src/proxyGuard.ts";

const url = "https://office.example/proxy/atlas/v1/chat/completions";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function run(request, checkGuardrail) {
  let forwarded = false;
  const response = await runProxyGuard({
    request,
    checkGuardrail,
    forward: async () => {
      forwarded = true;
      return new Response("upstream", { status: 200 });
    },
    onUnavailable: () => jsonResponse({ error: "Guardrail unavailable" }, 503),
    onBlocked: (reason) =>
      jsonResponse(
        {
          error: {
            message: `Grok Bot HQ Guardrail Circuit-Breaker: ${reason || "Daily cap reached"}`,
            type: "office_budget_cap_exceeded",
            code: "daily_budget_cap_reached",
          },
        },
        429
      ),
    onTooLarge: (error) => jsonResponse({ error }, 413),
  });
  return { response, forwarded };
}

test("a thrown guardrail check returns 503 and does not call upstream", async () => {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "grok-4", messages: [] }),
  });
  const { response, forwarded } = await run(req, async () => {
    throw new Error("guard down");
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Guardrail unavailable" });
  assert.equal(forwarded, false);
});

test("a non-ok guardrail response returns 503 and does not call upstream", async () => {
  const req = new Request(url, { method: "POST", body: "{}" });
  const { response, forwarded } = await run(req, async () => new Response("nope", { status: 500 }));
  assert.equal(response.status, 503);
  assert.equal(forwarded, false);
});

test("unreadable guardrail JSON returns 503 and does not call upstream", async () => {
  const req = new Request(url, { method: "POST", body: "{}" });
  const { response, forwarded } = await run(
    req,
    async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } })
  );
  assert.equal(response.status, 503);
  assert.equal(forwarded, false);
});

test("a blocked guardrail returns 429 and does not call upstream", async () => {
  const req = new Request(url, { method: "POST", body: "{}" });
  const { response, forwarded } = await run(req, async () =>
    jsonResponse({ blocked: true, reason: "Daily cap reached" })
  );
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error.type, "office_budget_cap_exceeded");
  assert.match(body.error.message, /Grok Bot HQ Guardrail Circuit-Breaker/);
  assert.equal(forwarded, false);
});

test("a normal small JSON chat body is forwarded when the guard is not blocked", async () => {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "grok-4", messages: [{ role: "user", content: "hi" }] }),
  });
  const { response, forwarded } = await run(req, async () => jsonResponse({ blocked: false }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "upstream");
  assert.equal(forwarded, true);
});

test("a body over 64 KB returns 413 and does not call upstream", async () => {
  const req = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": "70000" },
    body: "x".repeat(70000),
  });
  const { response, forwarded } = await run(req, async () => jsonResponse({ blocked: false }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: PROXY_BODY_TOO_LARGE });
  assert.equal(forwarded, false);
});

test("a stream that exceeds 64 KB returns 413 without forwarding", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40_000));
      controller.enqueue(new Uint8Array(40_000));
      controller.close();
    },
  });
  const req = new Request(url, { method: "POST", body: stream, duplex: "half" });
  const { response, forwarded } = await run(req, async () => jsonResponse({ blocked: false }));
  assert.equal(response.status, 413);
  assert.equal(forwarded, false);
});
