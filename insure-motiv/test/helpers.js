"use strict";

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = String(value || ""); }
  };
}

function request(body, overrides = {}) {
  return {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      host: "staging.example.test",
      origin: "https://staging.example.test",
      "x-forwarded-for": "203.0.113.9",
      "user-agent": "pipeline-test",
      ...(overrides.headers || {})
    },
    socket: {},
    ...overrides
  };
}

/** Fixed clock so the age assertions do not drift with the calendar. */
const NOW = new Date("2026-10-15T12:00:00.000Z");

function validLead(overrides = {}) {
  return {
    submission_id: "submission-123",
    idempotency_key: "idempotency-123",
    page_name: "final_expense_landing",
    page_version: "IM-FE-V2.0.0",
    first_name: "Marie",
    last_name: "Alvarez",
    address1: "44 Camino Real",
    city: "Belen",
    state: "NM",
    postal_code: "87002",
    email: "marie@example.com",
    phone_primary: "5055550142",
    date_of_birth: "1958-03-20",
    coverage_amount: "10000",
    cert: "https://cert.trustedform.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    consent_checkbox_checked: true,
    company_website: "",
    landing_page_url: "https://staging.example.test/",
    referrer: "https://search.example.test/",
    ...overrides
  };
}

module.exports = { NOW, request, responseRecorder, validLead };
