/**
 * ePay Business API module for NestJS.
 *
 * ```ts
 * EpayModule.forRoot({ apiKey: process.env.EPAY_SECRET_KEY, isGlobal: true })
 * ```
 *
 * Types and errors are re-exported from `@e-pay/node`, so a Nest app rarely
 * needs to depend on both packages directly.
 */

export {
  EPAY_CLIENT,
  EPAY_EVENT_PROPERTY,
  EPAY_MODULE_OPTIONS,
} from "./epay.constants.js";
export { EpayEvent } from "./epay-event.decorator.js";
export { EpayModule } from "./epay.module.js";
export { EpayService } from "./epay.service.js";
export { EpayWebhookGuard } from "./epay-webhook.guard.js";
export type {
  EpayModuleAsyncOptions,
  EpayModuleOptions,
  EpayOptionsFactory,
} from "./interfaces.js";

export {
  Epay,
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
  EpayValidationError,
  EpayWebhookSignatureError,
  SIGNATURE_HEADER,
  TRANSACTION_STATUSES,
  WEBHOOK_EVENT_TYPES,
  type EpayMode,
  type InitializePaymentParams,
  type InitializedPayment,
  type ListTransactionsParams,
  type PaymentProvider,
  type PaymentProviderItem,
  type TimelineEvent,
  type Transaction,
  type TransactionStatus,
  type TransactionTimeline,
  type VerifiedPayment,
  type WebhookEvent,
  type WebhookEventType,
} from "@e-pay/node";
