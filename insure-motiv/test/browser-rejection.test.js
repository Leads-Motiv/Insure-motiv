"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHandler } = require("../api/rejection");
const { normalizeLead, validateLead } = require("../api/_lib/validate");
const { request, responseRecorder, validLead } = require("./helpers");
const env = { VERCEL_ENV: "production", SUPABASE_URL: "https://database.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only" };
const body = { reason_codes: ["honeypot_filled", "submitted_too_fast", "insufficient_interaction"], page: "index", source_tag: "fe_fmg", lead_id: "11111111-1111-4111-8111-111111111111" };
const logger = { log() {} };

test("every trigger is recorded once with one attempt ID, fixed detail and no contact payload", async () => {
  const writes = [], pending = [];
  const handler = createHandler({ env, logger, waitUntilImpl: p => pending.push(p), fetchImpl: async (url, options) => {
    assert.match(url, /\/rest\/v1\/fact_lead_rejection$/); // No lead/provider calls.
    writes.push(JSON.parse(options.body)); return { ok: true };
  }});
  const res = responseRecorder();
  await handler(request({ ...body, first_name: "PrivateName", email: "private@example.com", phone: "5055550142", im_verify_token: "private honeypot", reason_detail: "private detail", landing_page_url: "https://site.test/?email=private@example.com", property: "injected" }), res);
  await Promise.all(pending);
  assert.equal(res.statusCode, 202); assert.equal(writes.length, 3);
  for (const row of writes) {
    assert.equal(row.lead_id, body.lead_id); assert.equal(row.source_tag, body.source_tag);
    assert.equal(row.stage, "client_guard"); assert.equal(row.property, "insure-motiv");
    assert.equal(row.landing_page_url, "https://staging.example.test/");
    assert.equal(row.zip, null); assert.equal(row.state, null);
    assert.doesNotMatch(JSON.stringify(row), /private|PrivateName|5055550142|injected/);
  }
});

test("duplicate codes are deduplicated and unsafe source tags are discarded", async () => {
  for (const source_tag of ["someone@example.com", "5055550142", "A Person", "https://site.test/?email=x"]) {
    const writes=[],pending=[]; const res=responseRecorder();
    await createHandler({env,logger,waitUntilImpl:p=>pending.push(p),fetchImpl:async (_url,o)=>{writes.push(JSON.parse(o.body));return {ok:true};}})(request({...body,source_tag,reason_codes:["honeypot_filled","honeypot_filled"]}),res);
    await Promise.all(pending);assert.equal(writes.length,1);assert.equal(writes[0].source_tag,null);
  }
});

test("transport and payload guards never schedule writes", async () => {
  const cases=[
    [request(body,{method:"GET"}),405],
    [request(body,{headers:{origin:"https://other.test",host:"staging.example.test","content-type":"application/json"}}),403],
    [request(body,{headers:{host:"staging.example.test","content-type":"application/json"}}),403],
    [request(body,{headers:{origin:"https://staging.example.test",host:"staging.example.test","content-type":"text/plain"}}),415],
    [request({...body,reason_codes:["__proto__"]}),400],
    [request({...body,reason_codes:[]}),400],
    [request({...body,page:"partner"}),400],
    [request({...body,page:"../private"}),400],
    [request({...body,guard_mode:"anything"}),400],
    [request("{"),400],
    [request({...body,extra:"x".repeat(2048)}),413]
  ];
  for(const [req,status] of cases){const res=responseRecorder();await createHandler({env,logger,fetchImpl:()=>assert.fail("no write"),waitUntilImpl:()=>assert.fail("no schedule")})(req,res);assert.equal(res.statusCode,status);}
});

test("preview produces no writes and capture failures do not fail the endpoint", async () => {
  const pending=[];
  for(const settings of [env,{...env,VERCEL_ENV:"preview"}]){
    const res=responseRecorder();await createHandler({env:settings,logger,waitUntilImpl:p=>pending.push(p),fetchImpl:async()=>{if(settings.VERCEL_ENV==="preview")assert.fail("preview write");throw new Error("offline");}})(request(body),res);
    assert.equal(res.statusCode,202);
  }
  await assert.doesNotReject(Promise.all(pending));
});

test("log-only observations have distinct codes; old tabs and enforce mode keep blocked codes", async()=>{
  for(const mode of ['log-only','enforce',undefined]){
    const writes=[],pending=[];const res=responseRecorder();
    await createHandler({env,logger,waitUntilImpl:p=>pending.push(p),fetchImpl:async(_url,o)=>{writes.push(JSON.parse(o.body));return {ok:true};}})(request({...body,guard_mode:mode}),res);
    await Promise.all(pending);
    assert.equal(res.statusCode,202);
    assert.deepEqual(writes.map(r=>r.reason_code),body.reason_codes.map(c=>mode==='log-only'?c+'_observed':c));
    assert.ok(writes.every(r=>r.stage==='client_guard'));
    if(mode==='log-only')assert.ok(writes.every(r=>r.reason_detail.startsWith('Observed only;')));
  }
});

test("the server still rejects a populated honeypot posted directly", () => {
  const lead = normalizeLead(validLead({ im_verify_token: "bot" }), { leadId: body.lead_id, now: new Date(), ip: "203.0.113.1", userAgent: "test" });
  assert.throws(() => validateLead(lead), e => e.code === "honeypot_triggered");
});

test("the shipped policy is log-only and the form loads it before the form script", () => {
  const root = path.join(__dirname, "..");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "browser-guard-policy.js"), "utf8"), sandbox);
  assert.equal(sandbox.window.InsureMotivBrowserGuards.mode, "log-only");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const policyAt = html.indexOf('<script src="/browser-guard-policy.js"></script>');
  assert.ok(policyAt > -1 && policyAt < html.indexOf('<script id="im-quote-form-js">'));
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.headers.some(h => h.source === "/browser-guard-policy.js" &&
    h.headers.some(x => x.key === "Cache-Control" && x.value === "no-store")));
});
