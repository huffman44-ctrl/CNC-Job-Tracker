/**
 * Apps Script web app endpoint (archive + Master Job Log append).
 * PASTE convention (same as firebase-config.js): while url starts with
 * 'PASTE', all endpoint calls are skipped — safe for offline/test copies.
 * Real values are filled at switchover; token is junk-filtering, not auth.
 */
const ENDPOINT_CONFIG = {
  url:   'PASTE_DEPLOYED_WEB_APP_URL',
  token: 'PASTE_TOKEN',
};
