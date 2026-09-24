import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Epay,
  EpayAuthenticationError,
  EpayBadRequestError,
  EpayNotFoundError,
  EpayPermissionDeniedError,
  EpayRateLimitError,
  EpayServerError,
  EpayTimeoutError,
  EpayValidationError,
} from "../dist/esm/index.js";
import { hangingFetch, mockFetch, reply } from "./support/mock-fetch.ts";

const API_KEY = "sk_test_0123456789abcdef";

/** Builds a client wired to a scripted transport, with retries off by default. */
function client(
  replies: Parameters<typeof mockFetch>[0],
  options: { maxRetries?: number } = {},
) {
  const { fetch, calls } = mockFetch(replies);
  return {
    epay: new Epay({
      apiKey: API_KEY,
      fetch,
      maxRetries: options.maxRetries ?? 0,
    }),
    calls,
  };
}

const SESSION = {
  reference: "PAB12CD3420260813",
  checkoutUrl: "https://checkout.epayethiopia.com/pay/PAB12CD3420260813",
  status: "success",
  expiresAt: "2026-08-13T12:30:00.000Z",
};

// --- initialize -------------------------------------------------------------

test("initialize posts to the documented path with auth and JSON headers", async () => {
  const { epay, calls } = client([{ body: SESSION }]);

  const session = await epay.payments.initialize({
    amount: "250.00",
    currencyCode: "ETB",
    customerPhone: "+251911234567",
    merchantReference: "order_123",
  });

  assert.deepEqual(session, SESSION);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/transactions/initialize",
  );
  assert.equal(calls[0]!.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0]!.headers["Content-Type"], "application/json");
  assert.match(calls[0]!.headers["User-Agent"]!, /^epay-node\//);
});

test("initialize normalizes amount, currency, and phone before sending", async () => {
  const { epay, calls } = client([{ body: SESSION }]);

  await epay.payments.initialize({
    amount: 250,
    currencyCode: "etb",
    customerPhone: "0911234567",
  });

  assert.deepEqual(calls[0]!.body, {
    amount: "250.00",
    currencyCode: "ETB",
    customerPhone: "+251911234567",
  });
});

test("initialize omits optional fields the caller did not set", async () => {
  const { epay, calls } = client([{ body: SESSION }]);

  await epay.payments.initialize({
    amount: "10.00",
    currencyCode: "ETB",
    customerPhone: "0911234567",
    email: "abebe@example.com",
    returnUrl: "https://store.example/done",
  });

  const body = calls[0]!.body as Record<string, unknown>;
  assert.equal(body.email, "abebe@example.com");
  assert.equal(body.returnUrl, "https://store.example/done");
  assert.ok(
    !("merchantReference" in body),
    "unset fields should be absent, not null",
  );
  assert.ok(!("firstName" in body));
  assert.ok(!("callbackUrl" in body));
});

test("initialize sends the caller idempotency key verbatim", async () => {
  const { epay, calls } = client([{ body: SESSION }]);

  await epay.payments.initialize(
    { amount: "10.00", currencyCode: "ETB", customerPhone: "0911234567" },
    { idempotencyKey: "order_123" },
  );

  assert.equal(calls[0]!.headers["x-idempotency-key"], "order_123");
});

test("initialize generates an idempotency key when none is given", async () => {
  const { epay, calls } = client([{ body: SESSION }]);

  await epay.payments.initialize({
    amount: "10.00",
    currencyCode: "ETB",
    customerPhone: "0911234567",
  });

  assert.match(calls[0]!.headers["x-idempotency-key"]!, /.{8,}/);
});

