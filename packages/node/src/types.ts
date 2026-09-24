/** Wire types for the ePay Business API. */

/** Whether a key or event belongs to live traffic or the sandbox. */
export type EpayMode = "live" | "sandbox";

/** Lifecycle states a transaction can be in. */
export type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "reversed"
  | "refunding"
  | "refunded";

/** Every status value the API recognises, for runtime validation. */
export const TRANSACTION_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
  "reversed",
  "refunding",
  "refunded",
] as const satisfies readonly TransactionStatus[];

/** Statuses that can still be cancelled via the API. */
export const CANCELLABLE_STATUSES = ["pending", "processing"] as const;

/** Webhook event names. */
export type WebhookEventType =
  | "payment.success"
  | "payment.failed"
  | "payment.cancelled"
  | "payment.refunding"
  | "payment.refunded"
  | "payment.reversed";

/** Every webhook event name, for runtime validation. */
export const WEBHOOK_EVENT_TYPES = [
  "payment.success",
  "payment.failed",
  "payment.cancelled",
  "payment.refunding",
  "payment.refunded",
  "payment.reversed",
] as const satisfies readonly WebhookEventType[];

/** Body of `POST /v1/transactions/initialize`. */
export interface InitializePaymentParams {
  /**
   * Amount as a positive numeric string with at most 9 integer digits and 2
   * decimal places. A `number` is accepted and formatted to 2dp for you.
   */
  amount: string | number;
  /** ISO 4217 currency code, e.g. `ETB`. */
  currencyCode: string;
  /** Ethiopian mobile number, e.g. `+251911234567` or `0911234567`. */
  customerPhone: string;
  /** Your own unique reference for this transaction, e.g. an order id. */
  merchantReference?: string;
  /** Customer email address. */
  email?: string;
  /** Customer first name. */
  firstName?: string;
  /** Customer last name. */
  lastName?: string;
  /** Where to send the customer after payment, success or failure. */
  returnUrl?: string;
  /** Per-transaction webhook URL; overrides the dashboard-wide URL. */
  callbackUrl?: string;
}

/** Response of `POST /v1/transactions/initialize`. */
export interface InitializedPayment {
  /** ePay reference, format `P{8-hex}{yyyymmdd}`. */
  reference: string;
  /** Hosted checkout URL to redirect the customer to. */
  checkoutUrl: string;
  /** Always `"success"` on a successful initialization. */
  status: string;
  /** ISO 8601 timestamp at which the checkout session expires. */
  expiresAt: string;
}

/** A transaction as returned by retrieve and list. */
export interface Transaction {
  reference: string;
  merchantReference: string | null;
  status: TransactionStatus;
  amount: string;
  currencyCode: string;
  paidAt: string | null;
  createdAt: string;
}

/** Customer details attached to a verified receipt or webhook event. */
export interface TransactionCustomer {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** Response of `GET /v1/transactions/:reference/verify`. */
export interface VerifiedPayment {
  reference: string;
  merchantReference: string | null;
  /** Always `completed`; verify returns 400 for any other status. */
  status: TransactionStatus;
  amount: string;
  serviceFee: string | null;
  currencyCode: string | null;
  paymentMethod: string | null;
  customer: TransactionCustomer;
  paidAt: string;
  createdAt: string;
}

/** Query parameters for `GET /v1/transactions`. */
export interface ListTransactionsParams {
  /** Created on or after this ISO 8601 date. Range with `to` must be <= 90 days. */
  from?: string | Date;
  /** Created on or before this ISO 8601 date. Must not precede `from`. */
  to?: string | Date;
  /** 3-letter ISO 4217 code, case-insensitive. */
  currency?: string;
  /** Restrict to a single status. */
  status?: TransactionStatus;
  /** `nextCursor` from a previous page. Omit for the first page. */
  cursor?: string;
}

/** Raw body of `GET /v1/transactions`. Page size is fixed at 10. */
export interface TransactionListResponse {
  data: Transaction[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A single entry in a transaction timeline. */
export interface TimelineEvent {
  /** e.g. `session_created`, `payment_initiated`, `payment_completed`, `payment_failed`. */
  eventType: string;
  /** ISO 8601 timestamp of when the event occurred provider-side. */
  occurredAt: string;
  /** Provider error code, present only on failure events. */
  errorCode: string | null;
  /** Human-readable error description, present only on failure events. */
  errorMessage: string | null;
}

/** Response of `GET /v1/transactions/:reference/timeline`. */
export interface TransactionTimeline {
  reference: string;
  /** Chronological, earliest first. Empty until the first provider event. */
  events: TimelineEvent[];
}

/** Compact provider entry from `GET /v1/payment-providers/list`. */
export interface PaymentProviderItem {
  /** e.g. `cbe_birr`, `telebirr`. */
  providerCode: string;
  providerName: string | null;
  /** e.g. `mobile_banking`, `ussd`, `qr`. */
  flowCode: string;
}

/** Full provider entry from `GET /v1/payment-providers`. */
export interface PaymentProvider extends PaymentProviderItem {
  /** Common values: `bank`, `mobile_money`. */
  providerCategory: string | null;
  /**
   * Whether your account has this provider enabled. Disabled providers are
   * still returned so your UI can show them as unavailable.
   */
  isEnabled: boolean;
}

/** Envelope used by both payment-provider endpoints. */
export interface DataEnvelope<T> {
  data: T;
}

/** Payload delivered to your webhook endpoint. */
export interface WebhookEvent {
  event: WebhookEventType;
  mode: EpayMode;
  reference: string;
  merchantReference: string | null;
  amount: string | null;
  serviceFee: string | null;
  /** ISO 4217 code. Note this field is `currency`, not `currencyCode`. */
  currency: string | null;
  status: TransactionStatus;
  paymentMethod: string | null;
  customer: TransactionCustomer;
  /** Null for every non-success event. */
  paidAt: string | null;
  createdAt: string;
}
