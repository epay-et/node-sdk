/** Guard that verifies an ePay webhook signature before a handler runs. */

import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { EpayWebhookSignatureError, SIGNATURE_HEADER } from "@e-pay/node";

import { EPAY_EVENT_PROPERTY } from "./epay.constants.js";
import { EpayService } from "./epay.service.js";

/** The slice of the incoming request the guard reads. */
interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Populated by Nest when the app is created with `{ rawBody: true }`. */
  rawBody?: Buffer | string;
  body?: unknown;
  [EPAY_EVENT_PROPERTY]?: unknown;
}

/**
 * Rejects any request whose `X-Epay-Signature` header does not match the body,
 * and stashes the verified event for {@link import('./epay-event.decorator.js').EpayEvent}.
 *
 * Nest must be able to hand the guard the raw body, so create the app with
 * `rawBody: true`:
 *
 * ```ts
 * const app = await NestFactory.create(AppModule, { rawBody: true });
 * ```
 *
 * Then guard the route:
 *
 * ```ts
 * @Controller('webhooks')
 * export class WebhookController {
 *   @Post('epay')
 *   @UseGuards(EpayWebhookGuard)
 *   handle(@EpayEvent() event: WebhookEvent) {
 *     // the signature is already verified
 *   }
 * }
 * ```
 */
@Injectable()
export class EpayWebhookGuard implements CanActivate {
  constructor(private readonly epay: EpayService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<WebhookRequest>();
    const rawBody = request.rawBody;

    if (rawBody === undefined || rawBody === null) {
      // A misconfiguration, not a rejected caller: fail as a 500 so it is not
      // mistaken for an attacker and silently ignored.
      throw new InternalServerErrorException(
        "ePay webhook verification needs the raw request body. Create the Nest app with " +
          "NestFactory.create(AppModule, { rawBody: true }), and do not let a body parser " +
          "consume this route first.",
      );
    }

    try {
      request[EPAY_EVENT_PROPERTY] = this.epay.webhooks.constructEvent(
        rawBody,
        request.headers[SIGNATURE_HEADER],
      );
    } catch (error) {
      if (error instanceof EpayWebhookSignatureError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    return true;
  }
}
