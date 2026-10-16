"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../api/lead");
const { scheduleLeadRejection } = require("../api/_lib/lead-rejection");
const { request, responseRecorder, validLead } = require("./helpers");
const env = { VERCEL_ENV: "production", SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only" };
const logger = { log() {}, warn() {}, error() {} };
const leadId = "11111111-1111-4111-8111-111111111111";

for (const [name, overrides, expected, stage, status] of [
  ["validation", { email: "bad-contact" }, "validation_failed", "validation", 422],
  ["honeypot", { im_verify_token: "bot@example.test" }, "honeypot_triggered", "validation", 400],
  ["trustedform", { cert: "https://not-trustedform.example.test/cert" }, "trustedform_invalid", "trustedform", 422],
  ["dedup", {}, "duplicate", "dedup", 200]
]) {
  test(`${name}: response is sent before private, source-attributed background capture`, async () => {
    const res = responseRecorder(); const writes = []; const pending = [];
    let release;
    const handler = createHandler({ env, logger,
      idempotency: { enabled: false, claim: async () => ({ status: "DUPLICATE", leadId }) },
      fetchImpl: async (url, options) => {
        assert.ok(res.body, "response must be sent before capture starts");
        assert.match(url, /fact_lead_rejection$/); // Never SIO, GHL or TrustedForm.
        writes.push(JSON.parse(options.body));
        await new Promise(resolve => { release = resolve; });
        return { ok: true };
      }, waitUntilImpl: promise => pending.push(promise)
    });
    await handler(request(validLead({ lead_id: leadId, utm_source: "fe_fmg", landing_page_url: "https://site.test/?email=marie@example.com#phone", ...overrides })), res);
    assert.equal(res.statusCode, status); assert.equal(writes.length, 1);
    const row = writes[0]; assert.equal(row.reason_code, expected); assert.equal(row.stage, stage);
    assert.equal(row.source_tag, "fe_fmg"); assert.equal(row.property, "insure-motiv");
    assert.equal(row.lead_id, leadId); assert.equal(row.zip, "87002"); assert.equal(row.state, "NM");
    assert.equal(row.landing_page_url, "https://site.test/");
    assert.doesNotMatch(JSON.stringify(row), /marie@example|Alvarez|5055550142|bot@example|bad-contact/);
    release(); await Promise.all(pending);
  });
}

test("an unparseable request is still recorded, with the fallback source and no contact fields", async () => {
  const writes = [], pending = [];
  const res = responseRecorder();
  await createHandler({ env, logger, waitUntilImpl: p => pending.push(p),
    fetchImpl: async (_url, o) => { writes.push(JSON.parse(o.body)); return { ok: true }; } })(request("{"), res);
  await Promise.all(pending);
  assert.equal(res.statusCode, 400); assert.equal(writes.length, 1);
  assert.equal(writes[0].reason_code, "invalid_json"); assert.equal(writes[0].source_tag, "Motiv");
  assert.equal(writes[0].zip, null); assert.equal(writes[0].state, null);
});

test("capture HTTP, timeout, scheduler and logger failures never reject", async () => {
  for (const failure of ["http", "timeout", "schedule"]) {
    const pending=[];
    assert.doesNotThrow(() => scheduleLeadRejection({ property:"insure-motiv", leadId, reasonCode:"validation_failed", stage:"validation", env,
      logger:{log(){throw new Error("logger failure");}},
      fetchImpl:async (_url,options)=>{assert.ok(options.signal);if(failure==='timeout')throw new DOMException('timeout','TimeoutError');return {ok:false,status:503};},
      waitUntilImpl:p=>{pending.push(p);if(failure==='schedule')throw new Error('schedule failed');}
    }));
    await assert.doesNotReject(Promise.all(pending));
  }
});

test("preview and missing configuration do not write", () => {
  for (const settings of [{...env,VERCEL_ENV:"preview"},{VERCEL_ENV:"production"}]) {
    scheduleLeadRejection({env:settings,logger,fetchImpl:()=>assert.fail("must not fetch"),waitUntilImpl:()=>assert.fail("must not schedule")});
  }
});

test("cached rejection replay does not add another fact", async () => {
  const res=responseRecorder();
  await createHandler({env,logger,idempotency:{enabled:true,resultForLeadId:async()=>({http_status:422,body:{code:'validation_failed'}})},fetchImpl:()=>assert.fail('no network'),waitUntilImpl:()=>assert.fail('no duplicate capture')})(request(validLead({lead_id:leadId})),res);
  assert.equal(res.statusCode,422);assert.equal(JSON.parse(res.body).idempotent_replay,true);
});
