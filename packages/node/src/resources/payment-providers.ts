/** Payment providers available to the account, in compact and full form. */

import type { HttpClient } from "../http.js";
import type {
  DataEnvelope,
  PaymentProvider,
  PaymentProviderItem,
} from "../types.js";

/**
 * Read operations over the account's payment providers.
 *
 * Both endpoints are mode-aware: a `sk_test_…` key returns sandbox providers
 * and a `sk_live_…` key returns live ones.
 */
export class PaymentProviders {
  constructor(private readonly http: HttpClient) {}

  /**
   * Returns a compact provider list suited to dropdowns and selection UIs.
   *
   * Requires the `list_platform_payment_provider` permission.
   *
   * @throws {EpayPermissionDeniedError} `403` — the key lacks that permission.
   */
  async list(): Promise<PaymentProviderItem[]> {
    const response = await this.http.request<
      DataEnvelope<PaymentProviderItem[]>
    >({
      method: "GET",
      path: "/payment-providers/list",
    });
    return response.data?.data ?? [];
  }

  /**
   * Returns every provider available to the account, each with the payment
   * flows it supports.
   *
   * Requires the `get_platform_payment_provider` permission.
   *
   * @throws {EpayPermissionDeniedError} `403` — the key lacks that permission.
   */
  async getAll(): Promise<PaymentProvider[]> {
    const response = await this.http.request<DataEnvelope<PaymentProvider[]>>({
      method: "GET",
      path: "/payment-providers",
    });
    return response.data?.data ?? [];
  }

  /**
   * Returns the providers that can take a direct payment, keeping only their
   * direct-payment flows. Providers with no such flow are left out.
   *
   * Use it to build the selector for `payments.directPayment()`: pass a
   * provider's `providerCode` as `pspCode`, and pre-select the flow whose
   * `isDefault` is true.
   */
  async listForDirectPayment(): Promise<PaymentProvider[]> {
    const providers = await this.getAll();
    return providers
      .map((provider) => ({
        ...provider,
        flows: (provider.flows ?? []).filter(
          (flow) => flow.supportsDirectPayment,
        ),
      }))
      .filter((provider) => provider.flows.length > 0);
  }

  /**
   * @deprecated The API no longer reports a per-provider enabled state: every
   * provider {@link getAll} returns is available to the account. This now
   * returns the same list, and will be removed in a future version.
   */
  async listEnabled(): Promise<PaymentProvider[]> {
    return this.getAll();
  }
}
