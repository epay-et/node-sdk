import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EpayValidationError,
  MAX_AMOUNT,
  formatAmount,
  normalizeCurrency,
  normalizePhone,
} from "../dist/esm/index.js";

test("formatAmount normalizes to two decimal places", () => {
  assert.equal(formatAmount("250.00"), "250.00");
  assert.equal(formatAmount("250"), "250.00");
  assert.equal(formatAmount("250.5"), "250.50");
  assert.equal(formatAmount(250), "250.00");
  assert.equal(formatAmount(1.5), "1.50");
  assert.equal(formatAmount(0.01), "0.01");
  assert.equal(formatAmount(MAX_AMOUNT), "999999999.99");
});

test("formatAmount rounds numbers and trims surrounding space in strings", () => {
  assert.equal(formatAmount(10.005), "10.01");
  assert.equal(formatAmount("  42.10  "), "42.10");
});

test("formatAmount rejects amounts the API would reject", () => {
  const rejected = [
    0,
    -1,
    "0",
    "0.00",
    "-5.00",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1000000000.00", // 10 integer digits
    "1.234", // 3 decimal places
    "abc",
    "",
    "1e3",
  ];

  for (const value of rejected) {
    assert.throws(
      () => formatAmount(value as string | number),
      EpayValidationError,
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test("normalizePhone accepts every documented Ethiopian form", () => {
  const expected = "+251911234567";
  assert.equal(normalizePhone("+251911234567"), expected);
  assert.equal(normalizePhone("251911234567"), expected);
  assert.equal(normalizePhone("0911234567"), expected);
  assert.equal(normalizePhone("911234567"), expected);
  assert.equal(normalizePhone("+251 91 123 4567"), expected);
  assert.equal(normalizePhone("0911-234-567"), expected);
  assert.equal(normalizePhone("(0911) 234 567"), expected);
});

test("normalizePhone accepts the Safaricom 7xx range", () => {
  assert.equal(normalizePhone("0711234567"), "+251711234567");
});

test("normalizePhone normalizes the sandbox magic numbers", () => {
  // From the Test Accounts reference.
  for (const magic of [
    "251900000000",
    "251900000001",
    "251900000002",
    "251900000003",
    "251900000004",
  ]) {
    assert.equal(normalizePhone(magic), `+${magic}`);
  }
});

test("normalizePhone rejects numbers outside the Ethiopian mobile ranges", () => {
  for (const value of [
    "+251811234567",
    "0811234567",
    "09112345678",
    "091123456",
    "",
    "+1 555 0100",
  ]) {
    assert.throws(
      () => normalizePhone(value),
      EpayValidationError,
      `expected ${value} rejected`,
    );
  }
});

test("normalizeCurrency uppercases and validates", () => {
  assert.equal(normalizeCurrency("etb"), "ETB");
  assert.equal(normalizeCurrency(" ETB "), "ETB");
  assert.throws(() => normalizeCurrency("ET"), EpayValidationError);
  assert.throws(() => normalizeCurrency("ETBB"), EpayValidationError);
  assert.throws(() => normalizeCurrency("123"), EpayValidationError);
});
