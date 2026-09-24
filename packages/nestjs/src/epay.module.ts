/** The `EpayModule` dynamic module. */

import { Module, type DynamicModule, type Provider } from "@nestjs/common";
import { Epay } from "@e-pay/node";

import { EPAY_CLIENT, EPAY_MODULE_OPTIONS } from "./epay.constants.js";
import { EpayService } from "./epay.service.js";
import { EpayWebhookGuard } from "./epay-webhook.guard.js";
import type {
  EpayModuleAsyncOptions,
  EpayModuleOptions,
  EpayOptionsFactory,
} from "./interfaces.js";

/**
 * Registers {@link EpayService} and {@link EpayWebhookGuard}.
 *
 * ```ts
 * @Module({
 *   imports: [
 *     EpayModule.forRoot({
 *       apiKey: process.env.EPAY_SECRET_KEY,
 *       webhookSecret: process.env.EPAY_WEBHOOK_SECRET,
 *       isGlobal: true,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Every option is optional: with none set, the client reads `EPAY_SECRET_KEY`,
 * `EPAY_WEBHOOK_SECRET`, and `EPAY_BASE_URL` from the environment.
 */
@Module({})
export class EpayModule {
  /** Registers the module with options known at startup. */
  static forRoot(options: EpayModuleOptions = {}): DynamicModule {
    return {
      module: EpayModule,
      global: options.isGlobal ?? false,
      providers: [
        { provide: EPAY_MODULE_OPTIONS, useValue: options },
        EpayModule.clientProvider,
        EpayService,
        EpayWebhookGuard,
      ],
      exports: [EpayService, EpayWebhookGuard],
    };
  }

  /**
   * Registers the module with options resolved from other providers, such as
   * `ConfigService`.
   *
   * ```ts
   * EpayModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     apiKey: config.getOrThrow('EPAY_SECRET_KEY'),
   *     webhookSecret: config.getOrThrow('EPAY_WEBHOOK_SECRET'),
   *   }),
   * });
   * ```
   */
  static forRootAsync(options: EpayModuleAsyncOptions): DynamicModule {
    return {
      module: EpayModule,
      global: options.isGlobal ?? false,
      imports: options.imports ?? [],
      providers: [
        ...EpayModule.optionsProviders(options),
        EpayModule.clientProvider,
        EpayService,
        EpayWebhookGuard,
      ],
      exports: [EpayService, EpayWebhookGuard],
    };
  }

  /**
   * Builds one client per registration. The client is stateless apart from its
   * configuration, so a singleton is safe to share across requests.
   */
  private static readonly clientProvider: Provider = {
    provide: EPAY_CLIENT,
    inject: [EPAY_MODULE_OPTIONS],
    useFactory: (options: EpayModuleOptions) => new Epay(options),
  };

  /** Translates the three async option styles into providers. */
  private static optionsProviders(options: EpayModuleAsyncOptions): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: EPAY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: (options.inject ?? []) as never[],
        },
      ];
    }

    const factoryClass = options.useExisting ?? options.useClass;
    if (!factoryClass) {
      throw new Error(
        "EpayModule.forRootAsync requires one of useFactory, useClass, or useExisting.",
      );
    }

    const providers: Provider[] = [
      {
        provide: EPAY_MODULE_OPTIONS,
        inject: [factoryClass],
        useFactory: (factory: EpayOptionsFactory) =>
          factory.createEpayOptions(),
      },
    ];

    // `useExisting` points at a provider another module already supplies.
    if (options.useClass) providers.push(options.useClass);

    return providers;
  }
}
