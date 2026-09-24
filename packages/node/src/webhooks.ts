/** Webhook signature verification and event parsing. */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  EpayConfigError,
  EpayValidationError,
  EpayWebhookSignatureError,
} from "./errors.js";
import { WEBHOOK_EVENT_TYPES, type WebhookEvent } from "./types.js";

/** Header ePay signs every delivery with. */
export const SIGNATURE_HEADER = "x-epay-signature";

/** Prefix on the header value, ahead of the hex digest. */
const SIGNATURE_PREFIX = "sha256=";

/** Body bytes as they arrived, before any JSON parsing. */
export type RawBody = string | Uint8Array;

/** A signature header as Node may hand it to you. */
export type SignatureHeader = string | string[] | undefined | null;

/**
 * Computes the expected signature for a payload.
 *
 * Useful for generating fixtures in your own tests; ePay does the same
 * computation over the raw bytes it sends you.
 */
export function signWebhookPayload(payload: RawBody, secret: string): string {
  if (!secret) {
    throw new EpayConfigError(
      "A webhook secret is required to sign a payload.",
    );
  }
  return createHmac("sha256", secret).update(toBuffer(payload)).digest("hex");
}

/**
 * Checks an `X-Epay-Signature` header against the raw request body.
 *
 * Pass the **raw** body, never a re-serialized object: `JSON.stringify` of a
 * parsed payload may reorder keys or drop whitespace, which changes the digest
 * and rejects valid deliveries. The comparison is constant-time.
 *
 * @returns true when the signature matches.
 */
export function verifyWebhookSignature(
  payload: RawBody,
  signatureHeader: SignatureHeader,
  secret: string,
): boolean {
  const received = normalizeSignature(signatureHeader);
  if (!received) return false;

  const expected = signWebhookPayload(payload, secret);

  // timingSafeEqual throws on a length mismatch, so screen for that first. The
  // length of a digest is not a secret.
  if (received.length !== expected.length) return false;

  return timingSafeEqual(
    Buffer.from(received, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}

/**
 * Verifies a delivery and returns the parsed event.
 *
 * This is the entry point to use in a webhook handler: it fails closed, so any
 * event it returns had a valid signature.
 *
 * @throws {EpayWebhookSignatureError} when the header is missing or does not match.
 * @throws {EpayValidationError} when the verified body is not a JSON object.
 */
export function constructWebhookEvent(
  payload: RawBody,
  signatureHeader: SignatureHeader,
  secret: string,
): WebhookEvent {
  if (!normalizeSignature(signatureHeader)) {
    throw new EpayWebhookSignatureError(
      `Missing or malformed ${SIGNATURE_HEADER} header. Expected "${SIGNATURE_PREFIX}<hex>".`,
    );
  }
  if (!verifyWebhookSignature(payload, signatureHeader, secret)) {
    throw new EpayWebhookSignatureError(
      `${SIGNATURE_HEADER} does not match the request body. Verify you are using the raw ` +
        "request body and the webhook secret from Developers → Webhooks.",
    );
  }

  const text =
    typeof payload === "string" ? payload : toBuffer(payload).toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new EpayValidationError(
      "Webhook body passed verification but is not valid JSON.",
      {
        cause: error,
      },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EpayValidationError(
      "Webhook body passed verification but is not a JSON object.",
    );
  }

  return parsed as WebhookEvent;
}

/** Narrows an event to one of the documented event names. */
export function isKnownWebhookEvent(event: WebhookEvent): boolean {
  return WEBHOOK_EVENT_TYPES.includes(event.event);
}

/** Webhook helpers bound to the secret configured on a client. */
export class Webhooks {
  constructor(private readonly secret: string | null) {}

  /** Whether a webhook secret is configured. */
  get configured(): boolean {
    return Boolean(this.secret);
  }

  /** See {@link verifyWebhookSignature}. Uses the client's configured secret. */
  verify(
    payload: RawBody,
    signatureHeader: SignatureHeader,
    secret?: string,
  ): boolean {
    return verifyWebhookSignature(
      payload,
      signatureHeader,
      this.requireSecret(secret),
    );
  }

  /** See {@link constructWebhookEvent}. Uses the client's configured secret. */
  constructEvent(
    payload: RawBody,
    signatureHeader: SignatureHeader,
    secret?: string,
  ): WebhookEvent {
    return constructWebhookEvent(
      payload,
      signatureHeader,
      this.requireSecret(secret),
    );
  }

  /** See {@link signWebhookPayload}. Uses the client's configured secret. */
  sign(payload: RawBody, secret?: string): string {
    return signWebhookPayload(payload, this.requireSecret(secret));
  }

  private requireSecret(override?: string): string {
    const secret = override ?? this.secret;
    if (!secret) {
      throw new EpayConfigError(
        "No webhook secret configured. Pass { webhookSecret } to the client, set " +
          "EPAY_WEBHOOK_SECRET, or supply the secret to this call.",
      );
    }
    return secret;
  }
}

/** Reduces a possibly-repeated header to a bare lowercase hex digest. */
function normalizeSignature(header: SignatureHeader): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const digest = trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)
    ? trimmed.slice(SIGNATURE_PREFIX.length)
    : trimmed;

  return /^[0-9a-f]+$/i.test(digest) ? digest.toLowerCase() : null;
}

function toBuffer(payload: RawBody): Buffer {
  return typeof payload === "string"
    ? Buffer.from(payload, "utf8")
    : Buffer.from(payload);
}
