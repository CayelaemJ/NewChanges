import test from "node:test";
import assert from "node:assert/strict";
import { allowedSlackWebhookUrl } from "../../src/services/slackWebhookPolicy.js";

test("Slack incoming webhook allow-list keeps supported endpoints", () => {
  assert.equal(allowedSlackWebhookUrl("https://hooks.slack.com/services/T123/B456/AbCd99_-"),true);
  assert.equal(allowedSlackWebhookUrl("https://hooks.slack-gov.com/services/T123/B456/AbCd99"),true);
});

test("Slack notification destination is not a generic SSRF primitive", () => {
  for (const raw of [
    "", null, 1, "http://hooks.slack.com/services/T/B/key",
    "https://hooks.slack.com.evil.example/services/T/B/key",
    "https://127.0.0.1/services/T/B/key",
    "https://169.254.169.254/latest/meta-data/",
    "https://hooks.slack.com@127.0.0.1/services/T/B/key",
    "https://hooks.slack.com:444/services/T/B/key",
    "https://hooks.slack.com/services/T/B/key?copy=secret",
    "https://hooks.slack.com/services/T/B/key#fragment",
    "https://hooks.slack.com/not-a-webhook",
    "https://hooks.slack.com/services/T/B/%2e%2e",
    " https://hooks.slack.com/services/T/B/key",
  ]) assert.equal(allowedSlackWebhookUrl(raw),false,String(raw));
});
