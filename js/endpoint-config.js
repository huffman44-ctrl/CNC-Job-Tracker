/**
 * Apps Script web app endpoint (archive + Master Job Log append).
 * PASTE convention (same as firebase-config.js): while url starts with
 * 'PASTE', all endpoint calls are skipped — safe for offline/test copies.
 * Real values are filled at switchover; token is junk-filtering, not auth.
 */
const ENDPOINT_CONFIG = {
  url:   'https://script.google.com/macros/s/AKfycbxdbGCwYRej_vskmuEUT4jUx1SeypuFa11Lg6yAGWtoOhfILHVgwndsFanhZ_odw_BIHg/exec',
  token: '42w0IbUiM2UVwOGVgBu10cyi2WQ0CmPqj4Jfy4Ok',
};
