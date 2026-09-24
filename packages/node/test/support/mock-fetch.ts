/** A scripted `fetch` stand-in, so tests exercise the transport without a network. */

import type { FetchLike } from "../../dist/esm/config.js";

/** One captured request. */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted reply. */
export interface MockReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Builds a JSON `Response`, or a bodiless one for 204. */
export function reply(init: MockReply = {}): Response {
  const status = init.status ?? 200;
  const headers = { "content-type": "application/json", ...init.headers };

  if (status === 204 || init.body === undefined) {
    return new Response(null, { status, headers: init.headers ?? {} });
  }
  const payload =
    typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  return new Response(payload, { status, headers });
}

/**
 * Returns a `fetch` that answers with each reply in turn, plus the log of
 * requests it received.
 *
 * A reply may be a function, to assert on the request or to throw a transport
 * error. Running past the end of the script fails loudly rather than hanging.
 */
export function mockFetch(
  replies: Array<
    MockReply | ((call: RecordedCall) => Response | Promise<Response>)
  >,
): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...replies];

  const fetchImpl: FetchLike = async (url, init) => {
    const call: RecordedCall = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    };
    calls.push(call);

    const next = queue.shift();
    if (next === undefined) {
      throw new Error(
        `mockFetch: unexpected extra request ${init.method} ${url}`,
      );
    }
    return typeof next === "function" ? next(call) : reply(next);
  };

  return { fetch: fetchImpl, calls };
}

/** A `fetch` that never answers, so the client's timeout is what fires. */
export const hangingFetch: FetchLike = (_url, init) =>
  new Promise((_resolve, rejectPromise) => {
    init.signal?.addEventListener("abort", () => {
      rejectPromise(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      );
    });
  });
