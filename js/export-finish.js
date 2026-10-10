/**
 * js/export-finish.js — what Export does after the ticket prints: write the Master Job Log, and
 * only if that worked, finish the job (job doc first, then its sheets). Returns the outcome and
 * the exact text the operator sees; never shows it itself. Spec 2026-10-10 (docs/specs).
 */
const ExportFinish = (() => {
  const LR = typeof LogRows !== 'undefined' ? LogRows : require('./log-rows.js');
  const P  = typeof Pricing !== 'undefined' ? Pricing : require('./pricing.js');
  const PU = typeof PathUtils !== 'undefined' ? PathUtils : require('./path-utils.js');

  // The CSV download: 9 columns (Customer appended — Estimating App import contract).
  function csvFile(jobSheets, completionOf, customerName) {
    const rows = [
      ['Sheet', 'Job', 'Total Time', 'Toolpath Count', 'Has V-bit', 'Completed At', 'Operator', 'Notes', 'Customer'],
      ...jobSheets.map(sheet => {
        const rec = completionOf(sheet.fileKey);
        return [
          sheet.sheetTitle || sheet.fileName,
          sheet.jobName    || '',
          sheet.totalTime  || '',
          sheet.toolpaths ? sheet.toolpaths.length : '',
          P.sheetHasVbit(sheet) ? 'Y' : 'N',
          rec?.completedAt ? LR.formatCompletedTime(rec.completedAt) : '',
          rec?.operator || '',
          rec?.notes    || '',
          customerName  || '',
        ];
      }),
    ];
    const escape = c => String(c).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
    const baseName = (jobSheets[0]?.fileName || 'cnc-job')
      .replace(/\.html?$/i, '')
      .replace(/_summary.*/i, '');
    return {
      name: `CNC Job Exports/${PU.sanitizeForPath(customerName)}/${baseName}.csv`,
      text: rows.map(r => r.map(c => `"${escape(c)}"`).join(',')).join('\r\n'),
    };
  }

  // deps: logEnabled(), getIdToken(), upsertLogRows(rows, token), completionOf(fileKey),
  //       hasDatabase(), finishJob(jobName, by), finishSheets(sheets, by)
  async function logAndFinish({ jobName, jobSheets, customerName, by }, deps) {
    let logged = false;
    let failReason = ' (endpoint unreachable)';
    try {
      let idToken = null;
      if (deps.logEnabled()) {
        try { idToken = await deps.getIdToken(); }
        catch (tokenErr) { tokenErr.signInProblem = true; throw tokenErr; }
      }
      const rows = jobSheets.map(sheet => LR.build(sheet, deps.completionOf(sheet.fileKey), customerName));
      const result = await deps.upsertLogRows(rows, idToken);
      logged = !!(result && result.ok);
      // An offline result (endpoint not configured) only counts as logged in no-database (PASTE)
      // test mode; in a real-database session nothing was written, so keep the job.
      if (logged && result.offline && deps.hasDatabase()) {
        logged = false;
        failReason = ": the Master Job Log connection isn't set up on this computer";
      }
    } catch (err) {
      console.warn('Master Job Log upsert failed:', err);
      if (err && err.signInProblem) failReason = ': could not confirm your sign-in - sign out and back in';
      else if (err && err.endpointError) failReason = `: ${err.message}`;
    }
    if (!logged) {
      return { finished: false, message: `Master Job Log was NOT updated${failReason}. The CSV still downloaded. The job was kept so you can export it again later.` };
    }

    // Finish, don't delete: sheets stay in Firestore with finished:true and leave the board.
    // Job doc first, sheets second: if the sheets write fails the job really is still on the
    // board, so "stays on the board" is true; a retry re-runs both.
    try {
      if (jobName) await deps.finishJob(jobName, by);
      await deps.finishSheets(jobSheets, by);
    } catch (err) {
      console.warn('Finish after export failed:', err);
      return { finished: false, message: `The Master Job Log was updated, but the job could not be marked finished (${err.message}). It stays on the board - export it again once the connection is back; the log rows will not be duplicated.` };
    }
    return { finished: true };
  }

  return { csvFile, logAndFinish };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ExportFinish;
