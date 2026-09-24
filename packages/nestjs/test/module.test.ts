import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  Module,
  InternalServerErrorException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";

import {
  EPAY_CLIENT,
  EpayModule,
  EpayService,
  EpayWebhookGuard,
  type EpayModuleOptions,
  type EpayOptionsFactory,
} from "../dist/esm/index.js";

const API_KEY = "sk_test_0123456789abcdef";
const WEBHOOK_SECRET = "whsec_nest_test";

const PAYLOAD = JSON.stringify({
  event: "payment.success",
  mode: "sandbox",
  reference: "PAB12CD3420260813",
  status: "completed",
  amount: "250.00",
});

function signature(payload = PAYLOAD, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

/** Builds the minimal ExecutionContext the guard reads. */
function executionContext(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as Parameters<EpayWebhookGuard["canActivate"]>[0];
}

async function moduleWith(options: EpayModuleOptions) {
  const moduleRef = await Test.createTestingModule({
    imports: [EpayModule.forRoot(options)],
  }).compile();
  return moduleRef;
}

test("forRoot wires up EpayService with the given options", async () => {
  const moduleRef = await moduleWith({ apiKey: API_KEY });
  const service = moduleRef.get(EpayService);

  assert.ok(service instanceof EpayService);
  assert.equal(service.mode, "sandbox");
  assert.equal(service.isSandbox, true);
  assert.ok(service.payments, "payments resource should be reachable");
  assert.ok(service.transactions);
  assert.ok(service.paymentProviders);
  assert.ok(service.webhooks);

  await moduleRef.close();
});

test("the underlying client is a shared singleton", async () => {
  const moduleRef = await moduleWith({ apiKey: API_KEY });

  const service = moduleRef.get(EpayService);
  const client = moduleRef.get(EPAY_CLIENT);

  assert.equal(
    service.raw,
    client,
    "the service should not build its own client",
  );
  assert.equal(
    moduleRef.get(EpayService),
    service,
    "EpayService should be a singleton",
  );

  await moduleRef.close();
});

test("a bad API key fails at module initialization, not at first payment", async () => {
  await assert.rejects(
    () => moduleWith({ apiKey: "pk_live_wrongkind" }),
    /secret key/,
  );
});

test("forRootAsync resolves options from a factory", async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      EpayModule.forRootAsync({
        useFactory: () => ({ apiKey: "sk_live_0123456789abcdef" }),
      }),
    ],
  }).compile();

  assert.equal(moduleRef.get(EpayService).mode, "live");
  await moduleRef.close();
});

test("forRootAsync resolves options from a provider in an imported module", async () => {
  // Stands in for ConfigModule/ConfigService. Both classes are declared without
  // decorator syntax, which Node's type-stripping test runner cannot transform;
  // Module() is an ordinary function, so it is applied by hand instead.
  class FakeConfig {
    get(key: string): string {
      assert.equal(key, "EPAY_SECRET_KEY");
      return API_KEY;
    }
  }
  class FakeConfigModule {}
  Module({
    providers: [{ provide: FakeConfig, useValue: new FakeConfig() }],
    exports: [FakeConfig],
  })(FakeConfigModule);

  const moduleRef = await Test.createTestingModule({
    imports: [
      EpayModule.forRootAsync({
        imports: [FakeConfigModule],
        inject: [FakeConfig],
        useFactory: ((config: FakeConfig) => ({
          apiKey: config.get("EPAY_SECRET_KEY"),
        })) as never,
      }),
    ],
  }).compile();

  assert.equal(moduleRef.get(EpayService).isSandbox, true);
  await moduleRef.close();
});

test("forRootAsync resolves options from an options factory class", async () => {
  class EpayConfig implements EpayOptionsFactory {
    createEpayOptions(): EpayModuleOptions {
      return { apiKey: API_KEY, webhookSecret: WEBHOOK_SECRET };
    }
  }

  const moduleRef = await Test.createTestingModule({
    imports: [EpayModule.forRootAsync({ useClass: EpayConfig })],
  }).compile();

  assert.equal(moduleRef.get(EpayService).webhooks.configured, true);
  await moduleRef.close();
});