test("initialize validates locally before spending a request", async () => {
  const { epay, calls } = client([]);

  await assert.rejects(
    () =>
      epay.payments.initialize({
        amount: "-1",
        currencyCode: "ETB",
        customerPhone: "0911234567",
      }),
    EpayValidationError,
  );
  await assert.rejects(
    () =>
      epay.payments.initialize({
        amount: "1.00",
        currencyCode: "ETB",
        customerPhone: "123",
      }),
    EpayValidationError,
  );
  await assert.rejects(
    () =>
      epay.payments.initialize(
        { amount: "1.00", currencyCode: "ETB", customerPhone: "0911234567" },
        { idempotencyKey: "x".repeat(256) },
      ),
    EpayValidationError,
  );
  assert.equal(calls.length, 0, "no request should reach the network");
});

test('initialize surfaces a 404 as "no payment source"', async () => {
  const { epay } = client([
    {
      status: 404,
      body: { status: "error", data: { message: "No payment source found" } },
    },
  ]);

  await assert.rejects(
    () =>
      epay.payments.initialize({
        amount: "1.00",
        currencyCode: "ETB",
        customerPhone: "0911234567",
      }),
    (error: unknown) => {
      assert.ok(error instanceof EpayNotFoundError);
      assert.match((error as Error).message, /No payment source found/);
      return true;
    },
  );
});

// --- verify and cancel ------------------------------------------------------

test("verify hits the verify path and returns the receipt", async () => {
  const receipt = {
    reference: "PAB12CD3420260813",
    merchantReference: "order_123",
    status: "completed",
    amount: "250.00",
    serviceFee: "7.50",
    currencyCode: "ETB",
    paymentMethod: "telebirr",
    customer: {
      name: "Abebe Bikila",
      email: "abebe@example.com",
      phone: "+251911234567",
    },
    paidAt: "2026-08-13T11:47:00.000Z",
    createdAt: "2026-08-13T11:30:00.000Z",
  };
  const { epay, calls } = client([{ body: receipt }]);

  const result = await epay.payments.verify("PAB12CD3420260813");

  assert.equal(calls[0]!.method, "GET");
  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/transactions/PAB12CD3420260813/verify",
  );
  assert.equal(result.serviceFee, "7.50");
  assert.equal(result.customer.name, "Abebe Bikila");
});

test("verify reports an incomplete transaction as a bad request", async () => {
  const { epay } = client([
    {
      status: 400,
      body: {
        status: "error",
        data: {
          message: "Transaction is not completed. Current status: pending",
        },
      },
    },
  ]);

  await assert.rejects(
    () => epay.payments.verify("PAB1"),
    (error: unknown) => {
      assert.ok(error instanceof EpayBadRequestError);
      assert.match((error as Error).message, /Current status: pending/);
      return true;
    },
  );
});

test("cancel resolves on 204 with no body", async () => {
  const { epay, calls } = client([{ status: 204 }]);

  assert.equal(await epay.payments.cancel("PAB12CD3420260813"), undefined);
  assert.equal(calls[0]!.method, "POST");
  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/transactions/PAB12CD3420260813/cancel",
  );
  assert.equal(calls[0]!.body, undefined);
});

test("cancel is never retried, since the endpoint takes no idempotency key", async () => {
  const { epay, calls } = client([{ status: 500, body: null }], {
    maxRetries: 3,
  });

  await assert.rejects(() => epay.payments.cancel("PAB1"), EpayServerError);
  assert.equal(
    calls.length,
    1,
    "a non-idempotent POST must be attempted exactly once",
  );
});

test("references are URL-encoded rather than interpolated raw", async () => {
  const { epay, calls } = client([{ body: {} }]);
  await epay.transactions.retrieve("PAB 1/2");
  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/transactions/PAB%201%2F2",
  );
});

test("an empty reference is rejected locally", async () => {
  const { epay, calls } = client([]);
  await assert.rejects(
    () => epay.transactions.retrieve("  "),
    EpayValidationError,
  );
  await assert.rejects(() => epay.payments.verify(""), EpayValidationError);
  assert.equal(calls.length, 0);
});

// --- transactions -----------------------------------------------------------

