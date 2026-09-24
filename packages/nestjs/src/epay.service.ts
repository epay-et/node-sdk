/** Injectable wrapper around the `@e-pay/node` client. */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { Epay, type EpayMode } from "@e-pay/node";

import { EPAY_CLIENT } from "./epay.constants.js";

/**
 * The ePay client, as a Nest provider.
 *
 * Inject it anywhere and reach the same resources the standalone client
 * exposes:
 *
 * ```ts
 * @Injectable()
 * export class CheckoutService {
 *   constructor(private readonly epay: EpayService) {}
 *
 *   async startCheckout(order: Order) {
 *     return this.epay.payments.initialize(
 *       {
 *         amount: order.total,
 *         currencyCode: 'ETB',
 *         customerPhone: order.phone,
 *         merchantReference: order.id,
 *       },
 *       { idempotencyKey: order.id },
 *     );
 *   }
 * }
 * ```
 */
@Injectable()
export class EpayService {
  private readonly logger = new Logger(EpayService.name);

  constructor(@Inject(EPAY_CLIENT) private readonly client: Epay) {
    this.logger.log(`ePay client ready in ${this.mode ?? "unrecognised"} mode`);
  }

  /** Initialize, verify, and cancel payment sessions. */
  get payments(): Epay["payments"] {
    return this.client.payments;
  }

  /** List, retrieve, and inspect the timeline of transactions. */
  get transactions(): Epay["transactions"] {
    return this.client.transactions;
  }

  /** Discover which providers and flows the account can use. */
  get paymentProviders(): Epay["paymentProviders"] {
    return this.client.paymentProviders;
  }

  /** Verify webhook signatures and parse events. */
  get webhooks(): Epay["webhooks"] {
    return this.client.webhooks;
  }

  /** Which environment the configured key targets. */
  get mode(): EpayMode | null {
    return this.client.mode;
  }

  /** Whether the configured key targets the sandbox. */
  get isSandbox(): boolean {
    return this.client.isSandbox;
  }

  /**
   * The underlying client, for the `request` escape hatch or to pass to code
   * that expects a plain `Epay`.
   */
  get raw(): Epay {
    return this.client;
  }
}
