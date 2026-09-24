/** Transaction history: list with cursor pagination, retrieve, and timeline. */

import type { HttpClient, QueryParams } from "../http.js";
import { EpayValidationError } from "../errors.js";
import {
  formatDateParam,
  normalizeCurrency,
  requireReference,
} from "../helpers.js";
import {
  TRANSACTION_STATUSES,
  type ListTransactionsParams,
  type Transaction,
  type TransactionListResponse,
  type TransactionTimeline,
} from "../types.js";

/** Fixed page size of `GET /v1/transactions`. */
export const PAGE_SIZE = 10;

/**
 * One page of transactions, plus the means to walk the rest.
 *
 * Iterating the page walks every remaining transaction across every following
 * page, fetching lazily:
 *
 * ```ts
 * for await (const txn of await client.transactions.list({ status: 'completed' })) {
 *   console.log(txn.reference);
 * }
 * ```
 *
 * Use {@link data} instead when you want exactly the current page.
 */
export class TransactionPage implements AsyncIterable<Transaction> {
  /** Up to 10 transactions, newest first. */
  readonly data: Transaction[];
  /** Cursor for the next page, or null on the last page. */
  readonly nextCursor: string | null;
  /** Whether more transactions exist beyond this page. */
  readonly hasMore: boolean;

  constructor(
    response: TransactionListResponse,
    private readonly fetchNext: (cursor: string) => Promise<TransactionPage>,
  ) {
    this.data = response?.data ?? [];
    this.nextCursor = response?.nextCursor ?? null;
    this.hasMore = response?.hasMore ?? false;
  }

  /** Fetches the next page, or resolves to null when this is the last one. */
  async next(): Promise<TransactionPage | null> {
    if (!this.hasMore || !this.nextCursor) return null;
    return this.fetchNext(this.nextCursor);
  }

  /** Yields this page and each following page in turn. */
  async *pages(): AsyncGenerator<TransactionPage> {
    let page: TransactionPage | null = this;
    while (page) {
      yield page;
      page = await page.next();
    }
  }

  /** Yields every transaction from this page onward, fetching pages on demand. */
  async *[Symbol.asyncIterator](): AsyncIterator<Transaction> {
    for await (const page of this.pages()) {
      yield* page.data;
    }
  }

  /**
   * Collects transactions from this page onward into an array.
   *
   * @param limit Stop after this many transactions. Omit to collect everything,
   * which for a busy account may be a large number of requests.
   */
  async toArray(limit?: number): Promise<Transaction[]> {
    const collected: Transaction[] = [];
    for await (const transaction of this) {
      collected.push(transaction);
      if (limit !== undefined && collected.length >= limit) break;
    }
    return collected;
  }
}

/** Read operations over transaction history. */
export class Transactions {
  constructor(private readonly http: HttpClient) {}

  /**
   * Returns a page of transactions, newest first, 10 per page.
   *
   * Filters persist across pages. When both `from` and `to` are given the API
   * rejects ranges longer than 90 days.
   *
   * @throws {EpayValidationError} when `from` is later than `to`, or a filter is malformed.
   * @throws {EpayBadRequestError} `400` — range too long, or an unrecognised status or currency.
   */
  async list(params: ListTransactionsParams = {}): Promise<TransactionPage> {
    const query: QueryParams = {};

    if (params.from !== undefined)
      query.from = formatDateParam(params.from, "from");
    if (params.to !== undefined) query.to = formatDateParam(params.to, "to");
    if (query.from && query.to && String(query.from) > String(query.to)) {
      throw new EpayValidationError(
        `from (${query.from}) must not be later than to (${query.to})`,
      );
    }

    if (params.currency !== undefined)
      query.currency = normalizeCurrency(params.currency, "currency");

    if (params.status !== undefined) {
      if (!TRANSACTION_STATUSES.includes(params.status)) {
        throw new EpayValidationError(
          `status must be one of ${TRANSACTION_STATUSES.join(", ")}, received ` +
            JSON.stringify(params.status),
        );
      }
      query.status = params.status;
    }

    if (params.cursor !== undefined) query.cursor = params.cursor;

    const response = await this.http.request<TransactionListResponse>({
      method: "GET",
      path: "/transactions",
      query,
    });

    return new TransactionPage(response.data, (cursor) =>
      this.list({ ...params, cursor }),
    );
  }

  /**
   * Yields every transaction matching the filters, walking pages lazily.
   *
   * Shorthand for iterating the first page returned by {@link list}.
   */
  autoPaginate(
    params: ListTransactionsParams = {},
  ): AsyncIterable<Transaction> {
    const list = () => this.list(params);
    return {
      async *[Symbol.asyncIterator]() {
        yield* await list();
      },
    };
  }

  /**
   * Returns the current state of a single transaction.
   *
   * Use this to poll for status or reconcile against your own records.
   *
   * @throws {EpayNotFoundError} `404` — no such transaction on your account.
   */
  async retrieve(reference: string): Promise<Transaction> {
    const ref = requireReference(reference);
    const response = await this.http.request<Transaction>({
      method: "GET",
      path: `/transactions/${encodeURIComponent(ref)}`,
    });
    return response.data;
  }

  /**
   * Returns every event recorded against a transaction, earliest first.
   *
   * `events` is empty until the first provider event arrives.
   *
   * @throws {EpayNotFoundError} `404` — no such transaction on your account.
   */
  async timeline(reference: string): Promise<TransactionTimeline> {
    const ref = requireReference(reference);
    const response = await this.http.request<TransactionTimeline>({
      method: "GET",
      path: `/transactions/${encodeURIComponent(ref)}/timeline`,
    });
    return response.data;
  }
}
