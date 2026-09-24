/** Payment lifecycle: initialize a session, verify a receipt, cancel a session. */

import type { HttpClient } from "../http.js";
import {
  formatAmount,
  normalizeCurrency,
  normalizePhone,
  requireReference,
} from "../helpers.js";
import { EpayValidationError } from "../errors.js";
import type {
  InitializePaymentParams,
  InitializedPayment,
  VerifiedPayment,
} from "../types.js";

/** Per-call options for {@link Payments.initialize}. */
export interface InitializeOptions {
  /**
   * Idempotency key, up to 255 characters. Resending the same key within the
   * session window returns the original response instead of creating a second
   * transaction.
   *
   * When omitted the SDK generates a fresh key per call, which makes its
   * internal retries safe but does not deduplicate across separate calls. Pass
   * your own order id to get that guarantee.
   */
  idempotencyKey?: string;
  /** Overrides the client-wide timeout for this call. */
  timeout?: number;
}

/** Operations on the payment lifecycle. */
export class Payments {
  constructor(private readonly http: HttpClient) {}

  /**
   * Creates a payment session and returns a hosted checkout URL.
   *
   * `amount`, `currencyCode`, and `customerPhone` are normalized before the
   * request is sent: numeric amounts are formatted to 2 decimal places,
   * currencies uppercased, and phone numbers rewritten to `+251XXXXXXXXX`.
   *
   * Redirect the customer to `checkoutUrl`, and store `reference` to reconcile
   * the payment later.
   *
   * @throws {EpayValidationError} when a field fails local validation.
   * @throws {EpayBadRequestError} `400` — amount or currency rejected by the API.
   * @throws {EpayNotFoundError} `404` — no active payment source on your account.
   * @throws {EpayRateLimitError} `429` — rate limit exhausted after retries.
   */
  async initialize(
    params: InitializePaymentParams,
    options: InitializeOptions = {},
  ): Promise<InitializedPayment> {
    const idempotencyKey = options.idempotencyKey ?? randomKey();
    if (idempotencyKey.length > 255) {
      throw new EpayValidationError(
        `idempotencyKey must be at most 255 characters, received ${idempotencyKey.length}`,
      );
    }

    const body: Record<string, unknown> = {
      amount: formatAmount(params.amount),
      currencyCode: normalizeCurrency(params.currencyCode),
      customerPhone: normalizePhone(params.customerPhone),
    };

    // Only forward optional fields the caller actually set, so the API applies
    // its own defaults rather than receiving explicit nulls.
    for (const field of [
      "merchantReference",
      "email",
      "firstName",
      "lastName",
      "returnUrl",
      "callbackUrl",
    ] as const) {
      const value = params[field];
      if (value !== undefined) body[field] = value;
    }

    const response = await this.http.request<InitializedPayment>({
      method: "POST",
      path: "/transactions/initialize",
      body,
      headers: { "x-idempotency-key": idempotencyKey },
      // Safe to retry: every attempt carries the same idempotency key.
      retryable: true,
      timeout: options.timeout,
    });

    return response.data;
  }

  /**
   * Returns the full receipt for a completed transaction.
   *
   * Call this before fulfilling an order. The API rejects any transaction that
   * is not yet `completed`, so poll
   * {@link import('./transactions.js').Transactions.retrieve} first if you need
   * to check status without an error.
   *
   * @throws {EpayBadRequestError} `400` — the transaction is not yet completed.
   * @throws {EpayNotFoundError} `404` — no such transaction on your account.
   */
  async verify(reference: string): Promise<VerifiedPayment> {
    const ref = requireReference(reference);
    const response = await this.http.request<VerifiedPayment>({
      method: "GET",
      path: `/transactions/${encodeURIComponent(ref)}/verify`,
    });
    return response.data;
  }

  /**
   * Cancels a `pending` or `processing` transaction and fires a
   * `payment.cancelled` webhook.
   *
   * Cancellation is irreversible: the checkout session is invalidated and the
   * customer can no longer pay. Resolves once the API confirms with `204`.
   *
   * @throws {EpayBadRequestError} `400` — the transaction is not cancellable.
   * @throws {EpayNotFoundError} `404` — no such transaction on your account.
   */
  async cancel(reference: string): Promise<void> {
    const ref = requireReference(reference);
    await this.http.request<null>({
      method: "POST",
      path: `/transactions/${encodeURIComponent(ref)}/cancel`,
      // Cancelling twice is rejected with 400 rather than duplicated, but the
      // endpoint takes no idempotency key, so a retried attempt could act on a
      // request the server already processed.
      retryable: false,
    });
  }
}

/** Generates a per-call idempotency key, preferring the platform CSPRNG. */
function randomKey(): string {
  const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (typeof webCrypto?.randomUUID === "function")
    return webCrypto.randomUUID();
  return `epay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
