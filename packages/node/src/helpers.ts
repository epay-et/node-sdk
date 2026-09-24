/** Validation and normalization helpers for request values. */

import { EpayValidationError } from "./errors.js";

/** Largest amount the API accepts. */
export const MAX_AMOUNT = "999999999.99";

/** Maximum span the transaction list endpoint allows between `from` and `to`. */
export const MAX_LIST_RANGE_DAYS = 90;

const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * Normalizes an amount to the numeric string the API expects.
 *
 * The result always carries exactly 2 decimal places, so `250`, `"250"`, and
 * `"250.0"` all become `"250.00"`. Strings must already have at most 9 integer
 * digits and 2 decimal places; numbers are rounded to 2 decimal places, so pass
 * a string when you need exact control over rounding.
 *
 * @throws {EpayValidationError} when the value is not a positive amount in range.
 */
export function formatAmount(value: string | number): string {
  let candidate: string;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EpayValidationError(
        `amount must be a finite number, received ${value}`,
      );
    }
    if (value <= 0) {
      throw new EpayValidationError(
        `amount must be greater than 0, received ${value}`,
      );
    }
    candidate = value.toFixed(2);
  } else {
    candidate = value.trim();
  }

  if (!AMOUNT_PATTERN.test(candidate)) {
    throw new EpayValidationError(
      `amount must be a positive numeric string with at most 9 integer digits and ` +
        `2 decimal places, received ${JSON.stringify(value)}`,
    );
  }
  if (Number(candidate) <= 0) {
    throw new EpayValidationError(
      `amount must be greater than 0, received ${JSON.stringify(value)}`,
    );
  }
  if (Number(candidate) > Number(MAX_AMOUNT)) {
    throw new EpayValidationError(
      `amount must not exceed ${MAX_AMOUNT}, received ${candidate}`,
    );
  }

  // Pad to a consistent 2 decimal places so logs and reconciliation line up.
  const [whole = "0", fraction = ""] = candidate.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

/**
 * Normalizes an Ethiopian mobile number to `+251XXXXXXXXX`.
 *
 * Accepts local (`0911234567`), bare national (`911234567`), and international
 * (`251911234567`, `+251911234567`) forms, with spaces, dashes, and parentheses
 * anywhere. Both Ethio Telecom (`9…`) and Safaricom Ethiopia (`7…`) ranges are
 * recognised.
 *
 * @throws {EpayValidationError} when the value is not a recognised Ethiopian mobile number.
 */
export function normalizePhone(value: string): string {
  const cleaned = value.replace(/[\s()\-.]/g, "");
  const digits = cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;

  if (!/^\d+$/.test(digits)) {
    throw new EpayValidationError(
      `customerPhone must contain only digits and separators, received ${JSON.stringify(value)}`,
    );
  }

  let subscriber: string | null = null;
  if (/^251[79]\d{8}$/.test(digits)) {
    subscriber = digits.slice(3);
  } else if (/^0[79]\d{8}$/.test(digits)) {
    subscriber = digits.slice(1);
  } else if (/^[79]\d{8}$/.test(digits)) {
    subscriber = digits;
  }

  if (!subscriber) {
    throw new EpayValidationError(
      `customerPhone must be an Ethiopian mobile number such as +251911234567 or ` +
        `0911234567, received ${JSON.stringify(value)}`,
    );
  }

  return `+251${subscriber}`;
}

/** Normalizes a `Date` or string to the `YYYY-MM-DD` form the list filters take. */
export function formatDateParam(value: string | Date, field: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new EpayValidationError(`${field} must be a valid Date`);
    }
    return value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EpayValidationError(`${field} must not be empty`);
  }
  return trimmed;
}

/**
 * Validates a 3-letter ISO 4217 code and uppercases it.
 *
 * @throws {EpayValidationError} when the value is not three letters.
 */
export function normalizeCurrency(
  value: string,
  field = "currencyCode",
): string {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    throw new EpayValidationError(
      `${field} must be a 3-letter ISO 4217 code such as ETB, received ${JSON.stringify(value)}`,
    );
  }
  return trimmed;
}

/**
 * Validates a transaction reference is present and trims it.
 *
 * @throws {EpayValidationError} when the reference is empty.
 */
export function requireReference(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EpayValidationError("reference must be a non-empty string");
  }
  return value.trim();
}

/** Masks a secret so it can be logged or shown in a stack trace safely. */
export function maskSecret(value: string): string {
  if (value.length <= 12) return "***";
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}