test("list builds the documented query string", async () => {
  const { epay, calls } = client([
    { body: { data: [], nextCursor: null, hasMore: false } },
  ]);

  await epay.transactions.list({
    status: "completed",
    currency: "etb",
    from: "2026-08-01",
    to: "2026-08-31",
  });

  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v1/transactions");
  assert.equal(url.searchParams.get("status"), "completed");
  assert.equal(url.searchParams.get("currency"), "ETB");
  assert.equal(url.searchParams.get("from"), "2026-08-01");
  assert.equal(url.searchParams.get("to"), "2026-08-31");
});

test("list accepts Date objects for the range", async () => {
  const { epay, calls } = client([
    { body: { data: [], nextCursor: null, hasMore: false } },
  ]);

  await epay.transactions.list({
    from: new Date("2026-08-01T00:00:00Z"),
    to: new Date("2026-08-31T00:00:00Z"),
  });

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get("from"), "2026-08-01");
  assert.equal(url.searchParams.get("to"), "2026-08-31");
});

test("list rejects an inverted range and an unknown status locally", async () => {
  const { epay, calls } = client([]);

  await assert.rejects(
    () => epay.transactions.list({ from: "2026-08-31", to: "2026-08-01" }),
    EpayValidationError,
  );
  await assert.rejects(
    () => epay.transactions.list({ status: "expired" as never }),
    EpayValidationError,
  );
  assert.equal(calls.length, 0);
});

test("a page exposes its own data without fetching more", async () => {
  const txn = {
    reference: "PAB12CD3420260813",
    merchantReference: "order_123",
    status: "completed",
    amount: "250.00",
    currencyCode: "ETB",
    paidAt: "2026-08-13T11:47:00.000Z",
    createdAt: "2026-08-13T11:30:00.000Z",
  };
  const { epay, calls } = client([
    { body: { data: [txn], nextCursor: "cur_1", hasMore: true } },
  ]);

  const page = await epay.transactions.list();

  assert.equal(page.data.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, "cur_1");
  assert.equal(calls.length, 1);
});

test("iterating a page walks every following page, forwarding filters", async () => {
  const txn = (reference: string) => ({
    reference,
    merchantReference: null,
    status: "completed",
    amount: "10.00",
    currencyCode: "ETB",
    paidAt: null,
    createdAt: "2026-08-13T11:30:00.000Z",
  });

  const { epay, calls } = client([
    {
      body: {
        data: [txn("P1"), txn("P2")],
        nextCursor: "cur_1",
        hasMore: true,
      },
    },
    { body: { data: [txn("P3")], nextCursor: "cur_2", hasMore: true } },
    { body: { data: [txn("P4")], nextCursor: null, hasMore: false } },
  ]);

  const seen: string[] = [];
  for await (const transaction of await epay.transactions.list({
    status: "completed",
  })) {
    seen.push(transaction.reference);
  }

  assert.deepEqual(seen, ["P1", "P2", "P3", "P4"]);
  assert.equal(calls.length, 3);
  // The cursor advances while the filter persists across pages.
  assert.equal(new URL(calls[0]!.url).searchParams.get("cursor"), null);
  assert.equal(new URL(calls[1]!.url).searchParams.get("cursor"), "cur_1");
  assert.equal(new URL(calls[2]!.url).searchParams.get("cursor"), "cur_2");
  for (const call of calls) {
    assert.equal(new URL(call.url).searchParams.get("status"), "completed");
  }
});

test("toArray stops fetching once the limit is reached", async () => {
  const txn = (reference: string) => ({
    reference,
    merchantReference: null,
    status: "pending",
    amount: "1.00",
    currencyCode: "ETB",
    paidAt: null,
    createdAt: "2026-08-13T11:30:00.000Z",
  });

  const { epay, calls } = client([
    {
      body: {
        data: [txn("P1"), txn("P2")],
        nextCursor: "cur_1",
        hasMore: true,
      },
    },
    { body: { data: [txn("P3")], nextCursor: "cur_2", hasMore: true } },
  ]);

  const first = await (await epay.transactions.list()).toArray(3);

  assert.deepEqual(
    first.map((t) => t.reference),
    ["P1", "P2", "P3"],
  );
  assert.equal(calls.length, 2, "should not fetch a page it does not need");
});