test("forRootAsync without a source of options is rejected", () => {
  assert.throws(
    () => EpayModule.forRootAsync({}),
    /useFactory, useClass, or useExisting/,
  );
});

test("forRoot({ isGlobal }) marks the module global", () => {
  assert.equal(
    EpayModule.forRoot({ apiKey: API_KEY, isGlobal: true }).global,
    true,
  );
  assert.equal(EpayModule.forRoot({ apiKey: API_KEY }).global, false);
});

test("the guard accepts a genuine delivery and exposes the event", async () => {
  const moduleRef = await moduleWith({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
  const guard = moduleRef.get(EpayWebhookGuard);

  const request = {
    headers: { "x-epay-signature": signature() },
    rawBody: Buffer.from(PAYLOAD, "utf8"),
  } as Record<string, unknown>;

  assert.equal(guard.canActivate(executionContext(request)), true);
  assert.equal(
    (request.epayEvent as { reference: string }).reference,
    "PAB12CD3420260813",
  );

  await moduleRef.close();
});

test("the guard rejects a tampered body with 401", async () => {
  const moduleRef = await moduleWith({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
  const guard = moduleRef.get(EpayWebhookGuard);

  const request = {
    headers: { "x-epay-signature": signature() },
    rawBody: Buffer.from(PAYLOAD.replace("250.00", "1.00"), "utf8"),
  };

  assert.throws(
    () => guard.canActivate(executionContext(request)),
    UnauthorizedException,
  );

  await moduleRef.close();
});

test("the guard rejects a missing signature header with 401", async () => {
  const moduleRef = await moduleWith({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
  const guard = moduleRef.get(EpayWebhookGuard);

  const request = { headers: {}, rawBody: Buffer.from(PAYLOAD, "utf8") };

  assert.throws(
    () => guard.canActivate(executionContext(request)),
    UnauthorizedException,
  );

  await moduleRef.close();
});

test("a missing rawBody is a 500 with setup instructions, not a 401", async () => {
  const moduleRef = await moduleWith({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
  });
  const guard = moduleRef.get(EpayWebhookGuard);

  const request = {
    headers: { "x-epay-signature": signature() },
    body: JSON.parse(PAYLOAD),
  };

  assert.throws(
    () => guard.canActivate(executionContext(request)),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException);
      assert.match(String((error as Error).message), /rawBody: true/);
      return true;
    },
  );

  await moduleRef.close();
});

test("a guard with no configured webhook secret surfaces the config error", async () => {
  const saved = process.env.EPAY_WEBHOOK_SECRET;
  delete process.env.EPAY_WEBHOOK_SECRET;
  try {
    const moduleRef = await moduleWith({ apiKey: API_KEY });
    const guard = moduleRef.get(EpayWebhookGuard);

    const request = {
      headers: { "x-epay-signature": signature() },
      rawBody: Buffer.from(PAYLOAD, "utf8"),
    };

    assert.throws(
      () => guard.canActivate(executionContext(request)),
      /No webhook secret/,
    );
    await moduleRef.close();
  } finally {
    if (saved !== undefined) process.env.EPAY_WEBHOOK_SECRET = saved;
  }
});

test("the client honours a mock transport injected through module options", async () => {
  const calls: string[] = [];
  const moduleRef = await moduleWith({
    apiKey: API_KEY,
    maxRetries: 0,
    fetch: async (url) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          reference: "PAB1",
          checkoutUrl: "https://checkout.epayethiopia.com/pay/PAB1",
          status: "success",
          expiresAt: "2026-08-13T12:30:00.000Z",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const session = await moduleRef.get(EpayService).payments.initialize({
    amount: 250,
    currencyCode: "ETB",
    customerPhone: "0911234567",
  });

  assert.equal(session.reference, "PAB1");
  assert.deepEqual(calls, [
    "https://api.epayethiopia.com/v1/transactions/initialize",
  ]);

  await moduleRef.close();
});
