/**
 * NewJobAlert — which board changes mean "a job / sheets were uploaded on another computer", for the
 * new-job banner, the flashing tab and the NEW tag on the project card. Pure: no DOM, no Firestore, no clock.
 *   create({ sinceMs })          a tracker; sheets uploaded before sinceMs never alert (a job put back on the board)
 *     .baseline(sheets)          the board at load — nothing on it alerts
 *     .observe(sheets, ownKeys)  each live snapshot; returns how many sheets just arrived. ownKeys = fileKeys
 *                                this tab uploaded (never alert). A job that leaves the board drops out
 *     .alerts()                  [{ jobName, count, newJob }] still in the banner
 *     .dismiss()                 banner closed (the cards keep their tag)
 *     .opened(jobName)           the job was opened — clears its banner line and tag
 *     .fresh(jobName)            { count, newJob } while the job has unseen arrivals, else null
 *   message(alert) / tag(fresh)  the banner line / the card tag ("NEW", "2 NEW SHEETS")
 * Browser global `NewJobAlert`; module.exports for node --test.
 */
const NewJobAlert = (() => {
  const K = (typeof Keys !== 'undefined') ? Keys : require('./keys.js');

  const uploadedMs = s => {
    const u = s.uploadedAt;
    if (u && typeof u.toMillis === 'function') return u.toMillis();
    return typeof u === 'number' ? u : null;
  };

  function create({ sinceMs }) {
    let prevKeys = new Set();
    let prevJobs = new Set();
    const jobs = new Map();   // jobName → { keys: Set, newJob, inBanner }

    function remember(sheets) {
      prevKeys = new Set(sheets.map(s => s.fileKey));
      prevJobs = new Set(sheets.map(s => K.jobOf(s)));
    }

    function observe(sheets, ownKeys) {
      let arrived = 0;
      for (const s of sheets) {
        if (prevKeys.has(s.fileKey) || (ownKeys && ownKeys.has(s.fileKey))) continue;
        const at = uploadedMs(s);
        if (at == null || at < sinceMs) continue;
        const job = K.jobOf(s);
        let e = jobs.get(job);
        if (!e) { e = { keys: new Set(), newJob: !prevJobs.has(job), inBanner: true }; jobs.set(job, e); }
        e.keys.add(s.fileKey);
        e.inBanner = true;
        arrived++;
      }
      // Arrivals deleted before anyone looked don't count; a job with none left drops out.
      const onBoard = new Set(sheets.map(s => s.fileKey));
      for (const [job, e] of jobs) {
        for (const k of e.keys) if (!onBoard.has(k)) e.keys.delete(k);
        if (!e.keys.size) jobs.delete(job);
      }
      remember(sheets);
      return arrived;
    }

    return {
      baseline: remember,
      observe,
      alerts: () => [...jobs].filter(([, e]) => e.inBanner).map(([jobName, e]) => ({ jobName, count: e.keys.size, newJob: e.newJob })),
      dismiss: () => { for (const e of jobs.values()) e.inBanner = false; },
      opened: jobName => { jobs.delete(jobName); },
      fresh: jobName => { const e = jobs.get(jobName); return e ? { count: e.keys.size, newJob: e.newJob } : null; },
    };
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function message(a) {
    return a.newJob
      ? `New job loaded: ${a.jobName} · ${plural(a.count, 'sheet')}`
      : `${plural(a.count, 'new sheet')} added to ${a.jobName}`;
  }

  function tag(f) {
    if (!f) return null;
    return f.newJob ? 'NEW' : `${f.count} NEW SHEET${f.count === 1 ? '' : 'S'}`;
  }

  return { create, message, tag };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NewJobAlert;
