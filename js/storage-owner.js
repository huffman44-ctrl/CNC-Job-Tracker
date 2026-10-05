/**
 * js/storage-owner.js — the owner-only collections of the billing redesign (spec §5.4–5.8):
 * jobBilling/, sheetBilling/, customerBilling/, settings/. Firestore rules deny Collin every
 * one of them, so app.js initialises this module ONLY after Features.isOwner() is true — his
 * browser never asks. Same cache-plus-listener shape as storage.js; works with no db (PASTE
 * mode, tests). Writes here are NOT swallowed: every writer returns the write promise,
 * console.warns on failure and rejects, so the forms can show the real error. Every write is a
 * read-modify-write TRANSACTION on the server doc (never a rebuild from the cache — Phase 1
 * ledger must-fix); the cache is updated after the commit, not optimistically.
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
  // Per-collection: true only after a successful, non-fromCache read (or no db at all).
  const loadedFlags = {};
  function loaded(name) { return !db || loadedFlags[name] === true; }

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
    // Phase 2 (spec §15): the standard price list, QuickBooks item names, invoice numbering.
    // Per-material Taxable lives on each material (§15.8); billingStartDate (Decision 1) stays
    // null until Travis sets it.
    pricing: { defaultList: 'standard', lists: { standard: {
      handlingFirst: 60, handlingRepeat: 40, hourlyRate: 135,
      rush: { standard: 0, rush48: 0.5, rush24: 0.75 }, weekendRate: 0.5, cutMinimum: 150, roundTo: 5,
    } } },
    qbItems: { cnc: 'CNC Router Work', materials: 'Materials', taxable: { cnc: 'N', labor: 'N' } },
    invoicing: { seedNumber: 3603, weekEndingDay: 6, defaultDue: 'receipt', billingStartDate: null },
  };
  const clone = d => JSON.parse(JSON.stringify(d));

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
    names.forEach((n, i) => { loadedFlags[n] = results[i]; });
    settingsLoaded = results[names.indexOf('settings')];
    if (settingsLoaded) {
      for (const name of Object.keys(SEEDS)) { try { await ensureSeeded(name, SEEDS[name]); } catch (e) { /* already warned; keep loading */ } }
    }
    names.forEach(listen);
  }

  // An expected "no" shown to the owner — not a failure worth a console.warn.
  function refusal(message) { return Object.assign(new Error(message), { ownerRefusal: true }); }

  // Read-modify-write inside a transaction (Phase 1 ledger must-fix: never rebuild an owner doc
  // from the cache). fn receives a COPY of the current SERVER doc (or makeDefault()) and returns
  // the next doc; it may throw to abort with that message (give the error ownerRefusal: true to
  // skip the console.warn). fn can run up to 5 times — keep it pure. The cache and emit happen
  // AFTER the commit; a failure leaves the cache untouched. Resolves to the committed doc.
  async function mutate(name, id, makeDefault, fn, stamp) {
    if (!db) {
      const next = stamp(fn(clone(caches[name][id] || makeDefault())));
      caches[name][id] = next; emit(); return next;
    }
    const ref = db.collection(name).doc(id);
    let next;
    try {
      next = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const n = stamp(fn(clone(snap.exists ? snap.data() : makeDefault())));
        tx.set(ref, n);
        return n;
      });
    } catch (e) {
      if (!e || !e.ownerRefusal) console.warn(`Firestore ${name}/${id} write failed:`, e);
      throw e;
    }
    caches[name][id] = next; emit(); return next;
  }
  const stampBy = by => d => ({ ...d, updatedAt: now(), updatedBy: by || '' });

  /* ── jobBilling/{jobKey} (spec §5.4) ── */
  function getJobBilling(jobKey) { return caches.jobBilling[jobKey] || null; }
  // Read-only list of every cached jobBilling doc (Settings › Labor types asks which types are in use).
  function allJobBilling() { return Object.values(caches.jobBilling); }

  function newJobBilling(jobName) {
    return {
      jobName: jobName || '', customerKey: null, customerName: '',
      material: { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 },
      turnaround: 'standard', laborLines: [], noDesignTime: false,
      readyForBilling: false, readyAt: null, readyBy: null, thicknessIn: null,
    };
  }

  function mutateJobBilling(jobKey, fn, by) {
    return mutate('jobBilling', jobKey, () => newJobBilling(''), fn, stampBy(by));
  }

  // Field patches only. Labor lines are a list that Billing also edits (it locks lines
  // in-progress), so changing them must go through mutateJobBilling with a function that sees
  // the server doc — a patch built from the cache could overwrite a concurrent lock.
  function setJobBilling(jobKey, patch, by) {
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'laborLines')) {
      throw new Error('setJobBilling cannot write laborLines — use mutateJobBilling(jobKey, cur => ({ ...cur, laborLines }))');
    }
    return mutate('jobBilling', jobKey, () => newJobBilling(patch && patch.jobName), cur => ({ ...cur, ...patch }), stampBy(by));
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

  function newSheetBilling() {
    return { status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null };
  }
  function mutateSheetBilling(fileKey, fn, by) {
    return mutate('sheetBilling', fileKey, newSheetBilling, fn, stampBy(by));
  }
  const withRefs = (d, refs) => ({
    ...d,
    jobKey: (refs && refs.jobKey) || d.jobKey || null,
    customerKey: (refs && refs.customerKey) || d.customerKey || null,
  });
  function isRealYmd(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  // The "already priced" check runs on the SERVER doc inside the transaction. An external (no
  // charge) sheet is never billed, so its date may still be corrected.
  async function setCutDateOverride(fileKey, ymd, refs, by) {
    if (ymd != null && ymd !== '' && !isRealYmd(ymd)) throw refusal('That is not a real date (use YYYY-MM-DD).');
    return mutateSheetBilling(fileKey, cur => {
      const st = cur.status || 'unbilled';
      if (st === 'in-progress' || st === 'billed') {
        throw refusal('This sheet is already priced on an invoice — its cut date is locked.');
      }
      return withRefs({ ...cur, cutDateOverride: ymd || null }, refs);
    }, by);
  }

  // Decision 3: "no charge" marks a sheet external (never billed). Only an unbilled sheet can be
  // marked; only an external one can be put back.
  function setNoCharge(fileKey, on, refs, by) {
    return mutateSheetBilling(fileKey, cur => {
      const st = cur.status || 'unbilled';   // a stored doc with no status is unbilled
      if (on) {
        if (st !== 'unbilled') throw refusal('Only an unbilled sheet can be marked no charge (this one is ' + st + ').');
        return withRefs({ ...cur, status: 'external' }, refs);
      }
      if (st !== 'external') throw refusal('This sheet is not marked no charge.');
      return withRefs({ ...cur, status: 'unbilled' }, refs);
    }, by);
  }

  /* ── customerBilling/{customerKey} (spec §5.7) ── */
  function getCustomerBilling(customerKey) { return caches.customerBilling[customerKey] || null; }

  function newCustomerBilling() {
    return { name: '', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null };
  }
  function mutateCustomerBilling(customerKey, fn, by) {
    return mutate('customerBilling', customerKey, newCustomerBilling, fn, stampBy(by));
  }
  function setCustomerBilling(customerKey, patch, by) {
    return mutateCustomerBilling(customerKey, cur => ({ ...cur, ...patch }), by);
  }

  async function rememberMaterialDefault(customerKey, customerName, thicknessIn, material, by) {
    if (!customerKey || thicknessIn == null) return null;
    return mutateCustomerBilling(customerKey, cur => {
      const defaults = { ...(cur.defaultMaterialByThickness || {}) };
      defaults[String(thicknessIn)] = { kind: material.kind, materialId: material.materialId || null, name: material.name || '' };
      return { ...cur, name: customerName || cur.name || '', defaultMaterialByThickness: defaults };
    }, by);
  }

  /* ── settings/{name} (spec §5.8) ── */
  function getSetting(name) { return caches.settings[name] || null; }

  // Top-level keys of `data` replace the doc's keys; the rest of the SERVER doc is kept.
  function setSetting(name, data, by) {
    return mutate('settings', name, () => ({}), cur => ({ ...cur, ...data }), d => ({ ...d, savedAt: now(), savedBy: by || '' }));
  }

  // Writes the seed only when the settings load SUCCEEDED and the doc is confirmed missing.
  async function ensureSeeded(name, seed) {
    if (db && !settingsLoaded) return false;       // failed/denied/not-yet load: never seed
    if (caches.settings[name]) return false;
    const doc = { ...clone(seed), seededAt: now() };
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

  // Phase 2 readers. Seed-shaped defaults sit under the stored doc so a missing key never
  // changes a result silently — except price-list NUMBERS: priceListFor never guesses.
  function pricing() { return { defaultList: 'standard', lists: {}, ...(getSetting('pricing') || {}) }; }
  function qbItems() {
    const s = getSetting('qbItems') || {};
    return { ...clone(SEEDS.qbItems), ...s, taxable: { ...SEEDS.qbItems.taxable, ...(s.taxable || {}) } };
  }
  function invoicing() { return { ...clone(SEEDS.invoicing), ...(getSetting('invoicing') || {}) }; }
  // The customer's price list (customerBilling.priceList, else the default), or null when it is
  // not set up — Billing then shows "Price list not set up" instead of pricing from a guess.
  function priceListFor(customerKey) {
    const p = pricing();
    const cb = getCustomerBilling(customerKey);
    const list = p.lists && p.lists[(cb && cb.priceList) || p.defaultList];
    const num = v => typeof v === 'number' && Number.isFinite(v);
    const ok = list && ['handlingFirst', 'handlingRepeat', 'hourlyRate', 'weekendRate', 'cutMinimum', 'roundTo'].every(k => num(list[k]))
      && list.rush && ['standard', 'rush48', 'rush24'].every(k => num(list.rush[k]));
    return ok ? list : null;   // a partial list is "not set up", never priced from a guess
  }

  function _resetForTests() {
    Object.values(caches).forEach(c => Object.keys(c).forEach(k => delete c[k]));
    changeListeners.length = 0; db = null; settingsLoaded = false; Object.keys(loadedFlags).forEach(k => delete loadedFlags[k]);
  }
  function _seedForTests(name, id, doc) { caches[name][id] = doc; }
  // Cache-only write + emit — ONLY for InvoiceStore's no-db (PASTE/test) path.
  function _putLocal(name, id, doc) { caches[name][id] = doc; emit(); }
  // Several cache-only writes, ONE emit: [{ name, id, doc }]. Same no-db/after-commit use as _putLocal.
  function _putLocalMany(items) { items.forEach(i => { caches[i.name][i.id] = i.doc; }); emit(); }

  return { SEEDS, init, loadAll, onChange, getJobBilling, allJobBilling, newJobBilling, mutateJobBilling, setJobBilling, hasJobDetails, newLaborLine,
    getSheetBilling, mutateSheetBilling, setCutDateOverride, setNoCharge, getCustomerBilling, mutateCustomerBilling, setCustomerBilling, rememberMaterialDefault,
    getSetting, setSetting, ensureSeeded, laborTypes, materials, pricing, qbItems, invoicing, priceListFor, loaded,
    _resetForTests, _seedForTests, _putLocal, _putLocalMany };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OwnerStore;
