/**
 * ePay Business API client for Node.js, Bun, and Deno.
 *
 * ```ts
 * import { Epay } from '@e-pay/node';
 *
 * const epay = new Epay({ apiKey: process.env.EPAY_SECRET_KEY });
 * const session = await epay.payments.initialize({
 *   amount: '250.00',
 *   currencyCode: 'ETB',
 *   customerPhone: '+251911234567',
 * });
 * ```
 *
 * Webhook middleware lives in the subpath exports `@e-pay/node/express` and
 * `@e-pay/node/fetch`.
 */

export { Epay } from "./client.js";

export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  modeFromApiKey,
  type EpayClientOptions,
  type FetchLike,
} from "./config.js";

export {
  EpayApiError,
  EpayAuthenticationError,
  EpayBadRequestError,
  EpayConfigError,
  EpayConflictError,
  EpayConnectionError,
  EpayError,
  EpayNotFoundError,
  EpayPermissionDeniedError,
  EpayRateLimitError,
  EpayServerError,
  EpayTimeoutError,
  EpayUnprocessableEntityError,
  EpayValidationError,
  EpayWebhookSignatureError,
} from "./errors.js";

export {
  MAX_AMOUNT,
  MAX_LIST_RANGE_DAYS,
  formatAmount,
  normalizeCurrency,
  normalizePhone,
} from "./helpers.js";

export type { ApiResponse, RequestOptions } from "./http.js";

export { Payments, type InitializeOptions } from "./resources/payments.js";
export {
  PAGE_SIZE,
  TransactionPage,
  Transactions,
} from "./resources/transactions.js";
export { PaymentProviders } from "./resources/payment-providers.js";

export {
  SIGNATURE_HEADER,
  Webhooks,
  constructWebhookEvent,
  isKnownWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./webhooks.js";

export {
  CANCELLABLE_STATUSES,
  TRANSACTION_STATUSES,
  WEBHOOK_EVENT_TYPES,
  type DataEnvelope,
  type EpayMode,
  type InitializePaymentParams,
  type InitializedPayment,
  type ListTransactionsParams,
  type PaymentProvider,
  type PaymentProviderItem,
  type TimelineEvent,
  type Transaction,
  type TransactionCustomer,
  type TransactionListResponse,
  type TransactionStatus,
  type TransactionTimeline,
  type VerifiedPayment,
  type WebhookEvent,
  type WebhookEventType,
} from "./types.js";

export { VERSION } from "./version.js";
