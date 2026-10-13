# @e-pay/nestjs

Official ePay Business API module for NestJS.

Full API documentation: <https://docs.epayethiopia.com/>

A thin, idiomatic Nest wrapper around [`@e-pay/node`](../node): a dynamic module,
an injectable service, a webhook guard, and a param decorator.

## Install

```sh
npm install @e-pay/nestjs
```

`@e-pay/node` comes along as a dependency. Nest 10 and 11 are both supported.

## Register the module

```ts
import { Module } from "@nestjs/common";
import { EpayModule } from "@e-pay/nestjs";

@Module({
  imports: [
    EpayModule.forRoot({
      apiKey: process.env.EPAY_SECRET_KEY,
      webhookSecret: process.env.EPAY_WEBHOOK_SECRET,
      isGlobal: true, // inject EpayService anywhere without re-importing
    }),
  ],
})
export class AppModule {}
```

Every option is optional — with none set, the client reads `EPAY_SECRET_KEY`,
`EPAY_WEBHOOK_SECRET`, and `EPAY_BASE_URL` from the environment, so
`EpayModule.forRoot()` is enough.

An invalid key fails at bootstrap rather than at the first payment.

### With ConfigService

```ts
EpayModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    apiKey: config.getOrThrow("EPAY_SECRET_KEY"),
    webhookSecret: config.getOrThrow("EPAY_WEBHOOK_SECRET"),
    timeout: 10_000,
  }),
  isGlobal: true,
});
```

`useClass` and `useExisting` are supported too, via an `EpayOptionsFactory`:

```ts
@Injectable()
export class EpayConfig implements EpayOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createEpayOptions(): EpayModuleOptions {
    return { apiKey: this.config.getOrThrow("EPAY_SECRET_KEY") };
  }
}

EpayModule.forRootAsync({ imports: [ConfigModule], useClass: EpayConfig });
```

## Take a payment

```ts
import { Injectable } from "@nestjs/common";
import { EpayService } from "@e-pay/nestjs";

@Injectable()
export class CheckoutService {
  constructor(private readonly epay: EpayService) {}

  async startCheckout(order: Order) {
    const session = await this.epay.payments.initialize(
      {
        amount: order.total,
        currencyCode: "ETB",
        customerPhone: order.customerPhone,
        merchantReference: order.id,
        returnUrl: `https://yourstore.com/orders/${order.id}/complete`,
      },
      { idempotencyKey: order.id },
    );

    return session.checkoutUrl;
  }

  async fulfilIfPaid(reference: string) {
    const transaction = await this.epay.transactions.retrieve(reference);
    if (transaction.status !== "completed") return false;

    const receipt = await this.epay.payments.verify(reference);
    await this.orders.markPaid(receipt.merchantReference!, receipt.serviceFee);
    return true;
  }
}
```

`EpayService` exposes the same resources as the standalone client —
`payments`, `transactions`, `paymentProviders`, `webhooks` — plus `mode`,
`isSandbox`, and `raw` for the underlying `Epay` instance.

### Charge directly, without a checkout page

```ts
const charge = await this.epay.payments.directPayment(
  {
    amount: order.total,
    currencyCode: "ETB",
    customerPhone: order.customerPhone,
    pspCode: "TELEBIRR",
    merchantReference: order.id,
  },
  { idempotencyKey: order.id },
);
// charge.status === "pending": the customer authorizes on their phone, and the
// outcome arrives at your webhook.
```

`this.epay.payments.sendSmsLink(…)` texts the customer a checkout link instead,
and `this.epay.payments.receipt(reference)` returns a receipt for completed,
failed, and cancelled transactions alike. See the
[`@e-pay/node` README](https://github.com/epay-et/node-sdk/tree/main/packages/node#direct-payment) for details.

## Webhooks

Signature verification needs the **raw** request body, so create the app with
`rawBody: true`. Nest then keeps `request.rawBody` alongside the parsed body,
and no parser ordering games are needed.

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Then guard the route:

```ts
import { Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { EpayEvent, EpayWebhookGuard, type WebhookEvent } from "@e-pay/nestjs";

@Controller("webhooks")
export class EpayWebhookController {
  constructor(private readonly queue: QueueService) {}

  @Post("epay")
  @HttpCode(200)
  @UseGuards(EpayWebhookGuard)
  async handle(@EpayEvent() event: WebhookEvent) {
    // The signature is already verified; an invalid one never reaches here.
    await this.queue.enqueue("epay-event", event);
  }
}
```

The guard rejects a bad or missing signature with `401` before your handler
runs. If `rawBody` is unavailable it raises a `500` that says how to fix the
setup, rather than a `401` you might mistake for an attacker.

`@EpayEvent()` can also pull a single field:

```ts
async handle(@EpayEvent('reference') reference: string) { … }
```

### Keep the handler fast and idempotent

ePay retries anything that is not a `2xx` within 10 seconds, up to 5 attempts.
Enqueue the work and return — do not process inline. Deduplicate on
`event.reference`, since a retry can deliver the same event twice.

```ts
switch (event.event) {
  case "payment.success":
    await this.orders.markPaid(event.reference);
    break;
  case "payment.failed":
  case "payment.cancelled":
    await this.orders.release(event.reference);
    break;
  case "payment.refunding":
  case "payment.refunded":
  case "payment.reversed":
    await this.orders.reconcile(event);
    break;
}
```

## Error handling

Errors are the `@e-pay/node` classes, re-exported here so you need not depend on
both packages. They map cleanly onto Nest exception filters:

```ts
import { Catch, HttpException, type ExceptionFilter } from "@nestjs/common";
import {
  EpayApiError,
  EpayNotFoundError,
  EpayRateLimitError,
} from "@e-pay/nestjs";

@Catch(EpayApiError)
export class EpayExceptionFilter implements ExceptionFilter {
  catch(error: EpayApiError, host: ArgumentsHost) {
    const status =
      error instanceof EpayNotFoundError
        ? 404
        : error instanceof EpayRateLimitError
          ? 429
          : 502;

    throw new HttpException(
      { message: "Payment provider error", status },
      status,
    );
  }
}
```

See the [`@e-pay/node` error table](../node/README.md#error-handling) for the full
list.

## Testing

Override the transport through module options — no network, no HTTP mocking
library:

```ts
const moduleRef = await Test.createTestingModule({
  imports: [
    EpayModule.forRoot({
      apiKey: "sk_test_fake",
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ reference: "PAB1", checkoutUrl: "…" }), {
          status: 200,
        }),
    }),
  ],
}).compile();
```

Or replace `EpayService` outright with `overrideProvider(EpayService)`.

## Development

```sh
pnpm build        # dual ESM + CJS into dist/
pnpm test         # build, then run the suite against dist/
pnpm check-types  # tsc --noEmit
```

## License

MIT
