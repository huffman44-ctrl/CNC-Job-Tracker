/**
 * JobStickers — pure helpers for sticker batches attached to a job (spec .scratch/job-stickers).
 *   forJob(items, jobName)       print-queue items whose jobName is the same job (Keys.job match; never trimmed)
 *   waitingCount(items, jobName) how many of that job's items are waiting (printedAt == null)
 *   ordered(items)               waiting oldest first, then printed newest first (mirrors Storage)
 * No DOM, no Firestore, no clock. Browser global `JobStickers`; module.exports for node --test.
 */
const JobStickers = (() => {
  const K = (typeof Keys !== 'undefined') ? Keys : require('./keys.js');

  function forJob(items, jobName) {
    if (typeof jobName !== 'string' || jobName === '') return [];
    const key = K.job(jobName);
    return items.filter(i => typeof i.jobName === 'string' && i.jobName !== '' && K.job(i.jobName) === key);
  }

  function waitingCount(items, jobName) {
    return forJob(items, jobName).filter(i => i.printedAt == null).length;
  }

  function ordered(items) {
    const waiting = items
      .filter(i => i.printedAt == null)
      .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
    const printed = items
      .filter(i => i.printedAt != null)
      .sort((a, b) => (b.printedAt ?? 0) - (a.printedAt ?? 0));
    return waiting.concat(printed);
  }

  return { forJob, waitingCount, ordered };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JobStickers;
