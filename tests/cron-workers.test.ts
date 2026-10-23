import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET as emailCron } from "../app/api/cron/email-worker/route";
import { GET as paymentsCron } from "../app/api/cron/payments-expire/route";
import { isCronAuthorized } from "../lib/cron-auth";
import { handleCron } from "../lib/cron-route";
import { processOrderEmails } from "../lib/email-maintenance";
import { emailDedupeLike, emailJobIsClaimable, processEmailQueue } from "../lib/email-queue";
import { runBounded } from "../lib/worker-batch";

const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://kneadedloaves.com/api/cron/email-worker", { headers });
}

test("cron authorization matches only the exact bearer secret", () => {
  assert.equal(isCronAuthorized(`Bearer ${secret}`, secret), true);
  assert.equal(isCronAuthorized(`bearer ${secret}`, secret), false);
  assert.equal(isCronAuthorized(`Bearer ${secret} `, secret), false);
  assert.equal(isCronAuthorized(null, secret), false);
  assert.equal(isCronAuthorized(`Bearer ${secret}`, ""), false);
  assert.equal(isCronAuthorized(`Bearer ${secret}`, undefined), false);
});

test("cron routes reject a missing or wrong secret and an authorized handler stays bounded", async () => {
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    for (const route of [emailCron, paymentsCron]) {
      const missing = await route(cronRequest());
      assert.equal(missing.status, 401);
      assert.deepEqual(await missing.json(), { error: "Unauthorized" });
      process.env.CRON_SECRET = secret;
      const wrong = await route(cronRequest("Bearer wrong-secret"));
      assert.equal(wrong.status, 401);
      assert.deepEqual(await wrong.json(), { error: "Unauthorized" });
      delete process.env.CRON_SECRET;
    }

    process.env.CRON_SECRET = secret;
    let calls = 0;
    const work = async () => {
      calls += 1;
      return { processed: calls === 1 ? 1 : 0 };
    };
    const first = await handleCron(cronRequest(`Bearer ${secret}`), work);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, processed: 1 });
    const second = await handleCron(cronRequest(`Bearer ${secret}`), work);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, processed: 0 });
    assert.equal(calls, 2);

    const failed = await handleCron(cronRequest(`Bearer ${secret}`), async () => {
      throw new Error("smtp password leaked");
    });
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "Cron worker failed." });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("email claims stay idempotent and order filters do not treat underscores as wildcards", async () => {
  const now = new Date("2026-10-23T17:00:00.000Z");
  const due = new Date("2026-10-23T16:00:00.000Z");
  const later = new Date("2026-10-23T18:00:00.000Z");
  assert.equal(emailJobIsClaimable({ status: "PENDING", availableAt: due, lockedUntil: null, attempts: 0 }, now), true);
  assert.equal(emailJobIsClaimable({ status: "PENDING", availableAt: later, lockedUntil: null, attempts: 0 }, now), false);
  assert.equal(emailJobIsClaimable({ status: "SENDING", availableAt: due, lockedUntil: later, attempts: 1 }, now), false);
  assert.equal(emailJobIsClaimable({ status: "SENDING", availableAt: due, lockedUntil: due, attempts: 1 }, now), true);
  assert.equal(emailJobIsClaimable({ status: "SENT", availableAt: due, lockedUntil: null, attempts: 1 }, now), false);
  assert.equal(emailJobIsClaimable({ status: "PENDING", availableAt: due, lockedUntil: null, attempts: 5 }, now), false);

  assert.equal(emailDedupeLike(":order_1"), "%:order\\_1");
  assert.equal(emailDedupeLike(""), "%");
  await assert.rejects(() => processEmailQueue({ dedupeSuffix: "order-1" }), /Invalid email filter/);
  await assert.rejects(() => processEmailQueue({ dedupeSuffix: ":%" }), /Invalid email filter/);
  assert.equal(await processOrderEmails("not an id"), 0);
  assert.equal(await processOrderEmails("../etc"), 0);

  const queue = readFileSync(new URL("../lib/email-queue.ts", import.meta.url), "utf8");
  assert.match(queue, /update:\s*\{\s*\}/);
  assert.match(queue, /FOR UPDATE SKIP LOCKED LIMIT 1/);
  assert.match(queue, /dedupeKey" LIKE \$\{like\} ESCAPE '\\\\'/);
});

test("bounded workers stop at an empty batch and never exceed the cap", async () => {
  let steps = 0;
  const capped = await runBounded(async () => {
    steps += 1;
    return 1;
  }, 3);
  assert.equal(capped, 3);
  assert.equal(steps, 3);

  let reads = 0;
  const stopped = await runBounded(async () => {
    reads += 1;
    return reads === 1 ? 2 : 0;
  }, 10);
  assert.equal(stopped, 2);
  assert.equal(reads, 2);
  assert.equal(await runBounded(async () => 1, 0), 0);
  assert.equal(await runBounded(async () => -1, 5), 0);
});

test("Hobby cron schedules are once per day and checkout sends only on Vercel", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };
  assert.deepEqual(config.crons, [
    { path: "/api/cron/payments-expire", schedule: "0 16 * * *" },
    { path: "/api/cron/email-worker", schedule: "0 17 * * *" }
  ]);
  for (const cron of config.crons) assert.match(cron.schedule, /^0 \d{1,2} \* \* \*$/);

  const checkout = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
  assert.match(checkout, /process\.env\.VERCEL/);
  assert.match(checkout, /after\(\(\) => processOrderEmails/);
  const emailScript = readFileSync(new URL("../scripts/email-worker.ts", import.meta.url), "utf8");
  const paymentScript = readFileSync(new URL("../scripts/payment-expiry.ts", import.meta.url), "utf8");
  assert.match(emailScript, /runEmailMaintenance\(\{ maxJobs: 1 \}\)/);
  assert.match(emailScript, /--once/);
  assert.match(paymentScript, /runPaymentExpiry\(\{ maxBatches: 1000 \}\)/);
});
