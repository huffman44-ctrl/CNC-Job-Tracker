/**
 * Keys — the ID formulas every record is filed under in Firestore (spec .scratch/shared-key-helpers).
 * LOCKED: these outputs are the document ids of every live record, pinned by test/keys.test.mjs.
 * Never change what they produce — not even trimming the job name — or jobs and customers lose
 * their records.
 *   Keys.job(jobName)    jobs/, jobBilling/, projectNotes/, projectCustomer/ ('proj_…')
 *   Keys.customer(name)  customers/, customerBilling/ ('cust_…', name trimmed first)
 *   Keys.sheet(fileName) the sheet's fileKey: sheets/, completions/, sheetNotes/, sheetAnnotations/, sheetBilling/
 *   Keys.jobOf(sheet)    the job a sheet belongs to: job name, else file name, else 'Unknown Job'
 * Browser global `Keys`; module.exports for node --test.
 */
const Keys = (() => {
  function simpleHash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function job(jobName) { return 'proj_' + simpleHash(jobName); }
  function customer(name) { return 'cust_' + simpleHash(name.trim()); }
  function sheet(fileName) { return simpleHash(fileName); }
  function jobOf(s) { return s.jobName || s.fileName || 'Unknown Job'; }

  return { job, customer, sheet, jobOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Keys;
