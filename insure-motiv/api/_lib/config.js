"use strict";

/**
 * Final expense consent wording.
 *
 * This is NOT Champion's wording and must not be replaced with it. Champion's
 * text consents to "calls and text messages", does not name the buyer, and is
 * written for home improvement. The final expense purchase order is calls
 * only, and the buyer has to be named.
 *
 * The buyer is not decided yet, so the one unresolved value is marked with
 * CONSENT_SIGNOFF_MARKER below. While that marker is present the pipeline
 * refuses to deliver (see sio.js), so no lead can reach a buyer on wording
 * that has not been signed off. Replace it in BOTH places - here and the
 * rendered checkbox in index.html - and test/sio.test.js enforces that the
 * two stay byte-identical.
 */
const CONSENT_SIGNOFF_MARKER = "[BUYER LEGAL NAME]";

const FE_CONSENT_DRAFT =
  "By checking this box and clicking “Get My Free Quote,” I provide my " +
  "electronic signature and consent to receive telephone calls, including " +
  "calls made using automated dialing technology, an artificial voice, or a " +
  "prerecorded message, from Insure Motiv, a DBA of Motiv Brands Group, LLC, " +
  "and from [BUYER LEGAL NAME], regarding final expense life insurance, at " +
  "the telephone number I provided. I understand these calls may be placed " +
  "even if my number appears on a Do Not Call registry, and that consent is " +
  "not required as a condition of purchase. I agree to the Terms of Use and " +
  "acknowledge the Privacy Policy.";

const FIXED_SIO = Object.freeze({
  sourceIdFallback: "Motiv",
  productType: "Final expense life insurance",
  consentSignoffMarker: CONSENT_SIGNOFF_MARKER,
  // One public page, so one key. Window Motiv needed a second entry for its
  // partner page; there is no equivalent here.
  tcpaConsentTextByPage: Object.freeze({
    index: FE_CONSENT_DRAFT
  })
});

/** True while the wording still carries the unresolved buyer slot. */
function consentAwaitingSignoff(text) {
  return String(text || "").includes(CONSENT_SIGNOFF_MARKER);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function getConfig(env = process.env) {
  return {
    sio: {
      ...FIXED_SIO,
      postUrl: String(env.SI_POST_URL || "").trim(),
      apiKeysByPage: {
        index: String(env.SI_API_KEY || "").trim()
      },
      timeoutMs: boundedInteger(env.SI_TIMEOUT_MS, 12000, 1000, 30000)
    },
    trustedForm: {
      apiKey: String(env.TRUSTEDFORM_API_KEY || "").trim(),
      timeoutMs: boundedInteger(env.TRUSTEDFORM_TIMEOUT_MS, 12000, 1000, 30000)
    },
    ghl: {
      webhookUrl: String(env.GHL_WEBHOOK_URL || "").trim(),
      timeoutMs: boundedInteger(env.GHL_TIMEOUT_MS, 12000, 1000, 30000)
    },
    redis: {
      url: String(env.KV_REST_API_URL || "").trim().replace(/\/$/, ""),
      token: String(env.KV_REST_API_TOKEN || "").trim()
    },
    dedupLookbackDays: boundedInteger(env.DEDUP_LOOKBACK_DAYS, 30, 1, 365),
    allowedOrigins: csv(env.LEAD_ALLOWED_ORIGINS)
    // No zipAllowlistPath. Window Motiv gated on Champion's 9,225 covered
    // ZIPs; there is no final expense coverage list because there is no
    // final expense buyer yet. Add one here when there is.
  };
}

module.exports = {
  FIXED_SIO,
  CONSENT_SIGNOFF_MARKER,
  consentAwaitingSignoff,
  getConfig
};
