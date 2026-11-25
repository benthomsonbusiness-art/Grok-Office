import test from "node:test";
import assert from "node:assert/strict";
import {
  UNAUTHORIZED_REPORT_BODY,
  UNAUTHORIZED_REPORT_STATUS,
  decideReportAccess,
  readReportBotId,
} from "../src/reportAuth.ts";

const secret = "master-secret";
const botToken = "bot-a-checkin-token";

function auth(overrides) {
  return {
    reportSecret: secret,
    authorizationHeader: null,
    reportSecretHeader: null,
    tokenQuery: null,
    pathname: "/api/ping",
    botId: null,
    ownedCheckinToken: null,
    ...overrides,
  };
}

test("ping without a token is unauthorized when REPORT_SECRET is set", async () => {
  assert.equal(await decideReportAccess(auth({})), false);
  assert.equal(UNAUTHORIZED_REPORT_STATUS, 401);
  assert.deepEqual(UNAUTHORIZED_REPORT_BODY, { error: "Unauthorized" });
});

test("a missing candidate is unauthorized even when the bot id is missing", async () => {
  assert.equal(await decideReportAccess(auth({ botId: null })), false);
  assert.equal(await decideReportAccess(auth({ botId: "" })), false);
});

test("the master secret authorizes ping, report, bot update, and the proxy", async () => {
  const paths = [
    "/api/ping",
    "/api/report",
    "/api/bot/atlas/update",
    "/api/bot/atlas/status",
    "/proxy/atlas/v1/chat/completions",
  ];
  for (const pathname of paths) {
    assert.equal(
      await decideReportAccess(auth({ pathname, tokenQuery: secret })),
      true,
      pathname
    );
    assert.equal(
      await decideReportAccess(auth({ pathname, reportSecretHeader: secret })),
      true,
      pathname
    );
    assert.equal(
      await decideReportAccess(auth({ pathname, authorizationHeader: `Bearer ${secret}` })),
      true,
      pathname
    );
  }
});

test("a per-bot token authorizes only that bot's ping", async () => {
  assert.equal(
    await decideReportAccess(
      auth({
        pathname: "/api/ping",
        botId: "atlas",
        tokenQuery: botToken,
        ownedCheckinToken: botToken,
      })
    ),
    true
  );
  assert.equal(
    await decideReportAccess(
      auth({
        pathname: "/api/ping",
        botId: "other-bot",
        tokenQuery: botToken,
        ownedCheckinToken: "other-bot-token",
      })
    ),
    false
  );
  assert.equal(
    await decideReportAccess(
      auth({
        pathname: "/api/ping",
        botId: null,
        tokenQuery: botToken,
        ownedCheckinToken: botToken,
      })
    ),
    false
  );
});

test("a per-bot token does not authorize the proxy, report, or bot update", async () => {
  const blocked = ["/proxy/atlas/v1/chat/completions", "/api/report", "/api/bot/atlas/update"];
  for (const pathname of blocked) {
    assert.equal(
      await decideReportAccess(
        auth({
          pathname,
          botId: "atlas",
          tokenQuery: botToken,
          reportSecretHeader: botToken,
          ownedCheckinToken: botToken,
        })
      ),
      false,
      pathname
    );
  }
});

test("an unset REPORT_SECRET allows the request", async () => {
  assert.equal(await decideReportAccess(auth({ reportSecret: undefined })), true);
  assert.equal(await decideReportAccess(auth({ reportSecret: "" })), true);
});

test("bot id is read from b, then botId", () => {
  const params = new URLSearchParams("b=atlas&botId=other");
  assert.equal(readReportBotId(params), "atlas");
  assert.equal(readReportBotId(new URLSearchParams("botId=other")), "other");
  assert.equal(readReportBotId(new URLSearchParams("")), "");
});