test("autoPaginate iterates without handling the first page by hand", async () => {
  const { epay } = client([
    {
      body: {
        data: [
          {
            reference: "P1",
            merchantReference: null,
            status: "completed",
            amount: "1.00",
            currencyCode: "ETB",
            paidAt: null,
            createdAt: "2026-08-13T11:30:00.000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    },
  ]);

  const seen: string[] = [];
  for await (const transaction of epay.transactions.autoPaginate({
    currency: "ETB",
  })) {
    seen.push(transaction.reference);
  }
  assert.deepEqual(seen, ["P1"]);
});

test("timeline returns events in order, with error details on failures", async () => {
  const { epay, calls } = client([
    {
      body: {
        reference: "PFF98AB1220260812",
        events: [
          {
            eventType: "session_created",
            occurredAt: "2026-08-12T09:15:00.000Z",
            errorCode: null,
            errorMessage: null,
          },
          {
            eventType: "payment_failed",
            occurredAt: "2026-08-12T09:18:44.000Z",
            errorCode: "INSUFFICIENT_FUNDS",
            errorMessage:
              "The customer's account does not have sufficient balance.",
          },
        ],
      },
    },
  ]);

  const timeline = await epay.transactions.timeline("PFF98AB1220260812");

  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/transactions/PFF98AB1220260812/timeline",
  );
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.events[1]!.errorCode, "INSUFFICIENT_FUNDS");
});

// --- payment providers ------------------------------------------------------

test("payment providers are unwrapped from the data envelope", async () => {
  const { epay, calls } = client([
    {
      body: {
        data: [
          {
            providerCode: "telebirr",
            providerName: "Telebirr",
            flowCode: "ussd",
          },
        ],
      },
    },
  ]);

  const providers = await epay.paymentProviders.list();

  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/payment-providers/list",
  );
  assert.equal(providers[0]!.providerCode, "telebirr");
});

test("listEnabled filters out providers the account cannot use", async () => {
  const { epay, calls } = client([
    {
      body: {
        data: [
          {
            providerCode: "cbe_birr",
            providerName: "CBE Birr",
            providerCategory: "bank",
            flowCode: "mobile_banking",
            isEnabled: true,
          },
          {
            providerCode: "awash_bank",
            providerName: "Awash Bank",
            providerCategory: "bank",
            flowCode: "mobile_banking",
            isEnabled: false,
          },
        ],
      },
    },
  ]);

  const enabled = await epay.paymentProviders.listEnabled();

  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/payment-providers",
  );
  assert.deepEqual(
    enabled.map((p) => p.providerCode),
    ["cbe_birr"],
  );
});

test("a missing permission surfaces as a permission error", async () => {
  const { epay } = client([
    {
      status: 403,
      body: {
        statusCode: 403,
        message: "Missing get_platform_payment_provider permission",
        error: "Forbidden",
      },
    },
  ]);

  await assert.rejects(
    () => epay.paymentProviders.getAll(),
    (error: unknown) => {
      assert.ok(error instanceof EpayPermissionDeniedError);
      assert.match((error as Error).message, /get_platform_payment_provider/);
      return true;
    },
  );
});

// --- transport behaviour ----------------------------------------------------

