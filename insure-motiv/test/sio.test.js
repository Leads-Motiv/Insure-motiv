"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { CONSENT_SIGNOFF_MARKER, getConfig } = require("../api/_lib/config");
const { deliverSio, mapSioLead, parseSioResponse } = require("../api/_lib/sio");
const { normalizeLead } = require("../api/_lib/validate");
const { NOW, validLead } = require("./helpers");

/** Config as it will look once legal has signed the wording off. */
function signedOffConfig(overrides = {}) {
  const sio = getConfig({ SI_POST_URL: "https://exchange.example.test/post", SI_API_KEY: "key-index" }).sio;
  return {
    ...sio,
    tcpaConsentTextByPage: {
      index: sio.tcpaConsentTextByPage.index.replace(CONSENT_SIGNOFF_MARKER, "Example Insurance Company, Inc.")
    },
    ...overrides
  };
}

const lead = (overrides) => normalizeLead(validLead(overrides), {
  leadId: "im-1", ip: "198.51.100.24", userAgent: "consumer-agent", now: NOW
});

test("the SIO payload carries the final expense shape", () => {
  const config = signedOffConfig();
  const payload = mapSioLead(lead(), config);

  assert.deepEqual(payload.data, {
    product_type: "Final expense life insurance",
    applicant_age: 68,
    coverage_amount: "10000"
  });
  assert.deepEqual(payload.contact, {
    address: "44 Camino Real",
    city: "Belen",
    date_of_birth: "1958-03-20",
    email: "marie@example.com",
    first_name: "Marie",
    ip_address: "198.51.100.24",
    last_name: "Alvarez",
    phone: "5055550142",
    state: "NM",
    zip_code: "87002"
  });
  assert.equal(payload.meta.trusted_form_cert_url, validLead().cert);
  assert.equal(payload.meta.source_id, "Motiv");
  assert.equal(payload.meta.user_agent, "consumer-agent");
});

test("source_id prefers the campaign's own subID over the fallback", () => {
  const payload = mapSioLead(lead({ utm_source: "paid-social" }), signedOffConfig());
  assert.equal(payload.meta.source_id, "paid-social");
});

test("no window or home-improvement field survives the port", () => {
  const payload = mapSioLead(lead(), signedOffConfig());
  const serialised = JSON.stringify(payload);
  for (const banned of ["window", "homeowner", "project_intent", "own_property"]) {
    assert.ok(!serialised.includes(banned), `payload must not carry ${banned}`);
  }
});

test("a missing API key quarantines before any request is attempted", async () => {
  let called = false;
  const result = await deliverSio(
    lead(),
    signedOffConfig({ apiKeysByPage: { index: "" } }),
    async () => { called = true; return { status: 200, json: async () => ({}) }; }
  );
  assert.equal(result.state, "QUARANTINE");
  assert.equal(result.reason, "missing_sio_api_key_index");
  assert.equal(result.credential_source, "SI_API_KEY");
  assert.equal(called, false, "no lead may be sent without a credential");
});

test("unsigned consent quarantines before any request is attempted", async () => {
  let called = false;
  const unsigned = getConfig({ SI_POST_URL: "https://exchange.example.test/post", SI_API_KEY: "key" }).sio;
  const result = await deliverSio(lead(), unsigned, async () => {
    called = true; return { status: 200, json: async () => ({}) };
  });
  assert.equal(result.state, "QUARANTINE");
  assert.equal(result.reason, "consent_text_awaiting_signoff");
  assert.equal(called, false, "no lead may be sent on unapproved wording");
});

test("SIO responses map to documented states only", () => {
  assert.equal(parseSioResponse(200, { status: "success", price: 12 }).state, "BUYER_ACCEPTED");
  assert.equal(parseSioResponse(200, { status: "denied", errors: "bad zip" }).state, "BUYER_REJECTED");
  assert.equal(parseSioResponse(200, { status: "unknown" }).state, "BUYER_REJECTED");
  assert.equal(parseSioResponse(503, null).state, "QUARANTINE");
  assert.equal(parseSioResponse(200, null).reason, "invalid_sio_response");
});
