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

  /* ── Sheets ── */

  async function saveSheet(sheet) {
    if (!db) return;
    try {
      await db.collection('sheets').doc(sheet.fileKey).set({
        fileKey:      sheet.fileKey,
        fileName:     sheet.fileName     || '',
        sheetTitle:   sheet.sheetTitle   || '',
        jobName:      sheet.jobName      || '',
        totalTime:    sheet.totalTime    || '',
        toolpaths:    sheet.toolpaths    || [],
        materialInfo: sheet.materialInfo || [],
        layoutSvg:    sheet.layoutSvg    || '',
        uploadedAt:   firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn('Firestore saveSheet failed:', e);
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

  /* ── CSV helper (kept for compatibility) ── */
  function exportCSV(fileKey, sections) {
    const rows = [['Section', 'Toolpath', 'Tool', 'Time Estimate', 'Completed At', 'Operator', 'Notes']];
    for (const section of sections) {
      if (section.type !== 'toolpaths') continue;
      for (const item of section.items) {
        const rec = get(fileKey, item.id);
        rows.push([section.title, item.name, item.tool, item.timeEstimate,
          rec ? rec.completedAt : '', rec ? (rec.operator || '') : '', rec ? (rec.notes || '') : '']);
      }
    }
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  }

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, saveSheet, loadSheets, deleteSheet, clearSheets, clearAllCompletions, exportCSV };
})();
