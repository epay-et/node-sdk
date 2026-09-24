import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { signWebhookPayload } from "../dist/esm/index.js";
import { expressEpayWebhook } from "../dist/esm/middleware/express.js";
import { createEpayWebhookHandler } from "../dist/esm/middleware/fetch.js";

const SECRET = "whsec_test";
const PAYLOAD = JSON.stringify({
  event: "payment.success",
  reference: "PAB12CD3420260813",
  status: "completed",
});

function header(payload = PAYLOAD): string {
  return `sha256=${signWebhookPayload(payload, SECRET)}`;
}

/** Minimal stand-in for an Express response, recording what was sent. */
function fakeResponse() {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    send(body?: unknown) {
      sent.body = body;
      return res;
    },
  };
  return { res, sent };
}

/** Request whose body is a Buffer, as `express.raw()` leaves it. */
function rawRequest(payload: string, signature: string | undefined) {
  const request = Readable.from([]) as unknown as Parameters<
    ReturnType<typeof expressEpayWebhook>
  >[0];
  Object.assign(request, {
    headers: { "x-epay-signature": signature },
    body: Buffer.from(payload, "utf8"),
  });
  return request;
}

test("express: a valid delivery is parsed and acknowledged with 200", async () => {
  const seen: unknown[] = [];
  const handler = expressEpayWebhook({
    secret: SECRET,
    onEvent: (event) => seen.push(event),
  });
  const { res, sent } = fakeResponse();

  await handler(rawRequest(PAYLOAD, header()), res);

  assert.equal(sent.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(
    (seen[0] as { reference: string }).reference,
    "PAB12CD3420260813",
  );
});

test("express: a bad signature is rejected with 401 and onEvent never runs", async () => {
  let called = false;
  const handler = expressEpayWebhook({
    secret: SECRET,
    onEvent: () => {
      called = true;
    },
  });
  const { res, sent } = fakeResponse();

  await handler(rawRequest(PAYLOAD, "sha256=deadbeef"), res);

  assert.equal(sent.status, 401);
  assert.equal(called, false);
});

test("express: a missing signature header is rejected with 401", async () => {
  const handler = expressEpayWebhook({ secret: SECRET, onEvent: () => {} });
  const { res, sent } = fakeResponse();

  await handler(rawRequest(PAYLOAD, undefined), res);

  assert.equal(sent.status, 401);
});

test("express: an already-parsed body is reported, not silently re-serialized", async () => {
  const handler = expressEpayWebhook({ secret: SECRET, onEvent: () => {} });
  const { res, sent } = fakeResponse();

  const request = Readable.from([]) as never;
  Object.assign(request, {
    headers: { "x-epay-signature": header() },
    body: JSON.parse(PAYLOAD), // what express.json() would leave behind
  });

  await handler(request, res);

  assert.equal(sent.status, 401);
  assert.match(
    String((sent.body as { error: string }).error),
    /already parsed|express\.raw/,
  );
});

test("express: the raw body is read from the stream when no parser ran", async () => {
  const seen: unknown[] = [];
  const handler = expressEpayWebhook({
    secret: SECRET,
    onEvent: (event) => seen.push(event),
  });
  const { res, sent } = fakeResponse();

  const request = Readable.from([Buffer.from(PAYLOAD, "utf8")]) as never;
  Object.assign(request, { headers: { "x-epay-signature": header() } });

  await handler(request, res);

  assert.equal(sent.status, 200);
  assert.equal(seen.length, 1);
});

test("express: a throwing onEvent becomes a 400 rather than an unhandled rejection", async () => {
  const handler = expressEpayWebhook({
    secret: SECRET,
    onEvent: () => {
      throw new Error("queue is down");
    },
  });
  const { res, sent } = fakeResponse();

  await handler(rawRequest(PAYLOAD, header()), res);

  assert.equal(sent.status, 400);
  assert.match(String((sent.body as { error: string }).error), /queue is down/);
});

test("express: onError overrides the default reply", async () => {
  const handler = expressEpayWebhook({
    secret: SECRET,
    onEvent: () => {},
    onError: (_error, _req, res) => res.status(418).send("teapot"),
  });
  const { res, sent } = fakeResponse();

  await handler(rawRequest(PAYLOAD, "sha256=00"), res);

  assert.equal(sent.status, 418);
});

test("fetch: a valid delivery returns the success status", async () => {
  const seen: unknown[] = [];
  const handler = createEpayWebhookHandler({
    secret: SECRET,
    onEvent: (event) => seen.push(event),
  });

  const response = await handler(
    new Request("https://store.example/webhooks/epay", {
      method: "POST",
      headers: { "x-epay-signature": header() },
      body: PAYLOAD,
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
});

test("fetch: a tampered body is rejected with 401", async () => {
  const handler = createEpayWebhookHandler({
    secret: SECRET,
    onEvent: () => {},
  });

  const response = await handler(
    new Request("https://store.example/webhooks/epay", {
      method: "POST",
      headers: { "x-epay-signature": header() },
      body: PAYLOAD.replace("completed", "failed"),
    }),
  );

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /does not match/);
});

test("fetch: a throwing onEvent becomes a 400", async () => {
  const handler = createEpayWebhookHandler({
    secret: SECRET,
    onEvent: () => {
      throw new Error("downstream unavailable");
    },
  });

  const response = await handler(
    new Request("https://store.example/webhooks/epay", {
      method: "POST",
      headers: { "x-epay-signature": header() },
      body: PAYLOAD,
    }),
  );

  assert.equal(response.status, 400);
});
