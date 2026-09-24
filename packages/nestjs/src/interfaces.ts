/** Configuration contracts for the ePay Nest module. */

import type { ModuleMetadata, Type } from "@nestjs/common";
import type { EpayClientOptions } from "@e-pay/node";

/** Options for {@link import('./epay.module.js').EpayModule.forRoot}. */
export interface EpayModuleOptions extends EpayClientOptions {
  /**
   * Register the module globally, so `EpayService` is injectable anywhere
   * without importing `EpayModule` into each feature module.
   *
   * @default false
   */
  isGlobal?: boolean;
}

/** Implemented by a class that supplies options to `forRootAsync`. */
export interface EpayOptionsFactory {
  createEpayOptions(): Promise<EpayModuleOptions> | EpayModuleOptions;
}

/**
 * Options for {@link import('./epay.module.js').EpayModule.forRootAsync}, for
 * when configuration comes from `ConfigService` or another provider.
 */
export interface EpayModuleAsyncOptions extends Pick<
  ModuleMetadata,
  "imports"
> {
  /** Register the module globally. */
  isGlobal?: boolean;
  /** Builds the options. Its dependencies come from `inject`. */
  useFactory?: (
    ...args: never[]
  ) => Promise<EpayModuleOptions> | EpayModuleOptions;
  /** Providers passed to `useFactory`. */
  inject?: unknown[];
  /** A class providing {@link EpayOptionsFactory}, instantiated by Nest. */
  useClass?: Type<EpayOptionsFactory>;
  /** An existing {@link EpayOptionsFactory} provider to reuse. */
  useExisting?: Type<EpayOptionsFactory>;
}
