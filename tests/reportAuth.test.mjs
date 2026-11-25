import test from "node:test";
import assert from "node:assert/strict";
import { decideReportAuthorization, readReportCandidate } from "../src/reportAuth.ts";

const SECRET = "test-secret";
const BOT_TOKEN = "bot-token-ada";

function decide(overrides) {
  return decideReportAuthorization({
    reportSecret: SECRET,
    candidate: "",
    masterMatch: false,
    pathname: "/api/ping",
    botId: null,
    botTokenMatch: false,
    ...overrides,
  });
}

test("ping without a token is unauthorized when REPORT_SECRET is set", () => {
  const candidate = readReportCandidate({
    authorization: null,
    reportSecretHeader: null,
    tokenQuery: null,
  });
  assert.equal(candidate, "");
  assert.equal(
    decide({ candidate, pathname: "/api/ping", botId: "audit-probe" }),
    false
  );
  assert.equal(decide({ candidate, pathname: "/api/ping", botId: null }), false);
});

test("master secret authorizes ping, report, bot update, and proxy", () => {
  for (const pathname of ["/api/ping", "/api/report", "/api/bot/ada/update", "/proxy/ada/v1/chat/completions"]) {
    assert.equal(
      decide({ candidate: SECRET, masterMatch: true, pathname, botId: "ada" }),
      true,
      pathname
    );
  }
});

test("per-bot token authorizes only that bot's ping", () => {
  assert.equal(
    decide({
      candidate: BOT_TOKEN,
      pathname: "/api/ping",
      botId: "ada",
      botTokenMatch: true,
    }),
    true
  );
  assert.equal(
    decide({
      candidate: BOT_TOKEN,
      pathname: "/api/ping",
      botId: "other",
      botTokenMatch: false,
    }),
    false
  );
  assert.equal(
    decide({
      candidate: BOT_TOKEN,
      pathname: "/api/ping",
      botId: null,
      botTokenMatch: false,
    }),
    false
  );
  for (const pathname of ["/proxy/ada/v1/chat/completions", "/api/report", "/api/bot/ada/update", "/api/bot/ada/status"]) {
    assert.equal(
      decide({
        candidate: BOT_TOKEN,
        pathname,
        botId: "ada",
        botTokenMatch: false,
      }),
      false,
      pathname
    );
  }
});

test("unset REPORT_SECRET allows the request", () => {
  assert.equal(
    decide({
      reportSecret: undefined,
      candidate: "",
      pathname: "/api/ping",
      botId: null,
    }),
    true
  );
  assert.equal(
    decide({
      reportSecret: "",
      candidate: "",
      pathname: "/proxy/ada/v1/chat/completions",
    }),
    true
  );
});

test("bearer, header, and query are the only candidate sources", () => {
  assert.equal(
    readReportCandidate({
      authorization: "Bearer test-secret",
      reportSecretHeader: null,
      tokenQuery: null,
    }),
    "test-secret"
  );
  assert.equal(
    readReportCandidate({
      authorization: null,
      reportSecretHeader: " test-secret ",
      tokenQuery: null,
    }),
    "test-secret"
  );
  assert.equal(
    readReportCandidate({
      authorization: null,
      reportSecretHeader: null,
      tokenQuery: "bot-token-ada",
    }),
    "bot-token-ada"
  );
});
