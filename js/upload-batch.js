/**
 * js/upload-batch.js — what happens to every file in a drop (spec .scratch/upload-guard).
 * run() reads, checks and saves each file and reports the outcome per file; notice() builds the
 * one combined message. Never shows anything itself; app.js does the screen work (file list,
 * banners, navigation, the owner job-details step).
 * The re-upload guard (spec 2026-10-04 §5.2): a finished sheet is never overwritten, a sheet
 * already on the board (this computer's or the database's) is never replaced, and a failed
 * database read is "couldn't check", never "not found".
 * Browser global `UploadBatch`; module.exports for node --test.
 */
const UploadBatch = (() => {
  const K = typeof Keys !== 'undefined' ? Keys : require('./keys.js');

  // fileKeys being checked/saved right now, across drops. Claimed synchronously next to the board
  // check so a re-drop (or the same name twice in one drop) can't slip past the await on getSheetDoc.
  const inFlight = new Set();

  // A real Aspire setup sheet always has at least one of these; a saved web page has none.
  function isAspireSheet(parsed) {
    return !!(parsed.jobName || (parsed.toolpaths && parsed.toolpaths.length)
      || (parsed.materialInfo && parsed.materialInfo.length) || parsed.layoutSvg);
  }

  // A Firestore call can wait forever on a stalled connection (a write resolves only when the
  // server answers), which froze the upload screen. Each database call gets this long.
  const WAIT_MS = 30000;
  const TIMED_OUT = {};
  function within(promise, ms) {
    let timer;
    const late = new Promise(r => { timer = setTimeout(() => r(TIMED_OUT), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // files: [{ name, read: () => Promise<string> }]. deps: parse, onBoard, addToBoard,
  // removeFromBoard, getSheetDoc, saveSheet, archive, setArchiveUrl; optional waitMs and
  // onFileDone(index, outcome) — outcome is the res list the file landed in. Never rejects per file.
  async function run(files, deps) {
    const res = { saved: [], alreadyLoaded: [], finishedBefore: [], unchecked: [], unreadable: [], notSheets: [], saveFailed: [], unconfirmed: [], savedByJob: new Map() };
    const waitMs = deps.waitMs || WAIT_MS;

    function addToJob(sheet) {
      const jn = K.jobOf(sheet);
      if (!res.savedByJob.has(jn)) res.savedByJob.set(jn, []);
      res.savedByJob.get(jn).push(sheet.fileKey);
    }

    async function processFile(f) {
      let text;
      try { text = await f.read(); }
      catch (err) { console.warn('Reading', f.name, 'failed:', err); res.unreadable.push(f.name); return 'unreadable'; }

      let claimed = null;
      try {
        const parsed = deps.parse(text);
        if (!isAspireSheet(parsed)) { res.notSheets.push(f.name); return 'notSheets'; }
        const key = K.sheet(f.name);
        if (deps.onBoard(key) || inFlight.has(key)) { res.alreadyLoaded.push(f.name); return 'alreadyLoaded'; }
        inFlight.add(key);
        claimed = key;

        // Finished sheets are not on the board, so ask the database. A FAILED (or unanswered)
        // read is not "not found": block this file and say so (the rest of the drop still loads).
        let existing;
        try { existing = await within(deps.getSheetDoc(key), waitMs); }
        catch (err) { console.warn('getSheetDoc failed:', err); res.unchecked.push(f.name); return 'unchecked'; }
        if (existing === TIMED_OUT) { console.warn('getSheetDoc timed out:', f.name); res.unchecked.push(f.name); return 'unchecked'; }
        if (existing && existing.finished === true) { res.finishedBefore.push({ name: f.name, doc: existing }); return 'finishedBefore'; }
        // On the board, this computer hasn't caught up. A doc with no finished field is on no board
        // (the board query reads finished == false), so it is saved over and repaired, as before.
        if (existing && existing.finished === false) { res.alreadyLoaded.push(f.name); return 'alreadyLoaded'; }

        const sheet = { fileKey: key, fileName: f.name, ...parsed };
        deps.addToBoard(sheet);
        const saving = deps.saveSheet(sheet);
        // Archive after the save resolves (whatever it said, however late), so setArchiveUrl's
        // update() has a document to attach to.
        saving.then(() => deps.archive(f.name, sheet.jobName || '', text))
          .then(url => { if (url) deps.setArchiveUrl(key, url); })
          .catch(err => console.warn('Archive upload failed:', err));

        const saveResult = await within(saving, waitMs);
        if (saveResult === TIMED_OUT) {
          // Firestore keeps retrying while the page stays open, so the sheet stays on the board
          // and its job is treated as uploaded. A late failure takes it off, like an on-time one.
          saving.then(r => { if (!r.ok) deps.removeFromBoard(key); }, () => deps.removeFromBoard(key));
          res.unconfirmed.push(f.name);
          addToJob(sheet);
          return 'unconfirmed';
        }
        if (!saveResult.ok) {
          deps.removeFromBoard(key);
          res.saveFailed.push({ name: f.name, message: (saveResult.error && saveResult.error.message) || 'unknown error' });
          return 'saveFailed';
        }
        res.saved.push({ sheet, mode: saveResult.mode });
        addToJob(sheet);
        return 'saved';
      } catch (err) {
        console.warn('Upload of', f.name, 'failed:', err);
        res.unchecked.push(f.name);
        return 'unchecked';
      } finally {
        if (claimed) inFlight.delete(claimed);
      }
    }

    await Promise.all(files.map(async (f, i) => {
      const outcome = await processFile(f);
      if (deps.onFileDone) deps.onFileDone(i, outcome);
    }));
    return res;
  }

  // The one combined notice for a drop, or null. formatDT(Date) -> display text.
  function notice(res, formatDT) {
    const lines = [];
    if (res.alreadyLoaded.length) {
      lines.push(res.alreadyLoaded.length === 1
        ? `"${res.alreadyLoaded[0]}" is already loaded — it's on the board, so nothing was changed.`
        : `${res.alreadyLoaded.length} sheets were already loaded, so they were left unchanged.`);
    }
    for (const { name, doc } of res.finishedBefore) {
      const when = doc.finishedAt ? formatDT(new Date(doc.finishedAt)) : 'an earlier export';
      lines.push(`"${name}" was already cut and finished on ${when} (job ${doc.jobName || 'unknown'}). If this is a new cut, save it from Aspire under a new file name.`);
    }
    if (res.unchecked.length) {
      lines.push(res.unchecked.length === 1
        ? `Couldn't check whether "${res.unchecked[0]}" was already cut — check your connection and drop it again.`
        : `Couldn't check whether ${res.unchecked.length} sheets were already cut — check your connection and drop them again.`);
    }
    for (const name of res.unreadable) lines.push(`Couldn't read "${name}" — drop it again.`);
    for (const name of res.notSheets) lines.push(`"${name}" isn't an Aspire setup sheet, so it wasn't added.`);
    const unconfirmed = res.unconfirmed || [];
    if (unconfirmed.length) {
      lines.push(unconfirmed.length === 1
        ? `"${unconfirmed[0]}" hasn't finished saving yet — the connection may be slow. Keep this page open; if it isn't on the board in a couple of minutes, drop it again.`
        : `${unconfirmed.length} sheets haven't finished saving yet — the connection may be slow. Keep this page open; if any are missing from the board in a couple of minutes, drop them again.`);
    }
    return lines.length ? lines.join('\n\n') : null;
  }

  return { run, notice, isAspireSheet };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UploadBatch;