test("a 429 is retried and the same idempotency key is reused", async () => {
  const { epay, calls } = client(
    [
      {
        status: 429,
        body: { status: "error", data: { message: "Rate limit exceeded" } },
        headers: { "retry-after": "0" },
      },
      { body: SESSION },
    ],
    { maxRetries: 2 },
  );

  const session = await epay.payments.initialize(
    { amount: "10.00", currencyCode: "ETB", customerPhone: "0911234567" },
    { idempotencyKey: "order_9" },
  );

  assert.deepEqual(session, SESSION);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers["x-idempotency-key"], "order_9");
  assert.equal(
    calls[1]!.headers["x-idempotency-key"],
    "order_9",
    "the retry must carry the same key or it would double-charge",
  );
});

test("a 5xx on a GET is retried", async () => {
  const { epay, calls } = client(
    [{ status: 503, body: null }, { body: { reference: "P1" } }],
    { maxRetries: 1 },
  );

  const transaction = await epay.transactions.retrieve("P1");
  assert.equal(transaction.reference, "P1");
  assert.equal(calls.length, 2);
});

test("a 4xx is not retried", async () => {
  const { epay, calls } = client(
    [
      {
        status: 401,
        body: { status: "error", data: { message: "Invalid API key" } },
      },
    ],
    { maxRetries: 3 },
  );

  await assert.rejects(
    () => epay.transactions.retrieve("P1"),
    EpayAuthenticationError,
  );
  assert.equal(calls.length, 1);
});

test("the rate limit error is raised once the retry budget runs out", async () => {
  const { epay, calls } = client(
    [
      { status: 429, body: null, headers: { "retry-after": "0" } },
      { status: 429, body: null, headers: { "retry-after": "0" } },
    ],
    { maxRetries: 1 },
  );

  await assert.rejects(
    () => epay.transactions.retrieve("P1"),
    (error: unknown) => {
      assert.ok(error instanceof EpayRateLimitError);
      assert.equal((error as EpayRateLimitError).retryAfterSeconds, 0);
      return true;
    },
  );
  assert.equal(calls.length, 2);
});

test("a transport error is retried and then surfaced", async () => {
  const boom = () => {
    throw new Error("ECONNRESET");
  };
  const { fetch, calls } = mockFetch([boom, boom]);
  const epay = new Epay({ apiKey: API_KEY, fetch, maxRetries: 1 });

  await assert.rejects(() => epay.transactions.retrieve("P1"), /ECONNRESET/);
  assert.equal(calls.length, 2);
});

test("a hung request times out with a clear error", async () => {
  const epay = new Epay({
    apiKey: API_KEY,
    fetch: hangingFetch,
    timeout: 40,
    maxRetries: 0,
  });

  await assert.rejects(
    () => epay.transactions.retrieve("P1"),
    (error: unknown) => {
      assert.ok(error instanceof EpayTimeoutError);
      assert.match((error as Error).message, /timed out after 40ms/);
      return true;
    },
  );
});

test("defaultHeaders are merged into every request", async () => {
  const { fetch, calls } = mockFetch([{ body: {} }]);
  const epay = new Epay({
    apiKey: API_KEY,
    fetch,
    maxRetries: 0,
    defaultHeaders: { "X-Trace-Id": "trace_1" },
  });

  await epay.transactions.retrieve("P1");
  assert.equal(calls[0]!.headers["X-Trace-Id"], "trace_1");
});

test("the escape hatch reaches unmodelled endpoints with the same handling", async () => {
  const { epay, calls } = client([
    { body: { ok: true }, headers: { "x-request-id": "req_9" } },
  ]);

  const response = await epay.request<{ ok: boolean }>({
    method: "GET",
    path: "/some/future/endpoint",
    query: { flag: true },
  });

  assert.deepEqual(response.data, { ok: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers["x-request-id"], "req_9");
  assert.equal(
    calls[0]!.url,
    "https://api.epayethiopia.com/v1/some/future/endpoint?flag=true",
  );
});

test("reply() helper builds a bodiless 204, matching the cancel endpoint", () => {
  const response = reply({ status: 204 });
  assert.equal(response.status, 204);
});
