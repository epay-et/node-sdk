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
   * Returns every provider on the account with its category and enabled state.
   *
   * Disabled providers are included so your UI can show them as unavailable
   * rather than having them silently disappear.
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

  /** Returns only the providers your account can currently route payments through. */
  async listEnabled(): Promise<PaymentProvider[]> {
    const providers = await this.getAll();
    return providers.filter((provider) => provider.isEnabled);
  }
}
