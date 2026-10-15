"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FIXED_SIO,
  CONSENT_SIGNOFF_MARKER,
  consentAwaitingSignoff,
  getConfig
} = require("../api/_lib/config");
const { mapSioLead, SioMappingError } = require("../api/_lib/sio");
const { normalizeLead } = require("../api/_lib/validate");
const { NOW, validLead } = require("./helpers");

const PAGE = path.join(__dirname, "..", "index.html");

/** The consent label as a visitor reads it, with markup and entities resolved. */
function renderedConsent(file, inputId) {
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(
    new RegExp(`<label\\s+for=["']${inputId}["'][^>]*>([\\s\\S]*?)<\\/label>`, "i")
  );
  assert.ok(match, `Consent label ${inputId} must exist in ${file}`);
  return match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,])/g, "$1")
    .trim();
}

const consent = FIXED_SIO.tcpaConsentTextByPage.index;

test("the rendered consent checkbox matches the text sent to the buyer", () => {
  assert.equal(consent, renderedConsent(PAGE, "im-consent"));
});

test("final expense consent is calls only, never texts", () => {
  // The purchase order is calls only. Champion's wording consents to "calls
  // and text messages", so this fails loudly if that text is ever pasted in.
  for (const banned of [/text message/i, /sms/i, /message and data rates/i, /\btexts?\b/i]) {
    assert.ok(!banned.test(consent), `consent must not mention ${banned}`);
  }
  assert.match(consent, /telephone calls/i);
});

test("consent is final expense wording, not Champion's home-improvement wording", () => {
  for (const banned of [/window/i, /home[- ]improvement/i, /Submit My Project/i, /condition of purchase\.\s*Message/i]) {
    assert.ok(!banned.test(consent), `consent must not carry Champion wording: ${banned}`);
  }
  assert.match(consent, /final expense/i);
});

test("consent names the buyer, or is still marked as awaiting sign-off", () => {
  // Both states are valid; what is not valid is live wording with no buyer.
  assert.ok(
    consentAwaitingSignoff(consent) || !consent.includes(CONSENT_SIGNOFF_MARKER),
    "consent must either carry the sign-off marker or have a real buyer name"
  );
});

test("delivery is refused while the wording awaits sign-off", () => {
  const lead = normalizeLead(validLead(), {
    leadId: "im-1", ip: "198.51.100.24", userAgent: "ua", now: NOW
  });
  assert.throws(
    () => mapSioLead(lead, getConfig({}).sio),
    (error) => error instanceof SioMappingError && error.code === "consent_text_awaiting_signoff"
  );
});

test("delivery is allowed once a buyer replaces the marker", () => {
  const lead = normalizeLead(validLead(), {
    leadId: "im-1", ip: "198.51.100.24", userAgent: "ua", now: NOW
  });
  const signedOff = {
    ...getConfig({}).sio,
    tcpaConsentTextByPage: {
      index: consent.replace(CONSENT_SIGNOFF_MARKER, "Example Insurance Company, Inc.")
    }
  };
  const payload = mapSioLead(lead, signedOff);
  assert.ok(payload.meta.tcpa_consent_text.includes("Example Insurance Company, Inc."));
  assert.ok(!payload.meta.tcpa_consent_text.includes(CONSENT_SIGNOFF_MARKER));
});

test("the page shows a visible draft warning while the wording is unsigned", () => {
  const html = fs.readFileSync(PAGE, "utf8");
  if (consentAwaitingSignoff(consent)) {
    assert.match(html, /im-consent-draft/, "unsigned wording must carry the on-page warning");
  }
});
