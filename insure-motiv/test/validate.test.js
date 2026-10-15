"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MIN_AGE,
  MAX_AGE,
  PipelineError,
  ageFromDateOfBirth,
  normalizeCoverageAmount,
  normalizeLead,
  normalizePhone,
  parseDateOfBirth,
  validateLead
} = require("../api/_lib/validate");
const { NOW, validLead } = require("./helpers");

const context = { leadId: "im-1", ip: "198.51.100.24", userAgent: "ua", now: NOW };
const lead = (overrides) => normalizeLead(validLead(overrides), context);

function rejects(overrides, code) {
  assert.throws(
    () => validateLead(lead(overrides)),
    (error) => error instanceof PipelineError && error.code === code,
    `expected ${code} for ${JSON.stringify(overrides)}`
  );
}

test("a complete final expense lead validates", () => {
  const value = lead();
  validateLead(value);
  assert.equal(value.age, 68);
  assert.equal(value.coverage_amount, "10000");
  assert.equal(value.page, "index");
});

test("age is whole years, and the boundary days are exact", () => {
  // Turns 50 on 2026-10-15: eligible on the day, not the day before.
  assert.equal(ageFromDateOfBirth("1976-10-15", NOW), 50);
  assert.equal(ageFromDateOfBirth("1976-10-16", NOW), 49);
  assert.equal(ageFromDateOfBirth("1941-10-15", NOW), 85);
  assert.equal(ageFromDateOfBirth("1941-10-16", NOW), 84);
});

test("date of birth is accepted only as YYYY-MM-DD, and must be a real date", () => {
  assert.ok(parseDateOfBirth("1958-03-20"));
  assert.equal(parseDateOfBirth("1958-02-30"), null, "30 February is not a date");
  assert.equal(parseDateOfBirth("03/20/1958"), null);
  assert.equal(parseDateOfBirth(""), null);
});

test("the age band is enforced at both ends", () => {
  rejects({ date_of_birth: "1976-10-16" }, "age_not_eligible"); // 49
  rejects({ date_of_birth: "1940-10-15" }, "age_not_eligible"); // 86
  validateLead(lead({ date_of_birth: "1976-10-15" })); // exactly MIN_AGE
  validateLead(lead({ date_of_birth: "1941-10-15" })); // exactly MAX_AGE
  assert.equal(MIN_AGE, 50);
  assert.equal(MAX_AGE, 85);
});

test("an unusable date of birth is reported as such, not as ineligible age", () => {
  // A present-but-unparseable value must not be reported as "you are too
  // young" - the visitor would have no idea what to correct.
  rejects({ date_of_birth: "not-a-date" }, "date_of_birth_invalid");
  rejects({ date_of_birth: "" }, "validation_failed");
});

test("coverage amount accepts only the published bands", () => {
  assert.equal(normalizeCoverageAmount("10000"), "10000");
  assert.equal(normalizeCoverageAmount("$10,000"), "10000");
  assert.equal(normalizeCoverageAmount("25000+"), "25000+");
  assert.equal(normalizeCoverageAmount("7500"), "");
  rejects({ coverage_amount: "7500" }, "validation_failed");
});

test("a consent certificate is required and must be a TrustedForm URL", () => {
  rejects({ cert: "" }, "trustedform_missing");
  rejects({ cert: "https://example.com/cert/abc" }, "trustedform_invalid");
  rejects({ cert: "http://cert.trustedform.com/abc" }, "trustedform_invalid");
});

test("the honeypot and the consent checkbox both hard-stop the lead", () => {
  rejects({ company_website: "spam" }, "honeypot_triggered");
  rejects({ consent_checkbox_checked: false }, "validation_failed");
});

test("contact details are normalised rather than trusted as sent", () => {
  const value = lead({
    phone_primary: "1 (505) 555-0142",
    email: "  MARIE@Example.COM ",
    state: "nm",
    postal_code: "87002-1234"
  });
  assert.equal(value.phone_primary, "5055550142");
  assert.equal(value.email, "marie@example.com");
  assert.equal(value.state, "NM");
  assert.equal(value.postal_code, "87002");
  assert.equal(normalizePhone("+1 505 555 0142"), "5055550142");
});

test("an invalid phone or state is rejected", () => {
  rejects({ phone_primary: "1234567890" }, "validation_failed");
  rejects({ state: "ZZ" }, "validation_failed");
});
