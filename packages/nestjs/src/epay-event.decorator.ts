/** Parameter decorator exposing the verified webhook event. */

import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { WebhookEvent } from "@e-pay/node";

import { EPAY_EVENT_PROPERTY } from "./epay.constants.js";

/**
 * Injects the webhook event that {@link import('./epay-webhook.guard.js').EpayWebhookGuard}
 * verified.
 *
 * ```ts
 * @Post('epay')
 * @UseGuards(EpayWebhookGuard)
 * handle(@EpayEvent() event: WebhookEvent) { … }
 * ```
 *
 * Optionally name a single field:
 *
 * ```ts
 * handle(@EpayEvent('reference') reference: string) { … }
 * ```
 *
 * @throws When the guard did not run, rather than handing the route an
 * unverified payload.
 */
export const EpayEvent = createParamDecorator(
  (field: keyof WebhookEvent | undefined, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<Record<string, unknown>>();
    const event = request[EPAY_EVENT_PROPERTY] as WebhookEvent | undefined;

    if (!event) {
      throw new Error(
        "@EpayEvent() found no verified event on the request. Add @UseGuards(EpayWebhookGuard) " +
          "to this route.",
      );
    }

    return field ? event[field] : event;
  },
);
