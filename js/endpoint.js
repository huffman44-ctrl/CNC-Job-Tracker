/**
 * Thin client for the Apps Script endpoint (apps-script/logging-endpoint.gs): archive on upload, append (legacy) / upsert (Phase 1) log rows on export, order lookup, packing PDFs, print-queue documents, and logWriteOutcome — the one rule for whether a Master Job Log write worked.
 * Content-Type must stay text/plain — anything else triggers a CORS
 * preflight that Apps Script web apps cannot answer.
 */
const Endpoint = (() => {
  function enabled() {
    return typeof ENDPOINT_CONFIG !== 'undefined'
      && ENDPOINT_CONFIG.url
      && !ENDPOINT_CONFIG.url.startsWith('PASTE');
  }

  const DEFAULT_TIMEOUT_MS = 20000;
  // 10 MB of base64 each way over shop wifi does not fit in 20 s.
  const DOC_TIMEOUT_MS = 120000;

  async function post(payload, opts = {}) {
    const res = await fetch(ENDPOINT_CONFIG.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: ENDPOINT_CONFIG.token, ...payload }),
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs || DEFAULT_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data.ok) {
      // The server answered — its message is the real reason, and callers
      // (exportJob's alert) distinguish this from a network failure.
      const err = new Error(data.error || 'endpoint error');
      err.endpointError = true;
      throw err;
    }
    return data;
  }

  async function archiveSheet(fileName, jobName, html) {
    if (!enabled()) return null;
    const data = await post({ action: 'archive', fileName, jobName, html });
    return data.url || null;
  }

  async function appendLogRows(rows) {
    if (!enabled()) return true;
    await post({ action: 'appendRows', rows });
    return true;
  }

  // Master Job Log, ONE object per sheet, upserted by Sheet Key (spec §6.2) — exporting the
  // same job twice updates the same rows. Carries the Firebase ID token: the script verifies
  // it before writing (closes the 2026-08-18 gap for the log write path). Billing columns
  // (invoice/po/billed) are accepted by the script only from an owner uid.
  async function upsertLogRows(rows, idToken) {
    if (!enabled()) return { ok: true, updated: 0, appended: 0, claimed: 0, offline: true };
    return post({ action: 'upsertRows', rows, idToken }, { timeoutMs: 60000 });
  }

  // The ONE rule for "did a Master Job Log write work?" — Export and Billing both read it
  // (spec .scratch/shared-log-write-rule/spec.md). Judges a reply that came back; thrown errors
  // stay with the callers. Written only on a clear ok. An offline reply (endpoint not configured)
  // counts as written only with a clear ok and no database (PASTE test mode); any other offline
  // reply carries the not-set-up reason. Callers wrap `reason` in their own sentence.
  const LOG_OFFLINE_REASON = "Master Job Log connection isn't set up on this computer";
  function logWriteOutcome(reply, hasDatabase) {
    if (reply && reply.offline) {
      return (reply.ok && !hasDatabase)
        ? { written: true, offline: false, reason: null }
        : { written: false, offline: true, reason: LOG_OFFLINE_REASON };
    }
    if (!(reply && reply.ok)) return { written: false, offline: false, reason: (reply && (reply.error || reply.message)) || null };
    return { written: true, offline: false, reason: null };
  }

  async function lookupOrder(orderNum, idToken) {
    if (!enabled()) return null;
    const data = await post({ action: 'lookupOrder', orderNum, idToken });
    return data.order;
  }

  async function getPackingPdf(fileName, idToken) {
    if (!enabled()) return null;
    const data = await post({ action: 'getPackingPdf', fileName, idToken });
    return data.pdfBase64;
  }

  // Print-queue documents. Both actions carry the Firebase ID token; the
  // Apps Script verifies it before touching Drive.
  async function uploadDoc(fileName, base64, idToken) {
    if (!enabled()) return null;
    const data = await post({ action: 'uploadDoc', fileName, base64, idToken }, { timeoutMs: DOC_TIMEOUT_MS });
    return data.fileId;
  }

  async function getDoc(fileId, idToken) {
    if (!enabled()) return null;
    const data = await post({ action: 'getDoc', fileId, idToken }, { timeoutMs: DOC_TIMEOUT_MS });
    return data.pdfBase64;
  }

  return { enabled, archiveSheet, appendLogRows, upsertLogRows, logWriteOutcome, lookupOrder, getPackingPdf, uploadDoc, getDoc, DOC_TIMEOUT_MS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Endpoint;
