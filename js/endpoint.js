/**
 * Thin client for the Apps Script endpoint (apps-script/logging-endpoint.gs).
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

  return { enabled, archiveSheet, appendLogRows, lookupOrder, getPackingPdf, uploadDoc, getDoc, DOC_TIMEOUT_MS };
})();
