/**
 * Completion records: Firestore completions/{fileKey}
 * Sheet data:         Firestore sheets/{fileKey}
 *
 * Local cache enables synchronous reads so UI never blocks on Firestore.
 * All writes update the cache immediately and persist to Firestore async.
 * Sheets carry `finished` (Phase 1 billing redesign): finished sheets stay forever and leave the board.
 */
const Storage = (() => {
  let db = null;
  const completionsCache = {}; // { [fileKey]: { completedAt, operator, notes } }
  const notesCache = {};       // { [jobKey]: string }
  const sheetNotesCache = {};  // { [fileKey]: string }
  const annotationsCache = {}; // { [fileKey]: Array<{type,x,y,w,h,color}> }
  const customersCache = {};        // { [key]: name }
  const projectCustomerCache = {};  // { [jobKey]: name }
  const printQueueCache = {};       // { [id]: Item } — see getPrintQueue for the Item shape
  let localPrintId = 0;             // ids when Firebase is off (PASTE config / tests)

  function init(firestore) {
    db = firestore;
  }

  /* ── Completions ── */

  function get(fileKey, itemId) {
    return completionsCache[fileKey] ?? null;
  }

  async function set(fileKey, itemId, record) {
    completionsCache[fileKey] = record;
    if (!db) return;
    try {
      await db.collection('completions').doc(fileKey).set(record);
    } catch (e) {
      console.warn('Firestore write failed:', e);
    }
  }

  async function clear(fileKey, itemId) {
    delete completionsCache[fileKey];
    if (!db) return;
    try {
      await db.collection('completions').doc(fileKey).delete();
    } catch (e) {
      console.warn('Firestore delete failed:', e);
    }
  }

  async function clearAll(fileKey) {
    return clear(fileKey, 'sheet');
  }

  async function loadCompletions() {
    if (!db) return;
    try {
      const snap = await db.collection('completions').get();
      snap.forEach(doc => { completionsCache[doc.id] = doc.data(); });
    } catch (e) {
      console.warn('Firestore loadCompletions failed:', e);
    }
  }

  function onCompletionChange(callback) {
    if (!db) return;
    db.collection('completions').onSnapshot(snap => {
      Object.keys(completionsCache).forEach(k => delete completionsCache[k]);
      snap.forEach(doc => { completionsCache[doc.id] = doc.data(); });
      callback();
    }, err => console.warn('Firestore listener error:', err));
  }

  /* ── Project Notes ── */

  function getNote(jobKey) {
    return notesCache[jobKey] || null;
  }

  async function setNote(jobKey, text) {
    const trimmed = (text || '').trim();
    if (trimmed) {
      notesCache[jobKey] = trimmed;
    } else {
      delete notesCache[jobKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('projectNotes').doc(jobKey).set({ text: trimmed });
      } else {
        await db.collection('projectNotes').doc(jobKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setNote failed:', e);
    }
  }

  async function loadNotes() {
    if (!db) return;
    try {
      const snap = await db.collection('projectNotes').get();
      snap.forEach(doc => { notesCache[doc.id] = doc.data().text; });
    } catch (e) {
      console.warn('Firestore loadNotes failed:', e);
    }
  }

  function onNoteChange(callback) {
    if (!db) return;
    db.collection('projectNotes').onSnapshot(snap => {
      Object.keys(notesCache).forEach(k => delete notesCache[k]);
      snap.forEach(doc => { notesCache[doc.id] = doc.data().text; });
      callback();
    }, err => console.warn('Firestore notes listener error:', err));
  }

  /* ── Sheet Notes (per-sheet instruction notes) ── */

  function getSheetNote(fileKey) {
    return sheetNotesCache[fileKey] || null;
  }

  async function setSheetNote(fileKey, text) {
    const trimmed = (text || '').trim();
    if (trimmed) {
      sheetNotesCache[fileKey] = trimmed;
    } else {
      delete sheetNotesCache[fileKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('sheetNotes').doc(fileKey).set({ text: trimmed });
      } else {
        await db.collection('sheetNotes').doc(fileKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setSheetNote failed:', e);
    }
  }

  async function loadSheetNotes() {
    if (!db) return;
    try {
      const snap = await db.collection('sheetNotes').get();
      snap.forEach(doc => { sheetNotesCache[doc.id] = doc.data().text; });
    } catch (e) {
      console.warn('Firestore loadSheetNotes failed:', e);
    }
  }

  function onSheetNoteChange(callback) {
    if (!db) return;
    db.collection('sheetNotes').onSnapshot(snap => {
      Object.keys(sheetNotesCache).forEach(k => delete sheetNotesCache[k]);
      snap.forEach(doc => { sheetNotesCache[doc.id] = doc.data().text; });
      callback();
    }, err => console.warn('Firestore sheetNotes listener error:', err));
  }

  /* ── Sheet Annotations (layout diagram markup) ── */

  function getAnnotations(fileKey) {
    return annotationsCache[fileKey] || [];
  }

  async function setAnnotations(fileKey, shapes) {
    if (shapes && shapes.length) {
      annotationsCache[fileKey] = shapes;
    } else {
      delete annotationsCache[fileKey];
    }
    if (!db) return;
    try {
      if (shapes && shapes.length) {
        await db.collection('sheetAnnotations').doc(fileKey).set({ shapes });
      } else {
        await db.collection('sheetAnnotations').doc(fileKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setAnnotations failed:', e);
    }
  }

  async function loadAnnotations() {
    if (!db) return;
    try {
      const snap = await db.collection('sheetAnnotations').get();
      snap.forEach(doc => { annotationsCache[doc.id] = doc.data().shapes; });
    } catch (e) {
      console.warn('Firestore loadAnnotations failed:', e);
    }
  }

  function onAnnotationsChange(callback) {
    if (!db) return;
    db.collection('sheetAnnotations').onSnapshot(snap => {
      Object.keys(annotationsCache).forEach(k => delete annotationsCache[k]);
      snap.forEach(doc => { annotationsCache[doc.id] = doc.data().shapes; });
      callback();
    }, err => console.warn('Firestore sheetAnnotations listener error:', err));
  }

  /* ── Customer Directory ── */

  function getCustomers() {
    return Object.keys(customersCache)
      .map(key => ({ key, name: customersCache[key] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function addCustomer(key, name) {
    customersCache[key] = name;
    if (!db) return;
    try {
      await db.collection('customers').doc(key).set({ name });
    } catch (e) {
      console.warn('Firestore addCustomer failed:', e);
    }
  }

  async function renameCustomer(oldKey, newKey, newName) {
    delete customersCache[oldKey];
    customersCache[newKey] = newName;
    if (!db) return;
    try {
      await db.collection('customers').doc(oldKey).delete();
      await db.collection('customers').doc(newKey).set({ name: newName });
    } catch (e) {
      console.warn('Firestore renameCustomer failed:', e);
    }
  }

  async function removeCustomer(key) {
    delete customersCache[key];
    if (!db) return;
    try {
      await db.collection('customers').doc(key).delete();
    } catch (e) {
      console.warn('Firestore removeCustomer failed:', e);
    }
  }

  async function loadCustomers() {
    if (!db) return;
    try {
      const snap = await db.collection('customers').get();
      snap.forEach(doc => { customersCache[doc.id] = doc.data().name; });
    } catch (e) {
      console.warn('Firestore loadCustomers failed:', e);
    }
  }

  function onCustomersChange(callback) {
    if (!db) return;
    db.collection('customers').onSnapshot(snap => {
      Object.keys(customersCache).forEach(k => delete customersCache[k]);
      snap.forEach(doc => { customersCache[doc.id] = doc.data().name; });
      callback();
    }, err => console.warn('Firestore customers listener error:', err));
  }

  /* ── Project Customer (which customer a job is tagged with) ── */

  function getProjectCustomer(jobKey) {
    return projectCustomerCache[jobKey] || null;
  }

  async function setProjectCustomer(jobKey, name) {
    const trimmed = (name || '').trim();
    if (trimmed) {
      projectCustomerCache[jobKey] = trimmed;
    } else {
      delete projectCustomerCache[jobKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('projectCustomer').doc(jobKey).set({ name: trimmed });
      } else {
        await db.collection('projectCustomer').doc(jobKey).delete();
      }
    } catch (e) {
      console.warn('Firestore setProjectCustomer failed:', e);
    }
  }

  async function loadProjectCustomers() {
    if (!db) return;
    try {
      const snap = await db.collection('projectCustomer').get();
      snap.forEach(doc => { projectCustomerCache[doc.id] = doc.data().name; });
    } catch (e) {
      console.warn('Firestore loadProjectCustomers failed:', e);
    }
  }

  /* ── Sheets ── */

  async function saveSheet(sheet) {
    if (!db) return { ok: true, mode: 'plain', storedBytes: 0, error: null };

    let packed;
    try {
      packed = await SvgCodec.packLayoutSvg(sheet.layoutSvg || '');
    } catch (e) {
      console.warn('SVG packing failed, storing sheet without drawing:', e);
      packed = { mode: 'oversize', layoutSvg: '', layoutSvgGz: '',
                 originalBytes: 0, storedBytes: 0 };
    }

    try {
      await db.collection('sheets').doc(sheet.fileKey).set({
        fileKey:      sheet.fileKey,
        fileName:     sheet.fileName     || '',
        sheetTitle:   sheet.sheetTitle   || '',
        jobName:      sheet.jobName      || '',
        totalTime:    sheet.totalTime    || '',
        toolpaths:    sheet.toolpaths    || [],
        materialInfo: sheet.materialInfo || [],
        finished:     false,   // leaves the board only when Collin's export finishes the job (spec 5.2)
        layoutSvg:    packed.layoutSvg,
        layoutSvgGz:  packed.layoutSvgGz,
        // Tells the render path to show the "too large" notice instead of
        // silently rendering nothing.
        layoutOversize: packed.mode === 'oversize',
        uploadedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, mode: packed.mode, storedBytes: packed.storedBytes, error: null };
    } catch (e) {
      console.warn('Firestore saveSheet failed:', e);
      return { ok: false, mode: packed.mode, storedBytes: packed.storedBytes, error: e };
    }
  }

  async function setArchiveUrl(fileKey, url) {
    if (!db) return;
    try {
      // update() (not merge-set) so a sheet deleted while the archive POST
      // was in flight doesn't get resurrected as a ghost doc with only
      // an archiveUrl field.
      await db.collection('sheets').doc(fileKey).update({ archiveUrl: url });
    } catch (e) {
      console.warn('Firestore setArchiveUrl failed:', e);
    }
  }

  /* ── Sheets: the board query ──
   * Finished sheets stay in Firestore forever (Phase 1 of the billing redesign); the board
   * shows only `finished == false`. A Firestore equality filter EXCLUDES docs that lack the
   * field, and every pre-Phase-1 doc lacks it, so the filtered query is used only once
   * settings/migrations says the one-time stamp has run (Settings › Maintenance). Until then
   * the whole collection is read and finished docs are dropped here. Both modes drop them
   * client-side, so a finished sheet never shows on any device whatever the flag says.
   * settings/migrations is the ONE settings doc operators can read (rules) — Collin's board
   * needs the flag too. No orderBy: where + orderBy on different fields needs a composite
   * index that fails only in production; sort client-side like before.
   */
  let migrationFlags = {};

  async function loadMigrationState() {
    if (!db) return;
    try {
      const snap = await db.collection('settings').doc('migrations').get();
      migrationFlags = snap.exists ? (snap.data() || {}) : {};
    } catch (e) {
      console.warn('Firestore loadMigrationState failed (board falls back to the unfiltered query):', e);
      migrationFlags = {};
    }
  }

  function migrationState() { return migrationFlags.sheetsFinishedFlag || null; }
  function sheetsFilterReady() { const f = migrationState(); return !!(f && f.done); }

  function activeSheetsQuery() {
    const col = db.collection('sheets');
    return sheetsFilterReady() ? col.where('finished', '==', false) : col;
  }

  function filterActive(docs) { return docs.filter(d => d.finished !== true); }

  function sortByUploadedAt(docs) {
    // Nulls sort last here instead of disappearing (a query orderBy would drop them).
    return docs.slice().sort((a, b) => {
      const ta = a.uploadedAt?.toMillis?.() ?? Infinity;
      const tb = b.uploadedAt?.toMillis?.() ?? Infinity;
      return ta - tb;
    });
  }

  async function loadSheets() {
    if (!db) return [];
    try {
      const snap = await activeSheetsQuery().get();
      return sortByUploadedAt(filterActive(snap.docs.map(doc => doc.data())));
    } catch (e) {
      console.warn('Firestore loadSheets failed:', e);
      return [];
    }
  }

  function onSheetsChange(callback) {
    if (!db) return;
    activeSheetsQuery().onSnapshot(snap => {
      callback(sortByUploadedAt(filterActive(snap.docs.map(doc => doc.data()))));
    }, err => console.warn('Firestore sheets listener error:', err));
  }

  // Owners' "Show finished jobs" view (one-shot, not a listener — finished jobs are history).
  // opts.strict: rethrow a failed read instead of returning [] (Billing must say "couldn't load").
  async function loadFinishedSheets(opts) {
    if (!db) return [];
    try {
      const snap = await db.collection('sheets').where('finished', '==', true).get();
      return snap.docs.map(doc => doc.data()).sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    } catch (e) {
      console.warn('Firestore loadFinishedSheets failed:', e);
      if (opts && opts.strict) throw e;
      return [];
    }
  }

  // The re-upload guard reads Firestore, not the in-memory array: finished sheets are not in
  // the array any more, and re-dropping one must not silently overwrite it (spec §5.2).
  // CONTRACT: resolves the doc data when it exists; resolves null ONLY for a confirmed missing
  // doc (or PASTE/in-memory mode, where storage keeps no sheet cache); THROWS when the read
  // itself fails. The upload guard must treat a throw as "could not check" and block the file —
  // a failed read must never look like "not found".
  async function getSheetDoc(fileKey) {
    if (!db) return null;
    const snap = await db.collection('sheets').doc(fileKey).get();
    return snap.exists ? snap.data() : null;
  }

  /* ── Finishing (Collin's export) ── */
  const WRITE_BATCH = 500;   // Firestore write-batch limit

  function finishPatch(sheet, by, nowMs) {
    const patch = { finished: true, finishedAt: nowMs, finishedBy: by || '' };
    // The archived HTML is the drawing of record once a sheet is finished; dropping the
    // stored SVG keeps the board's initial load from growing by every drawing ever cut.
    if (sheet.archiveUrl) { patch.layoutSvg = ''; patch.layoutSvgGz = ''; patch.layoutOversize = false; }
    return patch;
  }

  // NOT swallowed: if this throws, exportJob keeps the job on the board and says so.
  async function finishSheets(sheetList, by) {
    if (!db) return { count: sheetList.length };
    const now = Date.now();
    for (let i = 0; i < sheetList.length; i += WRITE_BATCH) {
      const batch = db.batch();
      sheetList.slice(i, i + WRITE_BATCH).forEach(s => batch.update(db.collection('sheets').doc(s.fileKey), finishPatch(s, by, now)));
      await batch.commit();
    }
    return { count: sheetList.length };
  }

  async function unfinishSheets(fileKeys) {
    // finishedAt/finishedBy are deliberately kept: the put-back archive notice uses finishedAt.
    if (!db) return;
    for (let i = 0; i < fileKeys.length; i += WRITE_BATCH) {
      const batch = db.batch();
      fileKeys.slice(i, i + WRITE_BATCH).forEach(k => batch.update(db.collection('sheets').doc(k), { finished: false }));
      await batch.commit();
    }
  }

  /* ── Jobs (jobs/{jobKey}) — one job-level home for "finished" (spec §5.3) ── */
  async function upsertJob(jobKey, jobName, by) {
    if (!db) return;
    try {
      const ref = db.collection('jobs').doc(jobKey);
      const snap = await ref.get();
      if (snap.exists) return;
      await ref.set({ jobName: jobName || '', finished: false, finishedAt: null, finishedBy: '', exportCount: 0, lastExportAt: null, createdAt: Date.now(), createdBy: by || '' }, { merge: true });   // merge: a VanLab print record landing between the get and this set survives
    } catch (e) {
      console.warn('Firestore upsertJob failed:', e);
    }
  }

  // Upload path (spec §5.3): the job exists and is OPEN afterwards. upsertJob keeps createdAt/createdBy
  // only-if-missing; reopenJob then clears a stale finished:true when sheets are re-uploaded for a
  // previously finished job name. (Edit-job-details keeps using plain upsertJob and never reopens.)
  async function upsertJobForUpload(jobKey, jobName, by) {
    if (!db) return;
    await upsertJob(jobKey, jobName, by);
    try { await reopenJob(jobKey); }
    catch (e) { console.warn('Firestore reopenJob (upload) failed:', e); }
  }

  async function finishJob(jobKey, jobName, by) {
    if (!db) return;
    const now = Date.now();
    await db.collection('jobs').doc(jobKey).set({
      jobName: jobName || '', finished: true, finishedAt: now, finishedBy: by || '',
      exportCount: firebase.firestore.FieldValue.increment(1), lastExportAt: now,
    }, { merge: true });
  }

  async function reopenJob(jobKey) {
    if (!db) return;
    await db.collection('jobs').doc(jobKey).set({ finished: false }, { merge: true });
  }

  /* ── VanLab print records: jobs/{jobKey}.vanlabPrinted.{stickers|packing|crate} = { at, by } (ticket 02) ──
     Field-level set-merge only, so the other two items and the rest of the job doc survive (and a job
     with no doc yet gets one). With no database (PASTE copy) the records live in this tab. */
  const VANLAB_PRINTS = ['stickers', 'packing', 'crate'];
  const localJobDocs = {};       // { [jobKey]: jobDoc } — no-database mode only
  const localJobListeners = {};  // { [jobKey]: Set<cb> } — no-database mode only

  function checkVanlabKind(kind) {
    if (!VANLAB_PRINTS.includes(kind)) throw new Error('unknown VanLab print: ' + kind);
  }

  function changeLocalJobDoc(jobKey, edit) {
    const doc = localJobDocs[jobKey] = localJobDocs[jobKey] || {};
    edit(doc);
    (localJobListeners[jobKey] || []).forEach(cb => cb(JSON.parse(JSON.stringify(doc))));
  }

  async function setVanlabPrinted(jobKey, jobName, kind, record) {
    checkVanlabKind(kind);
    if (!db) {
      changeLocalJobDoc(jobKey, d => { d.jobName = jobName || ''; d.vanlabPrinted = { ...d.vanlabPrinted, [kind]: record }; });
      return;
    }
    await db.collection('jobs').doc(jobKey).set({ jobName: jobName || '', vanlabPrinted: { [kind]: record } }, { merge: true });
  }

  async function clearVanlabPrinted(jobKey, kind) {
    checkVanlabKind(kind);
    if (!db) {
      changeLocalJobDoc(jobKey, d => { if (d.vanlabPrinted) delete d.vanlabPrinted[kind]; });
      return;
    }
    await db.collection('jobs').doc(jobKey).set({ vanlabPrinted: { [kind]: firebase.firestore.FieldValue.delete() } }, { merge: true });
  }

  // Live view of one job doc while that job is open; cb(data or null). Returns the unsubscribe.
  function onJobDocChange(jobKey, cb) {
    if (!db) {
      const set = localJobListeners[jobKey] = localJobListeners[jobKey] || new Set();
      set.add(cb);
      cb(localJobDocs[jobKey] ? JSON.parse(JSON.stringify(localJobDocs[jobKey])) : null);
      return () => set.delete(cb);
    }
    return db.collection('jobs').doc(jobKey).onSnapshot(
      snap => cb(snap.exists ? snap.data() : null),
      err => console.warn('Firestore job listener failed:', err),
    );
  }

  /* ── One-time migration: stamp finished:false on every legacy sheet (spec §11.1 step 6) ── */
  async function migrateFinishedFlag(onProgress) {
    if (!db) return { stamped: 0, total: 0 };
    const snap = await db.collection('sheets').get();
    const todo = snap.docs.filter(d => (d.data() || {}).finished === undefined);
    for (let i = 0; i < todo.length; i += WRITE_BATCH) {
      const batch = db.batch();
      todo.slice(i, i + WRITE_BATCH).forEach(d => batch.update(d.ref, { finished: false }));
      await batch.commit();
      if (onProgress) onProgress(Math.min(i + WRITE_BATCH, todo.length), todo.length);
    }
    const prior = migrationState() || { count: 0 };
    const flag = { done: true, at: Date.now(), count: (prior.count || 0) + todo.length, total: snap.size };
    await db.collection('settings').doc('migrations').set({ sheetsFinishedFlag: flag }, { merge: true });
    migrationFlags = { ...migrationFlags, sheetsFinishedFlag: flag };
    return { stamped: todo.length, total: snap.size };
  }

  // The per-sheet documents that make up a sheet's record besides sheets/{fileKey} itself (the sheet
  // record table in CLAUDE.md). deleteSheets removes these; a new per-sheet doc type goes in this list.
  const SHEET_RECORD_PARTS = [
    { collection: 'completions', cache: completionsCache },
    { collection: 'sheetNotes', cache: sheetNotesCache },
    { collection: 'sheetAnnotations', cache: annotationsCache },
  ];

  // Deletes each sheet's whole record (spec .scratch/complete-sheet-delete). The sheet doc goes
  // FIRST; its completion, note and markup (docs and caches) only once that worked, so a refused
  // delete never wipes a billed sheet's cut record. The rules refuse an on-board sheet's delete only
  // when its billing record is in-progress/billed — or when the doc is already gone (resource is
  // null) — so a permission-denied is checked with one read: still there = blocked (on an invoice),
  // gone = deleted, unreadable (signed out) = failed. Any other error = failed. Offline, the SDK's
  // delete() never settles, so a browser that says it is offline fails straight away.
  // Never throws per sheet, never shows anything; results in input order.
  async function deleteSheets(fileKeys) {
    const offline = db && typeof navigator !== 'undefined' && navigator.onLine === false;
    const failed = (fileKey, e) => ({ fileKey, kind: 'failed', message: (e && e.message) || String(e) });
    const outcomes = await Promise.all(fileKeys.map(async fileKey => {
      if (offline) return failed(fileKey, 'offline');
      if (db) {
        try {
          await db.collection('sheets').doc(fileKey).delete();
        } catch (e) {
          if (!e || e.code !== 'permission-denied') return failed(fileKey, e);
          let stillThere;
          try { stillThere = (await getSheetDoc(fileKey)) !== null; }
          catch (readErr) { return failed(fileKey, readErr); }
          if (stillThere) return { fileKey, kind: 'blocked' };
        }
      }
      SHEET_RECORD_PARTS.forEach(p => { delete p.cache[fileKey]; });
      if (db) {
        // The sheet is gone, so it is reported deleted whatever happens here; a leftover is only logged.
        await Promise.all(SHEET_RECORD_PARTS.map(p => db.collection(p.collection).doc(fileKey).delete()
          .catch(e => console.warn(`deleteSheets: sheet ${fileKey} deleted but its ${p.collection} doc was not:`, e))));
      }
      return { fileKey, kind: 'deleted' };
    }));
    return {
      deleted: outcomes.filter(o => o.kind === 'deleted').map(o => o.fileKey),
      blocked: outcomes.filter(o => o.kind === 'blocked').map(o => o.fileKey),
      failed: outcomes.filter(o => o.kind === 'failed').map(o => ({ fileKey: o.fileKey, message: o.message })),
    };
  }

  async function clearSheets() {
    if (!db) return;
    try {
      const snap = await db.collection('sheets').get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.warn('Firestore clearSheets failed:', e);
    }
  }

  async function clearAllCompletions() {
    Object.keys(completionsCache).forEach(k => delete completionsCache[k]);
    if (!db) return;
    try {
      const snap = await db.collection('completions').get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.warn('Firestore clearAllCompletions failed:', e);
    }
  }

  /* ── Ticket History (reprintable job tickets) ── */

  async function saveTicketRecord(record) {
    if (!db) return;
    try {
      await db.collection('ticketHistory').add({
        jobName:       record.jobName       || '',
        sheetCount:    record.sheetCount    || 0,
        completedDate: record.completedDate || '',
        exportedAt:    firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Firestore saveTicketRecord failed:', e);
    }
  }

  async function loadTicketHistory() {
    // Returns [] for "no records" but null for "failed to load" — callers
    // need to tell these apart to show the right empty-state message.
    if (!db) return [];
    try {
      const snap = await db.collection('ticketHistory').orderBy('exportedAt', 'desc').get();
      return snap.docs.map(doc => doc.data());
    } catch (e) {
      console.warn('Firestore loadTicketHistory failed:', e);
      return null;
    }
  }

  /* ── Print Queue (the "To Print" panel) ── Firestore printQueue/{id} ──
   * Item: { id, kind:'stickers'|'document', lines, fileId, fileName, pages,
   *         size:'3x1'|'4x6'|'letter', jobName, createdBy, createdAt(ms), printedAt(ms|null) }
   * Open items (printedAt == null) live until printed. Printed items are RECENT
   * history only: the app loads the last PRINT_RETENTION_DAYS of them and
   * clearPrintedBefore() deletes the rest (retention amendment, 2026-09-23).
   * Two single-field queries, never an orderBy (see onSheetsChange).
   */
  const PRINT_RETENTION_DAYS = 30;
  const PRINT_RETENTION_MS = PRINT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  function printRetentionCutoff(now = Date.now()) { return now - PRINT_RETENTION_MS; }

  // printQueueCache is the MERGE of two query results. Each snapshot handler
  // replaces only its own source and the merge is rebuilt, so the printed
  // listener firing can never wipe open items and vice versa.
  const printQueueSources = { open: {}, printed: {} };

  function printQueueQueries() {
    const col = db.collection('printQueue');
    return {
      // `== null` matches only docs that HAVE printedAt set to null. Every
      // writer below sets it explicitly (null or a number). Never
      // FieldValue.delete() it — the doc would drop out of both queries.
      open:    col.where('printedAt', '==', null),
      printed: col.where('printedAt', '>=', printRetentionCutoff()),
    };
  }

  // Docs can be hand-edited in the console; a missing/odd `lines` must
  // not take the whole list down in renderPrintQueue.
  function printItemFromDoc(doc) {
    const d = doc.data() || {};
    return { id: doc.id, ...d, lines: Array.isArray(d.lines) ? d.lines : [] };
  }

  function applyPrintSnapshot(source, snap) {
    const next = {};
    snap.forEach(doc => { next[doc.id] = printItemFromDoc(doc); });
    printQueueSources[source] = next;
    Object.keys(printQueueCache).forEach(k => delete printQueueCache[k]);
    // Open first, printed second: when an id sits in both for an instant (the two
    // listeners fire back to back on a mark-printed) the printed copy wins, so a
    // just-marked item never flashes back into Collin's open list.
    Object.assign(printQueueCache, printQueueSources.open, printQueueSources.printed);
  }

  function getPrintQueue() {
    return Object.values(printQueueCache)
      .filter(i => i.printedAt == null)
      .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
  }

  function getPrintedItems() {
    // The query cutoff is frozen when the listener starts and the shop PC's tab
    // lives for days — re-apply the window here so the list stays honest.
    const cutoff = printRetentionCutoff();
    return Object.values(printQueueCache)
      .filter(i => i.printedAt != null && i.printedAt >= cutoff)
      .sort((a, b) => (b.printedAt ?? 0) - (a.printedAt ?? 0));
  }

  async function addPrintItem(item) {
    // Firestore FIRST, cache second — the reverse of every other writer in
    // this file, and it does not swallow the error. A batch must never show
    // in Collin's list unless it was actually saved (spec: "a failed send
    // must never leave a half-written row in the list").
    const record = {
      kind:      item.kind || 'stickers',
      lines:     Array.isArray(item.lines) ? item.lines.slice() : [],
      fileId:    item.fileId || null,
      fileName:  item.fileName || null,
      pages:     Number.isInteger(item.pages) ? item.pages : null,
      size:      item.size,
      jobName:   item.jobName || null,
      createdBy: item.createdBy || '',
      createdAt: Date.now(),
      printedAt: null,
    };
    let id;
    if (db) {
      const ref = db.collection('printQueue').doc();
      await ref.set(record);
      id = ref.id;
    } else {
      id = 'local-' + (++localPrintId);
    }
    printQueueCache[id] = { id, ...record };
    return id;
  }

  async function markPrinted(id) {
    const item = printQueueCache[id];
    if (!item) throw new Error('unknown print item: ' + id);
    const printedAt = Date.now();
    if (db) await db.collection('printQueue').doc(id).update({ printedAt });
    item.printedAt = printedAt;
  }

  async function unmarkPrinted(id) {
    const item = printQueueCache[id];
    if (!item) throw new Error('unknown print item: ' + id);
    // A literal null, never FieldValue.delete() — see printQueueQueries.
    if (db) await db.collection('printQueue').doc(id).update({ printedAt: null });
    item.printedAt = null;
  }

  // The cache is rebuilt from the two source maps, so forgetting a source map
  // here lets the NEXT snapshot on the other listener resurrect the deleted row
  // as a zombie. Always drop an id from both sources and the merge together.
  function forgetPrintItem(id) {
    delete printQueueSources.open[id];
    delete printQueueSources.printed[id];
    delete printQueueCache[id];
  }

  async function deletePrintItem(id) {
    if (!printQueueCache[id]) throw new Error('unknown print item: ' + id);
    // Firestore FIRST and the error is NOT swallowed: a delete that didn't
    // happen must not look like it did. Deleting a 'document' item does not
    // touch its PDF in the CNC Print Queue Drive folder (retention amendment).
    if (db) await db.collection('printQueue').doc(id).delete();
    forgetPrintItem(id);
  }

  // Docs older than the window are NOT in the cache (that is the point), so
  // these two go to Firestore directly. Only a numeric printedAt below the
  // cutoff counts — an open item (null) must never be swept up, whatever the
  // range filter does with nulls.
  const isPrintedBefore = (data, cutoff) => typeof data.printedAt === 'number' && data.printedAt < cutoff;

  async function countPrintedBefore(cutoff) {
    if (!db) return Object.values(printQueueCache).filter(i => isPrintedBefore(i, cutoff)).length;
    const snap = await db.collection('printQueue').where('printedAt', '<', cutoff).get();
    return snap.docs.filter(d => isPrintedBefore(d.data() || {}, cutoff)).length;
  }

  async function clearPrintedBefore(cutoff) {
    if (!db) {
      const ids = Object.keys(printQueueCache).filter(id => isPrintedBefore(printQueueCache[id], cutoff));
      ids.forEach(forgetPrintItem);
      return ids.length;
    }
    const snap = await db.collection('printQueue').where('printedAt', '<', cutoff).get();
    const docs = snap.docs.filter(d => isPrintedBefore(d.data() || {}, cutoff));
    for (let i = 0; i < docs.length; i += 500) {          // Firestore write-batch limit
      const batch = db.batch();
      docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    docs.forEach(d => forgetPrintItem(d.id));
    return docs.length;
  }

  async function loadPrintQueue() {
    if (!db) return;
    try {
      const q = printQueueQueries();
      const [open, printed] = await Promise.all([q.open.get(), q.printed.get()]);
      applyPrintSnapshot('open', open);
      applyPrintSnapshot('printed', printed);
    } catch (e) {
      console.warn('Firestore loadPrintQueue failed:', e);
    }
  }

  function onPrintQueueChange(callback) {
    if (!db) return;
    const q = printQueueQueries();
    for (const source of ['open', 'printed']) {
      q[source].onSnapshot(snap => {
        applyPrintSnapshot(source, snap);
        callback();
      }, err => console.warn(`Firestore printQueue (${source}) listener error:`, err));
    }
  }

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, getAnnotations, setAnnotations, loadAnnotations, onAnnotationsChange, getCustomers, addCustomer, renameCustomer, removeCustomer, loadCustomers, onCustomersChange, getProjectCustomer, setProjectCustomer, loadProjectCustomers, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheets, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory, getPrintQueue, getPrintedItems, addPrintItem, markPrinted, loadPrintQueue, onPrintQueueChange, PRINT_RETENTION_DAYS, printRetentionCutoff, unmarkPrinted, deletePrintItem, countPrintedBefore, clearPrintedBefore, loadMigrationState, migrationState, sheetsFilterReady, filterActive, sortByUploadedAt, loadFinishedSheets, getSheetDoc, finishPatch, finishSheets, unfinishSheets, upsertJob, upsertJobForUpload, finishJob, reopenJob, setVanlabPrinted, clearVanlabPrinted, onJobDocChange, migrateFinishedFlag };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
