import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  Epay,
  EpayConfigError,
  EpayValidationError,
  EpayWebhookSignatureError,
  SIGNATURE_HEADER,
  constructWebhookEvent,
  isKnownWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
} from "../dist/esm/index.js";
import {
  constructWebhookEventAsync,
  signWebhookPayloadAsync,
  verifyWebhookSignatureAsync,
} from "../dist/esm/webhooks-web.js";

const SECRET = "whsec_test_secret";

/** A realistic delivery, matching the documented payload shape. */
const PAYLOAD = JSON.stringify({
  event: "payment.success",
  mode: "live",
  reference: "PAB12CD3420260813",
  merchantReference: "order_123",
  amount: "250.00",
  serviceFee: "7.50",
  currency: "ETB",
  status: "completed",
  paymentMethod: "telebirr",
  customer: {
    name: "Abebe Bikila",
    email: "abebe@example.com",
    phone: "+251911234567",
  },
  paidAt: "2026-08-13T11:47:00.000Z",
  createdAt: "2026-08-13T11:30:00.000Z",
});

function header(payload = PAYLOAD, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

test("the header name matches the documented one", () => {
  assert.equal(SIGNATURE_HEADER, "x-epay-signature");
});

test("signWebhookPayload matches a hand-rolled HMAC-SHA256", () => {
  const expected = createHmac("sha256", SECRET).update(PAYLOAD).digest("hex");
  assert.equal(signWebhookPayload(PAYLOAD, SECRET), expected);
});

test("a genuine delivery verifies", () => {
  assert.equal(verifyWebhookSignature(PAYLOAD, header(), SECRET), true);
});

test("the sha256= prefix is optional and case-insensitive", () => {
  const hex = signWebhookPayload(PAYLOAD, SECRET);
  assert.equal(verifyWebhookSignature(PAYLOAD, hex, SECRET), true);
  assert.equal(
    verifyWebhookSignature(PAYLOAD, `SHA256=${hex.toUpperCase()}`, SECRET),
    true,
  );
  assert.equal(
    verifyWebhookSignature(PAYLOAD, `  sha256=${hex}  `, SECRET),
    true,
  );
});

test("a tampered body, wrong secret, or truncated digest fails", () => {
  const tampered = PAYLOAD.replace("250.00", "1.00");
  assert.equal(verifyWebhookSignature(tampered, header(), SECRET), false);
  assert.equal(
    verifyWebhookSignature(PAYLOAD, header(PAYLOAD, "wrong"), SECRET),
    false,
  );
  assert.equal(verifyWebhookSignature(PAYLOAD, "sha256=abc", SECRET), false);
});

test("a missing or malformed header fails instead of throwing", () => {
  for (const value of [
    undefined,
    null,
    "",
    "sha256=",
    "not-hex!!",
    "sha256=zzzz",
  ]) {
    assert.equal(
      verifyWebhookSignature(PAYLOAD, value, SECRET),
      false,
      `header: ${value}`,
    );
  }
});

test("a repeated header, as Node may present it, uses the first value", () => {
  assert.equal(verifyWebhookSignature(PAYLOAD, [header()], SECRET), true);
});

test("Buffer bodies verify identically to strings", () => {
  assert.equal(
    verifyWebhookSignature(Buffer.from(PAYLOAD, "utf8"), header(), SECRET),
    true,
  );
});

test("constructWebhookEvent returns the parsed event on a valid signature", () => {
  const event = constructWebhookEvent(PAYLOAD, header(), SECRET);
  assert.equal(event.event, "payment.success");
  assert.equal(event.reference, "PAB12CD3420260813");
  assert.equal(event.amount, "250.00");
  assert.equal(event.customer.phone, "+251911234567");
  assert.equal(isKnownWebhookEvent(event), true);
});

test("constructWebhookEvent fails closed", () => {
  assert.throws(
    () => constructWebhookEvent(PAYLOAD, undefined, SECRET),
    EpayWebhookSignatureError,
  );
  assert.throws(
    () => constructWebhookEvent(PAYLOAD, "sha256=00", SECRET),
    EpayWebhookSignatureError,
  );
  assert.throws(
    () =>
      constructWebhookEvent(
        PAYLOAD.replace("250.00", "1.00"),
        header(),
        SECRET,
      ),
    EpayWebhookSignatureError,
  );
});

test("a verified body that is not a JSON object is rejected", () => {
  const notJson = "this is not json";
  assert.throws(
    () => constructWebhookEvent(notJson, header(notJson), SECRET),
    EpayValidationError,
  );
  const array = "[1,2,3]";
  assert.throws(
    () => constructWebhookEvent(array, header(array), SECRET),
    EpayValidationError,
  );
});

test("an unrecognised event name verifies but is reported as unknown", () => {
  const body = JSON.stringify({ event: "payment.disputed", reference: "P1" });
  const event = constructWebhookEvent(body, header(body), SECRET);
  assert.equal(event.event, "payment.disputed");
  assert.equal(isKnownWebhookEvent(event), false);
});

test("client.webhooks uses the configured secret", () => {
  const client = new Epay({ apiKey: "sk_test_abc", webhookSecret: SECRET });
  assert.equal(client.webhooks.configured, true);
  assert.equal(client.webhooks.verify(PAYLOAD, header()), true);
  assert.equal(
    client.webhooks.constructEvent(PAYLOAD, header()).reference,
    "PAB12CD3420260813",
  );
});

test("client.webhooks explains itself when no secret is configured", () => {
  const saved = process.env.EPAY_WEBHOOK_SECRET;
  delete process.env.EPAY_WEBHOOK_SECRET;
  try {
    const client = new Epay({ apiKey: "sk_test_abc" });
    assert.equal(client.webhooks.configured, false);
    assert.throws(
      () => client.webhooks.verify(PAYLOAD, header()),
      EpayConfigError,
    );
    // A per-call secret still works.
    assert.equal(client.webhooks.verify(PAYLOAD, header(), SECRET), true);
  } finally {
    if (saved !== undefined) process.env.EPAY_WEBHOOK_SECRET = saved;
  }
});

test("the WebCrypto path agrees with the node:crypto path", async () => {
  assert.equal(
    await signWebhookPayloadAsync(PAYLOAD, SECRET),
    signWebhookPayload(PAYLOAD, SECRET),
  );
  assert.equal(
    await verifyWebhookSignatureAsync(PAYLOAD, header(), SECRET),
    true,
  );
  assert.equal(
    await verifyWebhookSignatureAsync(PAYLOAD, "sha256=00", SECRET),
    false,
  );

  const event = await constructWebhookEventAsync(PAYLOAD, header(), SECRET);
  assert.equal(event.reference, "PAB12CD3420260813");

  await assert.rejects(
    () => constructWebhookEventAsync(PAYLOAD, "sha256=00", SECRET),
    EpayWebhookSignatureError,
  );
});
