import { test } from "node:test";
import assert from "node:assert/strict";

import { Epay, EpayServerError, type FetchLike } from "../dist/esm/index.js";

/**
 * The transport contract is deliberately narrow, so a merchant can back it with
 * axios, undici + a proxy agent, or anything else. These tests pin the contract
 * down: if the client ever starts relying on more of `Response`, they break.
 */

test("a transport may return a minimal Response-like object", async () => {
  // Nothing here is a real fetch Response: only ok/status/headers/text are used.
  const adapter: FetchLike = async () =>
    ({
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "req_7" }),
      text: async () =>
        JSON.stringify({ reference: "PAB1", status: "completed" }),
    }) as unknown as Response;

  const epay = new Epay({
    apiKey: "sk_test_abc",
    fetch: adapter,
    maxRetries: 0,
  });
  const transaction = await epay.transactions.retrieve("PAB1");

  assert.equal(transaction.reference, "PAB1");
});

test("an axios-shaped adapter works, including its non-2xx convention", async () => {
  // axios rejects on non-2xx and exposes { status, data, headers }, so an
  // adapter has to catch and translate. This mirrors the README example.
  interface AxiosLikeError {
    response?: {
      status: number;
      data: unknown;
      headers: Record<string, string>;
    };
  }

  const axiosLike = async (): Promise<never> => {
    throw {
      response: {
        status: 503,
        data: { status: "error", data: { message: "upstream unavailable" } },
        headers: { "retry-after": "0" },
      },
    } satisfies AxiosLikeError as never;
  };

  const adapter: FetchLike = async () => {
    try {
      await axiosLike();
      throw new Error("unreachable");
    } catch (error) {
      const { response } = error as AxiosLikeError;
      if (!response) throw error;
      return new Response(JSON.stringify(response.data), {
        status: response.status,
        headers: response.headers,
      });
    }
  };

  const epay = new Epay({
    apiKey: "sk_test_abc",
    fetch: adapter,
    maxRetries: 0,
  });

  await assert.rejects(
    () => epay.transactions.retrieve("PAB1"),
    (error: unknown) => {
      assert.ok(
        error instanceof EpayServerError,
        "status mapping should still apply",
      );
      assert.match((error as Error).message, /upstream unavailable/);
      return true;
    },
  );
});

test("a custom transport receives the abort signal, so timeouts still work", async () => {
  let sawSignal = false;

  const adapter: FetchLike = (_url, init) =>
    new Promise((_resolve, rejectPromise) => {
      sawSignal = init.signal instanceof AbortSignal;
      init.signal?.addEventListener("abort", () =>
        rejectPromise(new Error("aborted")),
      );
    });

  const epay = new Epay({
    apiKey: "sk_test_abc",
    fetch: adapter,
    timeout: 30,
    maxRetries: 0,
  });

  await assert.rejects(() => epay.transactions.retrieve("PAB1"), /timed out/);
  assert.equal(sawSignal, true);
});

test("a custom transport sees the method, headers, and serialized body", async () => {
  const seen: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }> = [];

  const adapter: FetchLike = async (url, init) => {
    seen.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    });
    return new Response(JSON.stringify({ reference: "PAB1" }), { status: 200 });
  };

  const epay = new Epay({
    apiKey: "sk_test_abc",
    fetch: adapter,
    maxRetries: 0,
  });
  await epay.payments.initialize({
    amount: "10.00",
    currencyCode: "ETB",
    customerPhone: "0911234567",
  });

  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.headers.Authorization, "Bearer sk_test_abc");
  assert.deepEqual(JSON.parse(seen[0]!.body!), {
    amount: "10.00",
    currencyCode: "ETB",
    customerPhone: "+251911234567",
  });
});
