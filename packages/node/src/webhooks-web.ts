/**
 * WebCrypto webhook verification, for runtimes without `node:crypto`.
 *
 * Use this on Cloudflare Workers, Vercel Edge, Deno Deploy, and similar. The
 * API mirrors `@e-pay/node/webhooks` but is async, because WebCrypto is.
 *
 * ```ts
 * import { constructWebhookEventAsync } from '@e-pay/node/webhooks/web';
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const body = await request.text();
 *     const event = await constructWebhookEventAsync(
 *       body,
 *       request.headers.get('x-epay-signature'),
 *       env.EPAY_WEBHOOK_SECRET,
 *     );
 *     return new Response('ok');
 *   },
 * };
 * ```
 */

import {
  EpayConfigError,
  EpayValidationError,
  EpayWebhookSignatureError,
} from "./errors.js";
import type { WebhookEvent } from "./types.js";

/** Header ePay signs every delivery with. */
export const SIGNATURE_HEADER = "x-epay-signature";

const SIGNATURE_PREFIX = "sha256=";
const encoder = new TextEncoder();

/** Computes the expected hex signature for a payload using WebCrypto. */
export async function signWebhookPayloadAsync(
  payload: string | Uint8Array,
  secret: string,
): Promise<string> {
  if (!secret) {
    throw new EpayConfigError(
      "A webhook secret is required to sign a payload.",
    );
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const bytes = typeof payload === "string" ? encoder.encode(payload) : payload;
  const digest = await crypto.subtle.sign("HMAC", key, bytes as BufferSource);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Checks an `X-Epay-Signature` header against the raw body using WebCrypto.
 *
 * The comparison is constant-time with respect to digest contents.
 */
export async function verifyWebhookSignatureAsync(
  payload: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<boolean> {
  const received = normalizeSignature(signatureHeader);
  if (!received) return false;

  const expected = await signWebhookPayloadAsync(payload, secret);
  if (received.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verifies a delivery and returns the parsed event. Fails closed.
 *
 * @throws {EpayWebhookSignatureError} when the header is missing or does not match.
 * @throws {EpayValidationError} when the verified body is not a JSON object.
 */
export async function constructWebhookEventAsync(
  payload: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): Promise<WebhookEvent> {
  if (!normalizeSignature(signatureHeader)) {
    throw new EpayWebhookSignatureError(
      `Missing or malformed ${SIGNATURE_HEADER} header. Expected "${SIGNATURE_PREFIX}<hex>".`,
    );
  }
  if (!(await verifyWebhookSignatureAsync(payload, signatureHeader, secret))) {
    throw new EpayWebhookSignatureError(
      `${SIGNATURE_HEADER} does not match the request body. Verify you are using the raw ` +
        "request body and the webhook secret from Developers → Webhooks.",
    );
  }

  const text =
    typeof payload === "string" ? payload : new TextDecoder().decode(payload);

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

function normalizeSignature(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;

  const trimmed = header.trim();
  const digest = trimmed.toLowerCase().startsWith(SIGNATURE_PREFIX)
    ? trimmed.slice(SIGNATURE_PREFIX.length)
    : trimmed;

  return /^[0-9a-f]+$/i.test(digest) ? digest.toLowerCase() : null;
}
