/** Injection tokens used by {@link import('./epay.module.js').EpayModule}. */

/** Token for the resolved {@link import('./interfaces.js').EpayModuleOptions}. */
export const EPAY_MODULE_OPTIONS = Symbol("EPAY_MODULE_OPTIONS");

/** Token for the underlying `Epay` client from `@e-pay/node`. */
export const EPAY_CLIENT = Symbol("EPAY_CLIENT");

/** Request property the webhook guard stores the verified event on. */
export const EPAY_EVENT_PROPERTY = "epayEvent";
