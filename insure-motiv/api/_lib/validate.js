"use strict";

const net = require("node:net");

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);

/**
 * The field set is the buyer's, taken from the GoHighLevel form this page
 * used to embed: first_name, last_name, phone, email, state, postal_code and
 * a consent box. Nothing else.
 *
 * An earlier version of this file also collected date of birth, coverage
 * amount, street address and city, and gated on an assumed 50-85 age band.
 * None of that is requested by the buyer. Final expense is a calls-only
 * product - the agent qualifies age, cover and health on the phone - so
 * asking for them on a form that promises "under a minute" was friction that
 * bought nothing, and the age gate would have silently rejected leads the
 * buyer would have accepted.
 */
class PipelineError extends Error {
  constructor(status, code, message, state, fields = []) {
    super(message);
    this.name = "PipelineError";
    this.status = status;
    this.code = code;
    this.state = state;
    this.fields = fields;
  }
}

function clean(value, maximum = 500) {
  return String(value ?? "")
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhone(value) {
  const valueDigits = digits(value);
  return valueDigits.length === 11 && valueDigits.startsWith("1")
    ? valueDigits.slice(1)
    : valueDigits;
}

function getSourceBody(body) {
  const source = body?.normalized_lead && typeof body.normalized_lead === "object"
    ? body.normalized_lead
    : body;
  if (!source || Array.isArray(source) || typeof source !== "object") {
    throw new PipelineError(400, "invalid_body", "A JSON lead payload is required.", "INVALID");
  }
  return source;
}

function normalizePage() {
  // One public page. Kept as a field so the SIO credential lookup and the
  // consent-text lookup keep the same shape as the rest of the estate.
  return "index";
}

function normalizeLead(body, context) {
  const source = getSourceBody(body);
  const consentChecked =
    source.consent_checkbox_checked === true ||
    source.consent_given === true ||
    source.consent === true ||
    source.consent === "yes";

  return {
    lead_id: context.leadId,
    client_submission_id: clean(source.submission_id, 100),
    client_idempotency_key: clean(source.idempotency_key, 100),
    page: normalizePage(),
    page_name: clean(source.page_name, 100),
    form_version: clean(source.page_version, 40),
    first_name: clean(source.first_name, 45),
    last_name: clean(source.last_name, 45),
    state: clean(source.state, 2).toUpperCase(),
    postal_code: digits(source.postal_code).slice(0, 5),
    email: clean(source.email, 100).toLowerCase(),
    phone_primary: normalizePhone(source.phone_primary),
    cert: clean(source.cert || source.Cert || source.trustedform_cert_url, 1000),
    consent_checkbox_checked: consentChecked,
    company_website: clean(source.company_website, 200),
    subID1: clean(source.subID1 || source.utm_source, 180),
    subID2: clean(source.subID2 || source.utm_campaign, 180),
    subID3: clean(source.subID3 || source.utm_content, 180),
    page_url: clean(source.landing_page_url, 1000),
    referring_url: clean(source.referrer, 1000),
    ip: context.ip,
    user_agent: clean(context.userAgent, 1000),
    captured_at: context.now.toISOString()
  };
}

function validateTrustedFormUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "cert.trustedform.com";
  } catch {
    return false;
  }
}

function validateLead(lead) {
  if (lead.company_website) {
    throw new PipelineError(400, "honeypot_triggered", "The request could not be verified.", "INVALID");
  }

  const invalid = [];
  const required = ["first_name", "last_name", "state", "postal_code", "email", "phone_primary"];
  for (const field of required) if (!lead[field]) invalid.push(field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) invalid.push("email");
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(lead.phone_primary)) invalid.push("phone_primary");
  if (!US_STATES.has(lead.state)) invalid.push("state");
  if (!/^\d{5}$/.test(lead.postal_code)) invalid.push("postal_code");
  if (!net.isIPv4(lead.ip)) invalid.push("ip");
  if (!lead.consent_checkbox_checked) invalid.push("consent");

  if (invalid.length) {
    throw new PipelineError(
      422,
      "validation_failed",
      "The lead payload is incomplete or invalid.",
      "INVALID",
      [...new Set(invalid)]
    );
  }

  // The consent certificate is the whole point of the native form. SSDI's SIO
  // campaign requires one, and a September consent complaint was only
  // defensible because the certificate and its session replay existed.
  if (!lead.cert) {
    throw new PipelineError(422, "trustedform_missing", "A consent certificate is required.", "TF_MISSING", ["cert"]);
  }
  if (!validateTrustedFormUrl(lead.cert)) {
    throw new PipelineError(422, "trustedform_invalid", "The consent certificate is invalid.", "TF_VERIFY_FAILED", ["cert"]);
  }
}

function cleanIpv4(values) {
  for (const value of values) {
    for (const candidate of String(value || "").split(",")) {
      const cleaned = candidate.trim().replace(/^::ffff:/i, "");
      if (net.isIPv4(cleaned)) return cleaned;
    }
  }
  return "";
}

module.exports = {
  PipelineError,
  US_STATES,
  clean,
  cleanIpv4,
  normalizeLead,
  normalizePhone,
  validateLead,
  validateTrustedFormUrl
};
