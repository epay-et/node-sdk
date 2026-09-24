/**
 * Express webhook middleware.
 *
 * ```ts
 * import { expressEpayWebhook } from '@e-pay/node/express';
 *
 * app.post(
 *   '/webhooks/epay',
 *   expressEpayWebhook({
 *     secret: process.env.EPAY_WEBHOOK_SECRET!,
 *     onEvent: async (event) => {
 *       await queue.enqueue(event); // acknowledge fast, process async
 *     },
 *   }),
 * );
 * ```
 *
 * The handler reads the raw request body itself, so it works whether or not
 * `express.raw()` is mounted ahead of it. What it will not tolerate is
 * `express.json()` consuming the body first: a re-serialized payload does not
 * match the signature. Mount this route before any global JSON parser, or skip
 * the parser for this path.
 */

import { EpayWebhookSignatureError } from "../errors.js";
import type { WebhookEvent } from "../types.js";
import { SIGNATURE_HEADER, constructWebhookEvent } from "../webhooks.js";

/** The slice of an Express request this middleware touches. */
export interface ExpressRequestLike extends AsyncIterable<unknown> {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** The slice of an Express response this middleware touches. */
export interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  send(body?: unknown): unknown;
}

/** Configuration for {@link expressEpayWebhook}. */
export interface ExpressWebhookOptions {
  /** Webhook signing secret from Developers → Webhooks. */
  secret: string;
  /**
   * Called once per verified event.
   *
   * Return quickly: ePay treats a response slower than 10 seconds as a failure
   * and retries. Enqueue the work instead of doing it inline. Deduplicate on
   * `event.reference`, since retries can deliver the same event twice.
   */
  onEvent: (
    event: WebhookEvent,
    req: ExpressRequestLike,
    res: ExpressResponseLike,
  ) => unknown;
  /**
   * Called when verification or `onEvent` throws. Defaults to replying `401`
   * for a signature failure and `400` otherwise.
   */
  onError?: (
    error: unknown,
    req: ExpressRequestLike,
    res: ExpressResponseLike,
  ) => unknown;
  /** Status code sent after a successful `onEvent`. Defaults to 200. */
  successStatus?: number;
}

/** Builds an Express handler that verifies, parses, and dispatches webhooks. */
export function expressEpayWebhook(options: ExpressWebhookOptions) {
  const successStatus = options.successStatus ?? 200;

  return async function epayWebhookHandler(
    req: ExpressRequestLike,
    res: ExpressResponseLike,
  ): Promise<void> {
    try {
      const rawBody = await readRawBody(req);
      const event = constructWebhookEvent(
        rawBody,
        req.headers[SIGNATURE_HEADER],
        options.secret,
      );

      await options.onEvent(event, req, res);
      res.status(successStatus).send();
    } catch (error) {
      if (options.onError) {
        await options.onError(error, req, res);
        return;
      }
      const status = error instanceof EpayWebhookSignatureError ? 401 : 400;
      res
        .status(status)
        .send({ error: (error as Error)?.message ?? "Webhook rejected" });
    }
  };
}

/**
 * Recovers the body exactly as it was sent.
 *
 * `express.raw()` leaves a Buffer on `req.body`; with no parser mounted the
 * body is still on the stream. An already-parsed object cannot be recovered,
 * so that case is reported rather than silently re-serialized.
 */
async function readRawBody(
  req: ExpressRequestLike,
): Promise<Uint8Array | string> {
  const { body } = req;

  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return body;

  if (body !== undefined && body !== null && typeof body === "object") {
    throw new EpayWebhookSignatureError(
      "The webhook body was already parsed into an object, so the raw bytes needed to " +
        "verify the signature are gone. Mount this route before express.json(), or use " +
        "express.raw({ type: 'application/json' }) for it.",
    );
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : (chunk as Uint8Array),
    );
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}
