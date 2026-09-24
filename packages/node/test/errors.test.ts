import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EpayApiError,
  EpayAuthenticationError,
  EpayBadRequestError,
  EpayConflictError,
  EpayError,
  EpayNotFoundError,
  EpayPermissionDeniedError,
  EpayRateLimitError,
  EpayServerError,
} from "../dist/esm/index.js";

function build(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return EpayApiError.from({
    status,
    body,
    headers,
    request: "GET /transactions",
  });
}

test("status codes map to specific error classes", () => {
  const cases: Array<[number, new (...args: never[]) => EpayApiError]> = [
    [400, EpayBadRequestError],
    [401, EpayAuthenticationError],
    [403, EpayPermissionDeniedError],
    [404, EpayNotFoundError],
    [409, EpayConflictError],
    [429, EpayRateLimitError],
    [500, EpayServerError],
    [503, EpayServerError],
  ];

  for (const [status, expected] of cases) {
    const error = build(status, null);
    assert.ok(
      error instanceof expected,
      `${status} should be ${expected.name}`,
    );
    assert.ok(error instanceof EpayApiError);
    assert.ok(error instanceof EpayError);
    assert.equal(error.status, status);
  }
});

test("an unmapped 4xx stays a plain EpayApiError", () => {
  const error = build(418, null);
  assert.equal(error.constructor, EpayApiError);
});

test("the transaction-endpoint error envelope is unwrapped", () => {
  const error = build(401, {
    status: "error",
    data: { message: "Missing or malformed Authorization header" },
  });
  assert.match(error.message, /Missing or malformed Authorization header/);
  assert.match(error.message, /GET \/transactions failed with 401/);
});

test("the payment-provider error envelope is unwrapped", () => {
  const error = build(401, {
    statusCode: 401,
    message: "Invalid or inactive API key",
    error: "Unauthorized",
  });
  assert.match(error.message, /Invalid or inactive API key/);
});

test("an array of validation messages is joined", () => {
  const error = build(400, {
    statusCode: 400,
    message: ["amount must be positive", "currencyCode is required"],
  });
  assert.match(
    error.message,
    /amount must be positive; currencyCode is required/,
  );
});

test("a non-JSON or empty body still yields a usable message", () => {
  assert.match(build(502, "Bad Gateway").message, /Bad Gateway/);
  assert.match(build(500, null).message, /HTTP 500/);
  assert.match(build(500, {}).message, /HTTP 500/);
});

test("errors carry the response body and headers for inspection", () => {
  const body = { status: "error", data: { message: "nope" } };
  const error = build(400, body, { "x-request-id": "req_1" });
  assert.deepEqual(error.body, body);
  assert.equal(error.headers["x-request-id"], "req_1");
  assert.equal(error.request, "GET /transactions");
});

test("rate limit errors expose Retry-After as seconds", () => {
  const numeric = build(429, null, {
    "retry-after": "30",
  }) as EpayRateLimitError;
  assert.equal(numeric.retryAfterSeconds, 30);

  const absent = build(429, null) as EpayRateLimitError;
  assert.equal(absent.retryAfterSeconds, null);

  const httpDate = new Date(Date.now() + 10_000).toUTCString();
  const dated = build(429, null, {
    "retry-after": httpDate,
  }) as EpayRateLimitError;
  assert.ok(
    (dated.retryAfterSeconds ?? 0) > 5,
    "HTTP-date should parse to a positive delay",
  );
});

test("error names survive subclassing, so logs are readable", () => {
  assert.equal(build(404, null).name, "EpayNotFoundError");
  assert.ok(build(404, null).stack?.includes("EpayNotFoundError"));
});
