/**
 * js/storage-owner.js — the owner-only collections of the billing redesign (spec §5.4–5.8):
 * jobBilling/, sheetBilling/, customerBilling/, settings/. Firestore rules deny Collin every
 * one of them, so app.js initialises this module ONLY after Features.isOwner() is true — his
 * browser never asks. Same cache-plus-listener shape as storage.js; works with no db (PASTE
 * mode, tests). Writes here are NOT swallowed: every writer returns the write promise,
 * console.warns on failure and rejects, so the forms can show the real error. The cache is
 * updated optimistically first; the realtime listener corrects it if the write is refused.
 * Phase 1 writes job details, labor lines, ready state, cut-date corrections, the
 * billed-outside flag and settings. Phase 2 adds invoices/ and the billing writes.
 */
const OwnerStore = (() => {
  let db = null;
  const caches = { jobBilling: {}, sheetBilling: {}, customerBilling: {}, settings: {} };
  const changeListeners = [];
  // True only when the settings collection was actually read (or there is no db at all).
  // Seeding is allowed only then: seeding after a failed/denied load would overwrite the
  // real settings with defaults.
  let settingsLoaded = false;

  // Seeded once, on the first owner sign-in after Phase 1 ships (Travis's 2026-10-04 answers:
  // Design $150 / 1 h minimum, CAM $85 / 0.5 h minimum, both the QuickBooks item "Digital
  // Design"). From then on the numbers live in Firestore and Settings › Labor types (Phase 2)
  // edits them. Never read SEEDS for a price — read settings/laborTypes.
  const SEEDS = {
    laborTypes: { types: [
      { id: 'design', name: 'Design', rate: 150, minHours: 1,   qbItem: 'Digital Design' },
      { id: 'cam',    name: 'CAM',    rate: 85,  minHours: 0.5, qbItem: 'Digital Design' },
    ] },
    materials: { items: [] },
  };

  function init(firestore) { db = firestore; }
  function onChange(cb) { changeListeners.push(cb); }
  function emit() { changeListeners.forEach(cb => { try { cb(); } catch (e) { console.warn('OwnerStore listener threw:', e); } }); }
  const now = () => Date.now();

  // Resolves true when the collection was read, false when the read failed.
  async function loadCollection(name) {
    if (!db) return true;
    try {
      const snap = await db.collection(name).get();
      snap.forEach(doc => { caches[name][doc.id] = doc.data(); });
      // Firestore compat get() does not reject offline: it resolves from the local cache.
      // A cache-only answer is not proof the doc is missing, so it counts as a failed load.
      if (snap.metadata && snap.metadata.fromCache) {
        console.warn(`Firestore ${name} load came from cache only (offline?) — treating as failed`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn(`Firestore ${name} load failed:`, e);
      return false;
    }
  }

  function listen(name) {
    if (!db) return;
    db.collection(name).onSnapshot(snap => {
      Object.keys(caches[name]).forEach(k => delete caches[name][k]);
      snap.forEach(doc => { caches[name][doc.id] = doc.data(); });
      emit();
    }, err => console.warn(`Firestore ${name} listener error:`, err));
  }

  async function loadAll() {
    const names = Object.keys(caches);
    const results = await Promise.all(names.map(loadCollection));
    settingsLoaded = results[names.indexOf('settings')];
    if (settingsLoaded) {
      for (const name of Object.keys(SEEDS)) { try { await ensureSeeded(name, SEEDS[name]); } catch (e) { /* already warned; keep loading */ } }
    }
    names.forEach(listen);
  }

  // Optimistic cache update, then the Firestore write. Returns the write promise (resolves to
  // the doc); a failed write warns and rejects so callers can show the error.
  async function write(name, id, doc) {
    caches[name][id] = doc;
    emit();
    if (db) {
      try {
        await db.collection(name).doc(id).set(doc);
      } catch (e) {
        console.warn(`Firestore ${name}/${id} write failed:`, e);
        throw e;
      }
    }
    return doc;
  }

  /* ── jobBilling/{jobKey} (spec §5.4) ── */
  function getJobBilling(jobKey) { return caches.jobBilling[jobKey] || null; }

  function newJobBilling(jobName) {
    return {
      jobName: jobName || '', customerKey: null, customerName: '',
      material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 },
      turnaround: 'standard', laborLines: [], noDesignTime: false,
      readyForBilling: false, readyAt: null, readyBy: null, thicknessIn: null,
    };
  }

  function setJobBilling(jobKey, patch, by) {
    const base = caches.jobBilling[jobKey] || newJobBilling(patch && patch.jobName);
    return write('jobBilling', jobKey, { ...base, ...patch, updatedAt: now(), updatedBy: by || '' });
  }

  function hasJobDetails(jobKey) {
    const jb = getJobBilling(jobKey);
    return !!(jb && jb.customerName && jb.material && jb.material.kind && jb.turnaround);
  }

  // typeName is a snapshot of the labor type's display name at entry time (spec §5.4).
  function newLaborLine(typeId, hours, note, by, typeName) {
    return {
      id: 'll_' + now().toString(36) + Math.random().toString(36).slice(2, 6),
      typeId, typeName: typeName || ((laborTypes().find(t => t.id === typeId) || {}).name) || '', hours: Number(hours), note: note || '', enteredBy: by || '', enteredAt: now(),
      status: 'unbilled', invoiceNumber: null, billedAt: null,
    };
  }

  /* ── sheetBilling/{fileKey} (spec §5.1, §5.5) — flat fields; no doc = unbilled ── */
  function getSheetBilling(fileKey) { return caches.sheetBilling[fileKey] || null; }

  async function setCutDateOverride(fileKey, ymd, refs, by) {
    const existing = caches.sheetBilling[fileKey];
    if (existing && (existing.status === 'in-progress' || existing.status === 'billed')) {
      throw new Error('This sheet is already priced on an invoice — its cut date is locked.');
    }
    const base = existing || { status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null };
    return write('sheetBilling', fileKey, {
      ...base, cutDateOverride: ymd || null,
      jobKey: (refs && refs.jobKey) || base.jobKey || null,
      customerKey: (refs && refs.customerKey) || base.customerKey || null,
      updatedAt: now(), updatedBy: by || '',
    });
  }

  /* ── customerBilling/{customerKey} (spec §5.7) ── */
  function getCustomerBilling(customerKey) { return caches.customerBilling[customerKey] || null; }

  function setCustomerBilling(customerKey, patch, by) {
    const base = caches.customerBilling[customerKey] || { name: '', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '' };
    return write('customerBilling', customerKey, { ...base, ...patch, updatedAt: now(), updatedBy: by || '' });
  }

  async function rememberMaterialDefault(customerKey, customerName, thicknessIn, material) {
    if (!customerKey || thicknessIn == null) return null;
    const base = getCustomerBilling(customerKey) || {};
    const defaults = { ...(base.defaultMaterialByThickness || {}) };
    defaults[String(thicknessIn)] = { kind: material.kind, materialId: material.materialId || null, name: material.name || '' };
    return setCustomerBilling(customerKey, { name: customerName || base.name || '', defaultMaterialByThickness: defaults }, '');
  }

  /* ── settings/{name} (spec §5.8) ── */
  function getSetting(name) { return caches.settings[name] || null; }

  function setSetting(name, data, by) {
    return write('settings', name, { ...(caches.settings[name] || {}), ...data, savedAt: now(), savedBy: by || '' });
  }

  // Writes the seed only when the settings load SUCCEEDED and the doc is confirmed missing.
  async function ensureSeeded(name, seed) {
    if (db && !settingsLoaded) return false;       // failed/denied/not-yet load: never seed
    if (caches.settings[name]) return false;
    const doc = { ...seed, seededAt: now() };
    caches.settings[name] = doc;
    if (db) {
      try {
        // Transaction: re-reads the doc and sets only if it does not exist. Transactions fail
        // offline and close the race of two owners signing in at once.
        const ref = db.collection('settings').doc(name);
        const created = await db.runTransaction(tx => tx.get(ref).then(snap => {
          if (snap.exists) return false;
          tx.set(ref, doc);
          return true;
        }));
        if (!created) { delete caches.settings[name]; return false; }   // listener fills in the real doc
      } catch (e) {
        console.warn(`Firestore settings/${name} seed failed:`, e);
        delete caches.settings[name];
        throw e;
      }
    }
    return true;
  }

  function laborTypes() { const s = getSetting('laborTypes'); return s && Array.isArray(s.types) ? s.types : []; }
  function materials() { const s = getSetting('materials'); return s && Array.isArray(s.items) ? s.items : []; }

  function _resetForTests() {
    Object.values(caches).forEach(c => Object.keys(c).forEach(k => delete c[k]));
    changeListeners.length = 0; db = null; settingsLoaded = false;
  }
  function _seedForTests(name, id, doc) { caches[name][id] = doc; }

  return { SEEDS, init, loadAll, onChange, getJobBilling, newJobBilling, setJobBilling, hasJobDetails, newLaborLine,
    getSheetBilling, setCutDateOverride, getCustomerBilling, setCustomerBilling, rememberMaterialDefault,
    getSetting, setSetting, ensureSeeded, laborTypes, materials, _resetForTests, _seedForTests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OwnerStore;
