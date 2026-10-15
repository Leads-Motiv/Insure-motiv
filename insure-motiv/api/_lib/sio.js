"use strict";

const { clean } = require("./validate");
const { consentAwaitingSignoff } = require("./config");

const SIO_KEY_SOURCE_BY_PAGE = Object.freeze({
  index: "SI_API_KEY"
});

class SioMappingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SioMappingError";
    this.code = code;
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new SioMappingError(
      `missing_${field}`,
      `SIO requires ${field}.`
    );
  }
  return value;
}

/**
 * The consent gate.
 *
 * The final expense wording still carries an unresolved buyer slot and has
 * not been signed off. Delivering on it would put unapproved consent language
 * behind a live lead, which is exactly the thing the September SSDI complaint
 * showed you cannot defend after the fact. Quarantine instead, loudly.
 */
function consentTextForLead(lead, config) {
  const text = config.tcpaConsentTextByPage?.[lead.page];
  requiredString(text, "tcpa_consent_text");
  if (consentAwaitingSignoff(text)) {
    throw new SioMappingError(
      "consent_text_awaiting_signoff",
      "The final expense consent wording has not been signed off and still names no buyer."
    );
  }
  return text;
}

function mapSioLead(lead, config) {
  if (!Number.isFinite(lead.age) || lead.age <= 0) {
    throw new SioMappingError(
      "invalid_age",
      "A valid applicant age is required for SIO delivery."
    );
  }

  const meta = {
    landing_page_url: requiredString(lead.page_url, "landing_page_url"),
    originally_created: requiredString(lead.captured_at, "originally_created"),
    source_id: requiredString(lead.subID1 || config.sourceIdFallback, "source_id"),
    tcpa_consent_text: consentTextForLead(lead, config),
    trusted_form_cert_url: requiredString(lead.cert, "trusted_form_cert_url"),
    user_agent: requiredString(lead.user_agent, "user_agent")
  };

  return {
    data: {
      product_type: config.productType,
      applicant_age: lead.age,
      coverage_amount: requiredString(lead.coverage_amount, "coverage_amount")
    },
    meta,
    contact: {
      address: requiredString(lead.address1, "contact_address"),
      city: requiredString(lead.city, "contact_city"),
      date_of_birth: requiredString(lead.date_of_birth, "contact_date_of_birth"),
      email: requiredString(lead.email, "contact_email"),
      first_name: requiredString(lead.first_name, "contact_first_name"),
      ip_address: requiredString(lead.ip, "contact_ip_address"),
      last_name: requiredString(lead.last_name, "contact_last_name"),
      phone: requiredString(lead.phone_primary, "contact_phone"),
      state: requiredString(lead.state, "contact_state"),
      zip_code: requiredString(lead.postal_code, "contact_zip_code")
    }
  };
}

function deniedReason(errors) {
  if (typeof errors === "string") return clean(errors, 2000) || "sio_denied";
  if (errors === undefined || errors === null) return "sio_denied";
  try { return JSON.stringify(errors).slice(0, 2000); } catch { return "sio_denied"; }
}

function parseSioResponse(httpStatus, body) {
  if (httpStatus >= 500) {
    return { state: "QUARANTINE", accepted: false, reason: `sio_http_${httpStatus}` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      state: "BUYER_REJECTED",
      accepted: false,
      reason: httpStatus >= 200 && httpStatus < 300
        ? "invalid_sio_response"
        : `sio_http_${httpStatus}`
    };
  }
  if (httpStatus >= 200 && httpStatus < 300 && body.status === "success") {
    return {
      state: "BUYER_ACCEPTED",
      accepted: true,
      price: body.price,
      confirmation_id: body.confirmation_id,
      reason: "accepted"
    };
  }
  if (body.status === "denied") {
    return {
      state: "BUYER_REJECTED",
      accepted: false,
      reason: deniedReason(body.errors)
    };
  }
  return {
    state: "BUYER_REJECTED",
    accepted: false,
    reason: httpStatus >= 200 && httpStatus < 300
      ? "unexpected_sio_status"
      : `sio_http_${httpStatus}`
  };
}

async function deliverSio(lead, config, fetchImpl = fetch) {
  const page = lead?.page;
  const keySource = SIO_KEY_SOURCE_BY_PAGE[page];
  const routing = { page, credential_source: keySource || "unmapped" };

  if (!keySource) {
    return { state: "QUARANTINE", accepted: false, reason: "invalid_sio_page", ...routing };
  }
  const apiKey = String(config.apiKeysByPage?.[page] || "").trim();
  if (!apiKey) {
    // Expected until a final expense campaign exists. The lead is held, not
    // dropped: it is already in GoHighLevel and its evidence is stored.
    return { state: "QUARANTINE", accepted: false, reason: `missing_sio_api_key_${page}`, ...routing };
  }
  if (!config.postUrl) {
    return { state: "QUARANTINE", accepted: false, reason: "sio_unconfigured", ...routing };
  }
  let url;
  try { url = new URL(config.postUrl); } catch { /* handled below */ }
  if (!url || url.protocol !== "https:") {
    return { state: "QUARANTINE", accepted: false, reason: "invalid_sio_url", ...routing };
  }

  let payload;
  try {
    payload = mapSioLead(lead, config);
  } catch (error) {
    return {
      state: "QUARANTINE",
      accepted: false,
      reason: error instanceof SioMappingError ? error.code : "sio_mapping_failed",
      ...routing
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.postUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": "InsureMotiv-SIO-Router/1.0"
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    return { ...parseSioResponse(response.status, body), ...routing };
  } catch (error) {
    return {
      state: "QUARANTINE",
      accepted: false,
      reason: error?.name === "AbortError" ? "sio_timeout" : "sio_unreachable",
      ...routing
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SIO_KEY_SOURCE_BY_PAGE,
  SioMappingError,
  consentTextForLead,
  deliverSio,
  mapSioLead,
  parseSioResponse,
  requiredString
};
