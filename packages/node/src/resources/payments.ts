/**
 * Payment lifecycle: hosted checkout, direct payments, SMS links, receipts,
 * and cancellation.
 */

import type { HttpClient } from "../http.js";
import {
  formatAmount,
  normalizeCurrency,
  normalizePhone,
  requireReference,
} from "../helpers.js";
import { EpayValidationError } from "../errors.js";
import type {
  DirectPayment,
  DirectPaymentParams,
  InitializePaymentParams,
  InitializedPayment,
  Receipt,
  SmsLink,
  SmsLinkParams,
  VerifiedPayment,
} from "../types.js";

/** Per-call options for {@link Payments.initialize} and {@link Payments.directPayment}. */
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
    const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);

    const body: Record<string, unknown> = {
      amount: formatAmount(params.amount),
      currencyCode: normalizeCurrency(params.currencyCode),
      customerPhone: normalizePhone(params.customerPhone),
    };

    // Only forward optional fields the caller actually set, so the API applies
    // its own defaults rather than receiving explicit nulls.
    copyOptional(body, params, [
      "merchantReference",
      "email",
      "firstName",
      "lastName",
      "returnUrl",
      "callbackUrl",
    ]);

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
   * Charges a customer's wallet or bank account directly, with no checkout page.
   *
   * ePay pushes an authorization prompt (USSD menu, SMS OTP, or in-app
   * notification) to the customer's phone. The call resolves as soon as the
   * prompt is sent, with `status: "pending"`; the outcome arrives as a
   * `payment.success` or `payment.failed` webhook once the customer acts.
   *
   * Pick `pspCode` and `flowCode` from {@link
   * import('./payment-providers.js').PaymentProviders.listForDirectPayment}.
   *
   * Safe to retry: every attempt carries the same idempotency key. Pass your
   * order id as `idempotencyKey` so a double-submitted form cannot charge twice.
   *
   * @throws {EpayValidationError} when a field fails local validation.
   * @throws {EpayBadRequestError} `400` — amount, currency, or provider rejected.
   * @throws {EpayPermissionDeniedError} `403` — direct payments are not enabled on the account.
   */
  async directPayment(
    params: DirectPaymentParams,
    options: InitializeOptions = {},
  ): Promise<DirectPayment> {
    const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);

    const body: Record<string, unknown> = {
      amount: formatAmount(params.amount),
      currencyCode: normalizeCurrency(params.currencyCode),
      customerPhone: normalizePhone(params.customerPhone),
      pspCode: requireCode(params.pspCode, "pspCode"),
    };
    if (params.flowCode !== undefined) {
      body.flowCode = requireCode(params.flowCode, "flowCode");
    }
    copyOptional(body, params, ["merchantReference", "callbackUrl"]);

    const response = await this.http.request<DirectPayment>({
      method: "POST",
      path: "/transactions/direct",
      body,
      headers: { "x-idempotency-key": idempotencyKey },
      // Safe to retry: every attempt carries the same idempotency key.
      retryable: true,
      timeout: options.timeout,
    });

    return response.data;
  }

  /**
   * Texts the customer a signed link to the hosted checkout page.
   *
   * Use it when the customer is not present, for invoices, bills, and remote
   * collections. With an `amount`, the amount is signed into the link and
   * cannot be changed; without one, the customer enters it. The link is valid
   * for 1 hour.
   *
   * Never retried automatically: the endpoint takes no idempotency key, so a
   * retry after a lost response would text the customer a second time.
   *
   * @throws {EpayValidationError} when a field fails local validation.
   * @throws {EpayBadRequestError} `400` — phone number or currency rejected.
   */
  async sendSmsLink(params: SmsLinkParams): Promise<SmsLink> {
    const body: Record<string, unknown> = {
      customerPhone: normalizePhone(params.customerPhone),
      currencyCode: normalizeCurrency(params.currencyCode),
    };
    if (params.amount !== undefined) body.amount = formatAmount(params.amount);

    const response = await this.http.request<SmsLink>({
      method: "POST",
      path: "/transactions/sms-link",
      body,
      retryable: false,
    });

    return response.data;
  }

  /**
   * Returns the receipt for a transaction in any terminal state: `completed`,
   * `failed`, or `cancelled`.
   *
   * Use it for records, customer-facing receipts, and audits. To confirm a
   * payment before fulfilling an order, use {@link verify}, which accepts only
   * completed transactions.
   *
   * @throws {EpayBadRequestError} `400` — the transaction is still pending or processing.
   * @throws {EpayNotFoundError} `404` — no such transaction on your account.
   */
  async receipt(reference: string): Promise<Receipt> {
    const ref = requireReference(reference);
    const response = await this.http.request<Receipt>({
      method: "GET",
      path: `/transactions/${encodeURIComponent(ref)}/receipt`,
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

/** Uses the caller's idempotency key, or generates one for this call. */
function resolveIdempotencyKey(key: string | undefined): string {
  const resolved = key ?? randomKey();
  if (resolved.length > 255) {
    throw new EpayValidationError(
      `idempotencyKey must be at most 255 characters, received ${resolved.length}`,
    );
  }
  return resolved;
}

/** Validates a provider or flow code is present, and trims it. */
function requireCode(value: string, field: string): string {
  const code = typeof value === "string" ? value.trim() : "";
  if (code === "") {
    throw new EpayValidationError(`${field} must be a non-empty string`);
  }
  return code;
}

/**
 * Copies only the optional fields the caller set, so the API applies its own
 * defaults rather than receiving explicit nulls.
 */
function copyOptional<T extends object>(
  body: Record<string, unknown>,
  params: T,
  fields: readonly (keyof T & string)[],
): void {
  for (const field of fields) {
    const value = params[field];
    if (value !== undefined) body[field] = value;
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
