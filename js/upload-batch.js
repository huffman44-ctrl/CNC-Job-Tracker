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

  // files: [{ name, read: () => Promise<string> }]. deps: parse, onBoard, addToBoard,
  // removeFromBoard, getSheetDoc, saveSheet, archive, setArchiveUrl. Never rejects per file.
  async function run(files, deps) {
    const res = { saved: [], alreadyLoaded: [], finishedBefore: [], unchecked: [], unreadable: [], notSheets: [], saveFailed: [], savedByJob: new Map() };

    async function processFile(f) {
      let text;
      try { text = await f.read(); }
      catch (err) { console.warn('Reading', f.name, 'failed:', err); res.unreadable.push(f.name); return; }

      let claimed = null;
      try {
        const parsed = deps.parse(text);
        if (!isAspireSheet(parsed)) { res.notSheets.push(f.name); return; }
        const key = K.sheet(f.name);
        if (deps.onBoard(key) || inFlight.has(key)) { res.alreadyLoaded.push(f.name); return; }
        inFlight.add(key);
        claimed = key;

        // Finished sheets are not on the board, so ask the database. A FAILED read is not
        // "not found": block this file and say so (the rest of the drop still loads).
        let existing;
        try { existing = await deps.getSheetDoc(key); }
        catch (err) { console.warn('getSheetDoc failed:', err); res.unchecked.push(f.name); return; }
        if (existing && existing.finished === true) { res.finishedBefore.push({ name: f.name, doc: existing }); return; }
        // On the board, this computer hasn't caught up. A doc with no finished field is on no board
        // (the board query reads finished == false), so it is saved over and repaired, as before.
        if (existing && existing.finished === false) { res.alreadyLoaded.push(f.name); return; }

        const sheet = { fileKey: key, fileName: f.name, ...parsed };
        deps.addToBoard(sheet);
        const saveResult = await deps.saveSheet(sheet);
        if (!saveResult.ok) {
          deps.removeFromBoard(key);
          res.saveFailed.push({ name: f.name, message: (saveResult.error && saveResult.error.message) || 'unknown error' });
        } else {
          res.saved.push({ sheet, mode: saveResult.mode });
          const jn = K.jobOf(sheet);
          if (!res.savedByJob.has(jn)) res.savedByJob.set(jn, []);
          res.savedByJob.get(jn).push(key);
        }
        // Archive after the save resolves (whatever it said), so setArchiveUrl's update() has a
        // document to attach to.
        Promise.resolve().then(() => deps.archive(f.name, sheet.jobName || '', text))
          .then(url => { if (url) deps.setArchiveUrl(key, url); })
          .catch(err => console.warn('Archive upload failed:', err));
      } catch (err) {
        console.warn('Upload of', f.name, 'failed:', err);
        res.unchecked.push(f.name);
      } finally {
        if (claimed) inFlight.delete(claimed);
      }
    }

    await Promise.all(files.map(processFile));
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
    for (const name of res.unchecked) lines.push(`Couldn't check whether "${name}" was already cut — check your connection and drop it again.`);
    for (const name of res.unreadable) lines.push(`Couldn't read "${name}" — drop it again.`);
    for (const name of res.notSheets) lines.push(`"${name}" isn't an Aspire setup sheet, so it wasn't added.`);
    return lines.length ? lines.join('\n\n') : null;
  }

  return { run, notice, isAspireSheet };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UploadBatch;
