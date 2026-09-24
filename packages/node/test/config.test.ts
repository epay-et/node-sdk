import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BASE_URL,
  Epay,
  EpayConfigError,
  modeFromApiKey,
} from "../dist/esm/index.js";

test("modeFromApiKey maps prefixes, and tolerates an unknown one", () => {
  assert.equal(modeFromApiKey("sk_live_abc"), "live");
  assert.equal(modeFromApiKey("sk_test_abc"), "sandbox");
  assert.equal(modeFromApiKey("sk_future_abc"), null);
});

test("the client derives its mode from the key prefix", () => {
  assert.equal(new Epay({ apiKey: "sk_live_abc123" }).mode, "live");
  assert.equal(new Epay({ apiKey: "sk_test_abc123" }).isSandbox, true);
  assert.equal(new Epay({ apiKey: "sk_live_abc123" }).isSandbox, false);
});

test("the client rejects a missing or non-secret key", () => {
  assert.throws(() => new Epay({ apiKey: "" }), EpayConfigError);
  assert.throws(() => new Epay({ apiKey: "   " }), EpayConfigError);
  assert.throws(() => new Epay({ apiKey: "pk_live_abc123" }), EpayConfigError);
});

test("the client rejects out-of-range transport options", () => {
  assert.throws(
    () => new Epay({ apiKey: "sk_test_a", timeout: 0 }),
    EpayConfigError,
  );
  assert.throws(
    () => new Epay({ apiKey: "sk_test_a", timeout: -1 }),
    EpayConfigError,
  );
  assert.throws(
    () => new Epay({ apiKey: "sk_test_a", maxRetries: -1 }),
    EpayConfigError,
  );
  assert.throws(
    () => new Epay({ apiKey: "sk_test_a", maxRetries: 1.5 }),
    EpayConfigError,
  );
});

test("options fall back to environment variables", () => {
  const saved = { ...process.env };
  try {
    process.env.EPAY_SECRET_KEY = "sk_test_from_env";
    process.env.EPAY_BASE_URL = "https://staging.e-pay.et/v1";
    const client = new Epay();
    assert.equal(client.mode, "sandbox");
    assert.equal(client.baseUrl, "https://staging.e-pay.et/v1");
  } finally {
    process.env = saved;
  }
});

test("a trailing slash on baseUrl does not double up in request URLs", () => {
  const client = new Epay({
    apiKey: "sk_test_a",
    baseUrl: "https://api.e-pay.et/v1/",
  });
  assert.equal(client.baseUrl, "https://api.e-pay.et/v1");
});

test("baseUrl defaults to the documented API root", () => {
  const saved = process.env.EPAY_BASE_URL;
  delete process.env.EPAY_BASE_URL;
  try {
    assert.equal(new Epay({ apiKey: "sk_test_a" }).baseUrl, DEFAULT_BASE_URL);
    assert.equal(DEFAULT_BASE_URL, "https://api.e-pay.et/v1");
  } finally {
    if (saved !== undefined) process.env.EPAY_BASE_URL = saved;
  }
});

test("the client never renders its API key in full", () => {
  const key = "sk_live_supersecretvalue1234";
  const rendered = String(new Epay({ apiKey: key }));
  assert.ok(!rendered.includes("supersecretvalue"), rendered);
  assert.match(rendered, /sk_live_…1234/);
});
