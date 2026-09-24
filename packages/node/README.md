# @e-pay/node

Official [ePay Business API](https://api.e-pay.et) client for Node.js, Bun, and Deno.

Accept payments from every major Ethiopian mobile wallet and bank with one integration.

- **Zero runtime dependencies** — built on `fetch` and `node:crypto`
- **Typed end to end**, including the webhook payload
- **Dual ESM and CommonJS** builds, so it works in NestJS and in ESM projects alike
- **Automatic retries** with exponential backoff and jitter on `429`/`5xx`/network errors
- **Safe retries on initialize** — every attempt reuses one idempotency key
- **Constant-time webhook verification**, plus drop-in Express and Fetch handlers
- **Edge-ready** webhook verification via WebCrypto, with no `node:` imports

## Install

```sh
npm install @e-pay/node
```

Requires Node 18 or newer.

## Quick start

```ts
import { Epay } from "@e-pay/node";

const epay = new Epay({ apiKey: process.env.EPAY_SECRET_KEY });

const session = await epay.payments.initialize({
  amount: "250.00",
  currencyCode: "ETB",
  customerPhone: "+251911234567",
  merchantReference: "order_123",
  returnUrl: "https://yourstore.com/order/123/complete",
});

// Save session.reference, then send the customer to pay.
redirect(session.checkoutUrl);
```

The key prefix picks the environment: `sk_test_…` runs against the sandbox and
`sk_live_…` moves real money. There is no separate mode to configure.

## Configuration

Every option falls back to an environment variable, so the common case is
`new Epay()`.

| Option           | Environment variable  | Default                   |
| ---------------- | --------------------- | ------------------------- |
| `apiKey`         | `EPAY_SECRET_KEY`     | _required_                |
| `webhookSecret`  | `EPAY_WEBHOOK_SECRET` | —                         |
| `baseUrl`        | `EPAY_BASE_URL`       | `https://api.e-pay.et/v1` |
| `timeout`        | —                     | `30000` ms per attempt    |
| `maxRetries`     | —                     | `2`                       |
| `defaultHeaders` | —                     | `{}`                      |
| `fetch`          | —                     | global `fetch`            |

```ts
const epay = new Epay({
  apiKey: process.env.EPAY_SECRET_KEY,
  timeout: 10_000,
  maxRetries: 3,
});

epay.mode; // 'live' | 'sandbox' | null
epay.isSandbox; // boolean
```

`console.log(epay)` prints a masked key, so a client is safe to log.

## Payments

### Initialize

```ts
const session = await epay.payments.initialize(
  {
    amount: 250, // a number is formatted to '250.00'
    currencyCode: "etb", // uppercased
    customerPhone: "0911234567", // rewritten to '+251911234567'
    merchantReference: "order_123",
    email: "abebe@example.com",
    returnUrl: "https://yourstore.com/order/123/complete",
    callbackUrl: "https://yourstore.com/webhooks/epay", // overrides the dashboard URL
  },
  { idempotencyKey: "order_123" },
);
```

`amount`, `currencyCode`, and `customerPhone` are validated locally, so a typo
fails immediately instead of costing a round trip. Amounts always come out with
two decimal places; pass a string when you need exact control over rounding.

**On idempotency keys.** If you omit `idempotencyKey`, the SDK generates a fresh
one per call. That makes its internal retries safe — a retried `initialize`
cannot double-charge — but it does _not_ deduplicate across separate calls. Pass
your own order id to get that guarantee.

### Verify before fulfilling

```ts
const receipt = await epay.payments.verify(reference);
// receipt.status === 'completed', plus serviceFee, paymentMethod, customer
```

The API rejects a transaction that is not yet `completed`, so poll
`transactions.retrieve` first if you would rather branch on status than catch an
`EpayBadRequestError`.

### Cancel

```ts
await epay.payments.cancel(reference); // resolves on 204
```

Only `pending` and `processing` transactions can be cancelled, and cancellation
is irreversible. This call is never retried automatically, because the endpoint
takes no idempotency key.

## Transactions

```ts
const transaction = await epay.transactions.retrieve(reference);
const timeline = await epay.transactions.timeline(reference);
```

### Listing and pagination

The endpoint is cursor-paginated at a fixed 10 per page. Iterate a page to walk
every following page, fetching lazily and carrying your filters along:

```ts
for await (const transaction of await epay.transactions.list({
  status: "completed",
  currency: "ETB",
  from: "2026-08-01",
  to: "2026-08-31",
})) {
  console.log(transaction.reference, transaction.amount);
}
```

`from` and `to` accept a `Date` or an ISO string, and the API caps the range at
90 days.

Other ways to consume the same endpoint:

```ts
const page = await epay.transactions.list();
page.data; // exactly this page, no extra requests
page.hasMore; // boolean
await page.next(); // the next TransactionPage, or null

// Cap the walk:
const recent = await (await epay.transactions.list()).toArray(50);

// Skip handling the first page yourself:
for await (const t of epay.transactions.autoPaginate({ status: "failed" })) {
  /* … */
}
```

## Payment providers

```ts
await epay.paymentProviders.list(); // compact, for dropdowns
await epay.paymentProviders.getAll(); // with category and isEnabled
await epay.paymentProviders.listEnabled(); // only what you can route to today
```

Both endpoints are mode-aware and permission-gated: `list` needs
`list_platform_payment_provider`, `getAll` needs `get_platform_payment_provider`.

## Webhooks

Verify the `X-Epay-Signature` header against the **raw** request body before you
trust a payload. Re-serializing parsed JSON can reorder keys and change the
digest, which rejects valid deliveries.

### Express

```ts
import express from "express";
import { expressEpayWebhook } from "@e-pay/node/express";

const app = express();

// Mount this before any global express.json().
app.post(
  "/webhooks/epay",
  expressEpayWebhook({
    secret: process.env.EPAY_WEBHOOK_SECRET!,
    onEvent: async (event) => {
      await queue.enqueue(event); // acknowledge fast, process later
    },
  }),
);
```

The handler reads the raw body itself, so `express.raw()` is optional. What it
cannot work around is `express.json()` having already consumed the body — in
that case it replies `401` and tells you why, rather than failing silently.

### Next.js, Hono, Bun, Deno, Cloudflare Workers

```ts
// app/api/webhooks/epay/route.ts
import { createEpayWebhookHandler } from "@e-pay/node/fetch";

export const POST = createEpayWebhookHandler({
  secret: process.env.EPAY_WEBHOOK_SECRET!,
  onEvent: async (event) => {
    await queue.enqueue(event);
  },
});
```

This path verifies with WebCrypto and imports nothing from `node:`, so it runs
on edge runtimes unchanged.

### Verifying by hand

```ts
import { constructWebhookEvent } from "@e-pay/node";

const event = constructWebhookEvent(
  rawBody,
  request.headers["x-epay-signature"],
  secret,
);
```

On an edge runtime, use the async form:

```ts
import { constructWebhookEventAsync } from "@e-pay/node/webhooks/web";
```

Both fail closed: any event they return had a valid signature.

### Handling events

```ts
switch (event.event) {
  case "payment.success":
    await fulfill(event.reference);
    break;
  case "payment.failed":
  case "payment.cancelled":
    await release(event.reference);
    break;
  case "payment.refunding":
  case "payment.refunded":
  case "payment.reversed":
    await reconcile(event);
    break;
}
```

ePay retries anything that is not a `2xx` within 10 seconds, up to 5 attempts,
so keep the handler fast and make it idempotent — deduplicate on
`event.reference`.

## Error handling

Every failure is an `EpayError`. HTTP failures carry the status, parsed body, and
response headers.

```ts
import {
  EpayApiError,
  EpayBadRequestError,
  EpayNotFoundError,
  EpayRateLimitError,
  EpayTimeoutError,
  EpayValidationError,
} from "@e-pay/node";

try {
  await epay.payments.verify(reference);
} catch (error) {
  if (error instanceof EpayNotFoundError) return null;
  if (error instanceof EpayBadRequestError) return "not settled yet";
  if (error instanceof EpayRateLimitError) {
    await sleep((error.retryAfterSeconds ?? 1) * 1000);
  }
  if (error instanceof EpayApiError) {
    console.error(error.status, error.request, error.body);
  }
  throw error;
}
```

| Class                       | Raised when                                           |
| --------------------------- | ----------------------------------------------------- |
| `EpayValidationError`       | A value failed local validation; no request was sent  |
| `EpayConfigError`           | The client was constructed with unusable options      |
| `EpayBadRequestError`       | `400`                                                 |
| `EpayAuthenticationError`   | `401` — key missing, invalid, or revoked              |
| `EpayPermissionDeniedError` | `403` — IP not whitelisted, or key lacks a permission |
| `EpayNotFoundError`         | `404`                                                 |
| `EpayConflictError`         | `409`                                                 |
| `EpayRateLimitError`        | `429` — exposes `retryAfterSeconds`                   |
| `EpayServerError`           | `5xx`                                                 |
| `EpayTimeoutError`          | The attempt exceeded `timeout`                        |
| `EpayConnectionError`       | No response was received at all                       |
| `EpayWebhookSignatureError` | A webhook signature was missing or wrong              |

`429`, `5xx`, and network errors are retried automatically before surfacing, so
seeing one of those means the retry budget was also exhausted.

## Sandbox testing

Use a `sk_test_…` key with the documented magic phone numbers:

| Phone          | OTP      | Outcome                            |
| -------------- | -------- | ---------------------------------- |
| `251900000000` | `000111` | Generic sandbox account            |
| `251900000001` | `123456` | Completes, fires `payment.success` |
| `251900000002` | `654321` | `INVALID_OTP`                      |
| `251900000003` | `111111` | `OTP_EXPIRED`                      |
| `251900000004` | —        | Declined, fires `payment.failed`   |

Generate a fresh idempotency key per test run: reusing one returns the cached
response instead of triggering the scenario again.

## Unmodelled endpoints

`epay.request` reaches anything this version does not wrap yet, with the same
auth, timeout, retry, and error handling:

```ts
const { data, status, headers } = await epay.request<{ ok: boolean }>({
  method: "GET",
  path: "/some/new/endpoint",
  query: { limit: 10 },
});
```

## Custom HTTP transport

The SDK ships with no HTTP dependency: it calls global `fetch`, which is built
into Node 18+, Bun, Deno, and every edge runtime. That keeps your dependency
tree clean and lets the same code run on Workers unchanged.

If you need something else — an outbound proxy, a shared axios instance with
your own logging, mandatory mTLS — pass a `fetch` option. The client only ever
uses four members of the returned object: `ok`, `status`, `headers` (anything
with a `forEach`), and `text()`.

```ts
import axios from "axios";
import { Epay, type FetchLike } from "@e-pay/node";

const transport: FetchLike = async (url, init) => {
  const response = await axios.request({
    url,
    method: init.method,
    headers: init.headers,
    data: init.body,
    signal: init.signal, // keeps `timeout` working
    // Hand non-2xx back to the SDK so it can map statuses and retry.
    validateStatus: () => true,
    transformResponse: [(body) => body], // leave parsing to the SDK
    proxy: { host: "proxy.internal", port: 8080 },
  });

  return new Response(response.data, {
    status: response.status,
    headers: response.headers as Record<string, string>,
  });
};

const epay = new Epay({
  apiKey: process.env.EPAY_SECRET_KEY,
  fetch: transport,
});
```

Two things to get right in any adapter:

- **Forward `init.signal`**, or `timeout` silently stops working.
- **Do not throw on non-2xx.** Return the response and let the SDK map it to a
  typed error and decide whether to retry. With axios that means
  `validateStatus: () => true`, or catching and translating `error.response`.

For an outbound proxy specifically, you do not need axios at all —
`undici`'s `ProxyAgent` plugs straight into `fetch`:

```ts
import { ProxyAgent, fetch as undiciFetch } from "undici";

const dispatcher = new ProxyAgent("http://proxy.internal:8080");
const epay = new Epay({
  apiKey: process.env.EPAY_SECRET_KEY,
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }) as never,
});
```

## Development

```sh
pnpm build        # dual ESM + CJS into dist/
pnpm test         # build, then run the suite against dist/
pnpm check-types  # tsc --noEmit
```

Tests run against the built output rather than `src/`, so they exercise exactly
what gets published.

## License

MIT
