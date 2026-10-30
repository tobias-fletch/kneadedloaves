import assert from "node:assert/strict";
import { test } from "node:test";
import { sendErrorSummary } from "../lib/send-error";

test("keeps only code, responseCode and command from a failed Resend send", () => {
  const error = Object.assign(new Error("Invalid login: 535 Authentication credentials invalid for re_live_fakefakefake"), {
    code: "EAUTH",
    responseCode: 535,
    command: "AUTH PLAIN",
    response: "535 Authentication credentials invalid",
    user: "resend",
    pass: "re_live_fakefakefake",
    recipients: ["visitor@example.com"]
  });
  const summary = sendErrorSummary(error);
  assert.equal(summary, "code=EAUTH responseCode=535 command=AUTH PLAIN");
  for (const leak of ["re_live_fakefakefake", "visitor@example.com", "Authentication credentials", "resend"]) assert.ok(!summary.includes(leak), leak);
});

test("handles errors without send-error fields", () => {
  assert.equal(sendErrorSummary(new Error("boom")), "code=- responseCode=- command=-");
  assert.equal(sendErrorSummary(undefined), "code=- responseCode=- command=-");
  assert.equal(sendErrorSummary("text"), "code=- responseCode=- command=-");
});

test("drops field values that don't look like send-error codes", () => {
  const summary = sendErrorSummary({ code: "EAUTH user@example.com", responseCode: 99999, command: "RCPT TO:<someone@example.com>" });
  assert.equal(summary, "code=- responseCode=- command=-");
});

test("keeps a connection error code with no reply from Resend", () => {
  assert.equal(sendErrorSummary({ code: "ETIMEDOUT", command: "CONN" }), "code=ETIMEDOUT responseCode=- command=CONN");
});
