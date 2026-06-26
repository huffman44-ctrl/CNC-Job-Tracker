const SheetsSync = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
  let tokenClient    = null;
  let pendingResolve = null;
  let pendingReject  = null;

  function isConfigured() {
    return typeof SHEETS_CONFIG !== 'undefined'
      && SHEETS_CONFIG.clientId
      && !SHEETS_CONFIG.clientId.startsWith('YOUR')
      && SHEETS_CONFIG.spreadsheetId
      && !SHEETS_CONFIG.spreadsheetId.startsWith('YOUR');
  }

  function ensureClient() {
    if (tokenClient) return true;
    if (typeof google === 'undefined' || !google.accounts?.oauth2) return false;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: SHEETS_CONFIG.clientId,
      scope: SCOPE,
      callback: resp => {
        if (resp.error) {
          const msg = resp.error === 'popup_closed_by_user'
            ? 'cancelled'
            : (resp.error_description || resp.error);
          pendingReject?.(new Error(msg));
        } else {
          pendingResolve?.(resp.access_token);
        }
        pendingResolve = null;
        pendingReject  = null;
      },
    });
    return true;
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      if (!ensureClient()) {
        reject(new Error('Google sign-in not ready — please try again in a moment.'));
        return;
      }
      pendingResolve = resolve;
      pendingReject  = reject;
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async function syncToSheet(rows) {
    if (!isConfigured()) {
      throw new Error('Google Sheets not configured. Fill in sheets-config.js with your Client ID and Spreadsheet ID.');
    }

    const token = await requestToken();
    const id    = SHEETS_CONFIG.spreadsheetId;
    const tab   = encodeURIComponent(SHEETS_CONFIG.sheetName || 'Sheet1');

    // Clear existing content so stale rows don't linger
    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}:clear`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
    );
    if (!clearRes.ok) {
      const body = await clearRes.json().catch(() => ({}));
      throw new Error(body.error?.message || `Clear failed (${clearRes.status})`);
    }

    // Write header + data rows starting at A1
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${tab}!A1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!writeRes.ok) {
      const body = await writeRes.json().catch(() => ({}));
      throw new Error(body.error?.message || `Write failed (${writeRes.status})`);
    }

    return rows.length - 1; // number of data rows written
  }

  return { syncToSheet, isConfigured };
})();
