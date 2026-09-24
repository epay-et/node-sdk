/**
 * Webhook handler for Web `Request`/`Response` runtimes: Next.js route
 * handlers, Hono, Bun, Deno, Cloudflare Workers, and Vercel Edge.
 *
 * Verification uses WebCrypto, so this module has no `node:` imports and runs
 * on edge runtimes unchanged.
 *
 * ```ts
 * // app/api/webhooks/epay/route.ts
 * import { createEpayWebhookHandler } from '@e-pay/node/fetch';
 *
 * export const POST = createEpayWebhookHandler({
 *   secret: process.env.EPAY_WEBHOOK_SECRET!,
 *   onEvent: async (event) => {
 *     await queue.enqueue(event);
 *   },
 * });
 * ```
 */

import { EpayWebhookSignatureError } from "../errors.js";
import type { WebhookEvent } from "../types.js";
import {
  SIGNATURE_HEADER,
  constructWebhookEventAsync,
} from "../webhooks-web.js";

/** Configuration for {@link createEpayWebhookHandler}. */
export interface FetchWebhookOptions {
  /** Webhook signing secret from Developers → Webhooks. */
  secret: string;
  /**
   * Called once per verified event.
   *
   * Return quickly: ePay treats a response slower than 10 seconds as a failure
   * and retries. Deduplicate on `event.reference`.
   */
  onEvent: (event: WebhookEvent, request: Request) => unknown;
  /**
   * Called when verification or `onEvent` throws. Defaults to `401` for a
   * signature failure and `400` otherwise.
   */
  onError?: (error: unknown, request: Request) => Response | Promise<Response>;
  /** Status code returned after a successful `onEvent`. Defaults to 200. */
  successStatus?: number;
}

/** Builds a `(request) => Response` webhook handler. */
export function createEpayWebhookHandler(options: FetchWebhookOptions) {
  const successStatus = options.successStatus ?? 200;

  return async function epayWebhookHandler(
    request: Request,
  ): Promise<Response> {
    try {
      // Read as text before parsing: the signature covers the exact bytes sent.
      const rawBody = await request.text();
      const event = await constructWebhookEventAsync(
        rawBody,
        request.headers.get(SIGNATURE_HEADER),
        options.secret,
      );

      await options.onEvent(event, request);
      return new Response(null, { status: successStatus });
    } catch (error) {
      if (options.onError) return options.onError(error, request);

      const status = error instanceof EpayWebhookSignatureError ? 401 : 400;
      return Response.json(
        { error: (error as Error)?.message ?? "Webhook rejected" },
        { status },
      );
    }
  };
}
