/**
 * Completion records: Firestore completions/{fileKey}
 * Sheet data:         Firestore sheets/{fileKey}
 *
 * Local cache enables synchronous reads so UI never blocks on Firestore.
 * All writes update the cache immediately and persist to Firestore async.
 */
const Storage = (() => {
  let db = null;
  const completionsCache = {}; // { [fileKey]: { completedAt, operator, notes } }
  const notesCache = {};       // { [noteKey]: string }
  const sheetNotesCache = {};  // { [fileKey]: string }
  const annotationsCache = {}; // { [fileKey]: Array<{type,x,y,w,h,color}> }
  const customersCache = {};        // { [key]: name }
  const projectCustomerCache = {};  // { [noteKey]: name }
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

  function getNote(noteKey) {
    return notesCache[noteKey] || null;
  }

  async function setNote(noteKey, text) {
    const trimmed = (text || '').trim();
    if (trimmed) {
      notesCache[noteKey] = trimmed;
    } else {
      delete notesCache[noteKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('projectNotes').doc(noteKey).set({ text: trimmed });
      } else {
        await db.collection('projectNotes').doc(noteKey).delete();
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

  function getProjectCustomer(noteKey) {
    return projectCustomerCache[noteKey] || null;
  }

  async function setProjectCustomer(noteKey, name) {
    const trimmed = (name || '').trim();
    if (trimmed) {
      projectCustomerCache[noteKey] = trimmed;
    } else {
      delete projectCustomerCache[noteKey];
    }
    if (!db) return;
    try {
      if (trimmed) {
        await db.collection('projectCustomer').doc(noteKey).set({ name: trimmed });
      } else {
        await db.collection('projectCustomer').doc(noteKey).delete();
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

  async function loadSheets() {
    if (!db) return [];
    try {
      const snap = await db.collection('sheets').orderBy('uploadedAt').get();
      return snap.docs.map(doc => doc.data());
    } catch (e) {
      console.warn('Firestore loadSheets failed:', e);
      return [];
    }
  }

  function onSheetsChange(callback) {
    if (!db) return;
    db.collection('sheets').onSnapshot(snap => {
      // Sort client-side rather than orderBy('uploadedAt') — a query orderBy
      // silently excludes docs missing the field (and pending serverTimestamps
      // on the writing device); nulls sort last here instead of disappearing.
      const docs = snap.docs.map(doc => doc.data());
      docs.sort((a, b) => {
        const ta = a.uploadedAt?.toMillis?.() ?? Infinity;
        const tb = b.uploadedAt?.toMillis?.() ?? Infinity;
        return ta - tb;
      });
      callback(docs);
    }, err => console.warn('Firestore sheets listener error:', err));
  }

  async function deleteSheet(fileKey) {
    if (!db) return;
    try {
      await db.collection('sheets').doc(fileKey).delete();
    } catch (e) {
      console.warn('Firestore deleteSheet failed:', e);
    }
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

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, getAnnotations, setAnnotations, loadAnnotations, onAnnotationsChange, getCustomers, addCustomer, renameCustomer, removeCustomer, loadCustomers, onCustomersChange, getProjectCustomer, setProjectCustomer, loadProjectCustomers, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions, saveTicketRecord, loadTicketHistory, getPrintQueue, getPrintedItems, addPrintItem, markPrinted, loadPrintQueue, onPrintQueueChange, PRINT_RETENTION_DAYS, printRetentionCutoff };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Storage;
