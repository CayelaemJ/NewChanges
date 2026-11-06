import test from "node:test";
import assert from "node:assert/strict";
import { validNotificationEmailAddress } from "../../src/services/notificationEmailAddress.js";

test("common ASCII addresses and plus aliases are supported", () => {
  for (const email of [
    "owner@example.invalid",
    "OWNER@EXAMPLE.INVALID",
    "finance.team+reports@example.co.za",
    "first_last@example.org",
    "first.last@sub-domain.example.com",
    "admin@xn--bcher-kva.example",
  ]) assert.equal(validNotificationEmailAddress(email), true, email);
});

test("header injection, display-name syntax and ambiguous addresses are rejected", () => {
  for (const email of [
    "User <user@example.invalid>",
    "user@example.invalid,other@example.invalid",
    "user@example.invalid;other@example.invalid",
    "user@example.invalid\r\nBcc: outsider@example.invalid",
    "user@example.invalid\u0000",
    "user@example.invalid\u200b",
    "user@example.invalid\u00a0",
    "user@example.invalid ",
    " user@example.invalid",
    "user@exa<mple.invalid",
    "user@example.invalid> <other@example.invalid",
    "user@example.invalid (comment)",
    "user@example.invalid:25",
    "user@[127.0.0.1]",
  ]) assert.equal(validNotificationEmailAddress(email), false, JSON.stringify(email));
});

test("malformed domains and local parts fail closed", () => {
  for (const email of [
    "", "@example.invalid", "user@", "user@example", "user@example..invalid",
    "user@-example.invalid", "user@example-.invalid", "user@ex_ample.invalid",
    ".user@example.invalid", "user.@example.invalid", "us..er@example.invalid",
    "user@@example.invalid", "user@example.123",
    "a".repeat(65) + "@example.invalid",
    "a@" + "b".repeat(64) + ".invalid",
    "a@" + "b".repeat(63) + "." + "c".repeat(63) + "." + "d".repeat(63) + ".invalid",
  ]) assert.equal(validNotificationEmailAddress(email), false, email.slice(0, 90));
});

test("non-string inputs are rejected without coercion", () => {
  for (const value of [null, undefined, 42, true, [], {}, { toString: () => "a@example.invalid" }])
    assert.equal(validNotificationEmailAddress(value), false);
});
