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

  return { init, get, set, clear, clearAll, loadCompletions, onCompletionChange, getNote, setNote, loadNotes, onNoteChange, getSheetNote, setSheetNote, loadSheetNotes, onSheetNoteChange, saveSheet, setArchiveUrl, loadSheets, onSheetsChange, deleteSheet, clearSheets, clearAllCompletions };
})();
