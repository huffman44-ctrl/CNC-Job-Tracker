/**
 * js/invoice-store.js — Billing's invoice lifecycle. THIS FILE (Task 8) holds only the pure
 * planners: lock / Imported OK / Cancel / Add PO. Each is (docs, args) → { writes, invoice } and
 * throws Object.assign(new Error(text), { code }) on a refusal. No Firestore, no DOM, no clock —
 * `docs` is plain data the executor read, `now` and `by` are passed in.
 *
 * Every write's `doc` is the FULL next document: the doc as it was read with this change merged on
 * top, so the executor's whole-doc set never drops a field and the Firestore rules (which diff
 * the stored doc against the new one) see only the intended keys change. Rule summary in HQ/firestore.rules.
 */
const InvoiceStore = (() => {
  const L = typeof LogRows !== 'undefined' ? LogRows : require('./log-rows.js');

  const MAX_SHEETS = 400;   // 1 invoice + sheets + jobs + customer must stay under the 500-write transaction cap

  const refuse = (code, text) => Object.assign(new Error(text), { code });
  const nz = v => (v === undefined ? null : v);
  const same = (a, b) => nz(a) === nz(b);
  const status = doc => (doc && doc.status) || 'unbilled';

  // Same shapes as OwnerStore's new*Billing defaults (kept local so the planners stay pure).
  const sheetDefault = () => ({ status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null });
  const customerDefault = () => ({ name: '', billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null });

  // Firestore set() rejects undefined anywhere in a doc: turn any undefined into null (deep).
  const clean = v => {
    if (v === undefined) return null;
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = clean(v[k]); return o; }
    return v;
  };
  const w = (col, id, doc) => ({ col, id: String(id), doc: clean(doc) });
  const stamp = (doc, by, now) => ({ ...doc, updatedAt: now, updatedBy: by });

  function dateText(inv) {
    const v = inv.invoiceDate || inv.createdAt;
    let d = null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) d = new Date(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10));
    else if (v != null) d = new Date(v);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  }

  // Lines of one job doc: replace those matched by `pick(line)` with `fn(line)`; null when none matched.
  function mapLines(jobDoc, pick, fn) {
    let hit = false;
    const laborLines = (jobDoc.laborLines || []).map(l => { if (pick(l)) { hit = true; return fn(l); } return l; });
    return hit ? { ...jobDoc, laborLines } : null;
  }

  /* ── lock ── */
  function planLock(docs, { draft, by, now }) {
    const number = Number(draft.number);
    if (!Number.isInteger(number) || number <= 0) throw refuse('bad-draft', 'The invoice number is not a whole number above zero.');
    if ((draft.sheetKeys || []).length > MAX_SHEETS) {
      throw refuse('too-big', `That is ${draft.sheetKeys.length} sheets — an invoice holds at most ${MAX_SHEETS}. Bill fewer jobs at a time.`);
    }
    for (const k of draft.sheetKeys || []) {
      if (!(draft.perSheet || {})[k] || !draft.perSheet[k].row) throw refuse('bad-draft', 'The invoice draft is missing the lock-time row for sheet ' + k + '.');
    }
    const prev = docs.invoice || null;
    if (prev && prev.status !== 'cancelled') {
      throw refuse('number-used', `${number} is already on ${prev.customerName || 'another customer'} (${dateText(prev)}). Use another number.`);
    }
    const customer = docs.customer || null;
    const open = customer && customer.openInvoice;
    if (open != null && Number(open) !== number) {
      throw refuse('customer-busy', `Finish invoice ${open} first — Imported OK or Cancel.`);
    }
    if (draft.sheetKeys.length > MAX_SHEETS) {
      throw refuse('too-big', `That is ${draft.sheetKeys.length} sheets — an invoice holds at most ${MAX_SHEETS}. Bill fewer jobs at a time.`);
    }
    const taken = draft.sheetKeys.filter(k => status((docs.sheetBilling || {})[k]) !== 'unbilled');
    if (taken.length) {
      const num = (docs.sheetBilling[taken[0]] || {}).invoiceNumber;
      const many = taken.length === 1 ? '1 of these sheets was' : `${taken.length} of these sheets were`;
      throw refuse('sheet-taken', num != null ? `${many} just put on invoice ${num}.` : `${many} just marked No charge or put on another invoice.`);
    }
    const changed = () => refuse('changed', 'Something changed since this screen was drawn — check the total and click again.');
    const fp = draft.fingerprint || { sheets: {}, jobs: {} };
    for (const k of draft.sheetKeys) {
      const f = (fp.sheets || {})[k] || {};
      const comp = (docs.completions || {})[k];
      const sb = (docs.sheetBilling || {})[k];
      if (!same(comp && comp.completedAt, f.completedAt)) throw changed();
      if (!same(sb && sb.cutDateOverride, f.cutDateOverride)) throw changed();
    }
    const refsByJob = {};
    for (const r of draft.laborLineRefs || []) (refsByJob[r.jobKey] = refsByJob[r.jobKey] || []).push(r.lineId);
    const jobKeys = new Set([...Object.keys(fp.jobs || {}), ...Object.keys(refsByJob), ...draft.sheetKeys.map(k => draft.perSheet[k].jobKey).filter(Boolean)]);
    for (const jk of jobKeys) {
      const jf = (fp.jobs || {})[jk] || {};
      const jd = (docs.jobBilling || {})[jk];
      if (!jd) throw changed();
      const m = jd.material || {};
      if (!same(jd.turnaround, jf.turnaround) || !same(m.kind, jf.materialKind) || !same(m.materialId, jf.materialId)
        || !same(m.pricePerSheet, jf.pricePerSheet)) throw changed();
      const ids = refsByJob[jk] || [];
      if (ids.length && !same(!!jd.readyForBilling, !!jf.readyForBilling)) throw changed();
      for (const id of ids) {
        const line = (jd.laborLines || []).find(l => l.id === id);
        const lf = (jf.labor || {})[id];
        if (!line || !lf || status(line) !== 'unbilled' || !same(line.hours, lf.hours) || !same(line.typeId, lf.typeId)) throw changed();
      }
    }

    const { fingerprint, ...rest } = draft;
    const invoice = {
      ...(prev || {}), ...rest, number,
      status: 'in-progress',
      createdAt: prev ? prev.createdAt : now, createdBy: prev ? prev.createdBy : by,
      downloadedAt: now, downloadedBy: by,
      importedAt: null, importedBy: null, cancelledAt: null, cancelledBy: null, poAddedAt: null, poAddedBy: null,
      logWritten: false, logError: null, logWrittenAt: null,
      history: prev ? [...(prev.history || []), { status: nz(prev.status), customerName: nz(prev.customerName), total: nz(prev.total), sheetKeys: nz(prev.sheetKeys), cancelledAt: nz(prev.cancelledAt), cancelledBy: nz(prev.cancelledBy) }] : [],
      updatedAt: now, updatedBy: by,
    };
    const writes = [w('invoices', number, invoice)];
    for (const k of draft.sheetKeys) {
      const cur = (docs.sheetBilling || {})[k] || sheetDefault();
      const jobKey = (draft.perSheet[k] || {}).jobKey || cur.jobKey || null;
      writes.push(w('sheetBilling', k, stamp({ ...cur, status: 'in-progress', invoiceNumber: number, jobKey, customerKey: draft.customerKey, lockedAt: now, lockedBy: by }, by, now)));
    }
    for (const jk of Object.keys(refsByJob)) {
      const ids = refsByJob[jk];
      const next = mapLines(docs.jobBilling[jk], l => ids.includes(l.id), l => ({ ...l, status: 'in-progress', invoiceNumber: number }));
      if (next) writes.push(w('jobBilling', jk, stamp(next, by, now)));
    }
    writes.push(w('customerBilling', draft.customerKey, stamp({ ...(customer || customerDefault()), openInvoice: number }, by, now)));
    if (writes.length > 500) throw refuse('too-big', `That invoice needs ${writes.length} writes — the limit is 500. Bill fewer jobs at a time.`);
    return { writes, invoice: writes[0].doc };
  }

  /* ── shared pieces of import / cancel ── */
  function needInProgress(docs, number) {
    const inv = docs.invoice;
    if (!inv || inv.status !== 'in-progress') {
      throw refuse('state', `Invoice ${number} is ${inv ? inv.status : 'not found'}, not in progress.`);
    }
    return inv;
  }
  const onThis = (doc, number, st) => doc && status(doc) === st && Number(doc.invoiceNumber) === number;

  function customerClosed(docs, number, by, now, writes) {
    const c = docs.customer;
    if (c && c.openInvoice != null && Number(c.openInvoice) === number) {
      writes.push(w('customerBilling', docs.invoice.customerKey, stamp({ ...c, openInvoice: null }, by, now)));
    }
  }

  function lineWrites(docs, inv, number, by, now, fn, writes) {
    const byJob = {};
    for (const r of inv.laborLineRefs || []) (byJob[r.jobKey] = byJob[r.jobKey] || []).push(r.lineId);
    for (const jk of Object.keys(byJob)) {
      const jd = (docs.jobBilling || {})[jk];
      if (!jd) continue;
      const next = mapLines(jd, l => byJob[jk].includes(l.id) && onThis(l, number, 'in-progress'), fn);
      if (next) writes.push(w('jobBilling', jk, stamp(next, by, now)));
    }
  }

  /* ── Imported OK ── */
  function planImport(docs, { number, by, now }) {
    number = Number(number);
    const inv = needInProgress(docs, number);
    for (const k of inv.sheetKeys) {
      if (!onThis((docs.sheetBilling || {})[k], number, 'in-progress')) {
        throw refuse('state', `A sheet on invoice ${number} is no longer in progress on it — refresh and check.`);
      }
    }
    for (const r of inv.laborLineRefs || []) {
      const jd = (docs.jobBilling || {})[r.jobKey];
      const line = jd && (jd.laborLines || []).find(l => l.id === r.lineId);
      if (!onThis(line, number, 'in-progress')) {
        throw refuse('state', `A labor line on invoice ${number} is no longer in progress on it — refresh and check.`);
      }
    }
    const next = { ...inv, status: 'imported', importedAt: now, importedBy: by, updatedAt: now, updatedBy: by };
    const writes = [w('invoices', number, next)];
    for (const k of inv.sheetKeys) {
      const snap = (inv.perSheet || {})[k] || {};
      writes.push(w('sheetBilling', k, stamp({ ...docs.sheetBilling[k], status: 'billed', billedAt: now, cutAtBilled: nz(snap.cutAt), priced: nz(snap.priced), poNumber: inv.poNumber || null }, by, now)));
    }
    lineWrites(docs, inv, number, by, now, l => ({ ...l, status: 'billed', billedAt: now }), writes);
    customerClosed(docs, number, by, now, writes);
    return { writes, invoice: writes[0].doc };
  }

  /* ── Cancel ── */
  function planCancel(docs, { number, by, now }) {
    number = Number(number);
    const inv = needInProgress(docs, number);
    const next = { ...inv, status: 'cancelled', cancelledAt: now, cancelledBy: by, updatedAt: now, updatedBy: by };
    const writes = [w('invoices', number, next)];
    for (const k of inv.sheetKeys) {
      const cur = (docs.sheetBilling || {})[k];
      if (onThis(cur, number, 'in-progress')) {
        writes.push(w('sheetBilling', k, stamp({ ...cur, status: 'unbilled', invoiceNumber: null, lockedAt: null, lockedBy: null }, by, now)));
      }
    }
    lineWrites(docs, inv, number, by, now, l => ({ ...l, status: 'unbilled', invoiceNumber: null }), writes);
    customerClosed(docs, number, by, now, writes);
    return { writes, invoice: writes[0].doc };
  }

  /* ── Add PO (imported invoices only) ── */
  function planAddPo(docs, { number, po, by, now }) {
    number = Number(number);
    const inv = docs.invoice;
    if (!inv || inv.status !== 'imported') {
      throw refuse('state', `A PO number can only be added to an imported invoice (invoice ${number} is ${inv ? inv.status : 'not found'}).`);
    }
    const poNumber = String(po == null ? '' : po).trim();
    if (!poNumber) throw refuse('po-empty', 'Type the PO number first.');
    const next = { ...inv, poNumber, poAddedAt: now, poAddedBy: by, updatedAt: now, updatedBy: by };
    const writes = [w('invoices', number, next)];
    for (const k of inv.sheetKeys) {
      const cur = (docs.sheetBilling || {})[k];
      if (onThis(cur, number, 'billed')) writes.push(w('sheetBilling', k, stamp({ ...cur, poNumber }, by, now)));
    }
    return { writes, invoice: writes[0].doc };
  }

  // The Master Job Log rows for an invoice: the lock-time row of each sheet (so column F is the
  // cut time it was priced on) plus K = number, L = PO when there is one, N = 'Y' (Decision 5).
  function logRowsFor(invoice) {
    return invoice.sheetKeys.map(k => L.withBilling(invoice.perSheet[k].row, { invoiceNumber: invoice.number, poNumber: invoice.poNumber, billed: 'Y' }));
  }

  /* ══ Executors (Task 9): Firestore transactions around the planners above ══ */
  const OS = () => (typeof OwnerStore !== 'undefined' ? OwnerStore : require('./storage-owner.js'));
  const OFFLINE_REASON = "Master Job Log connection isn't set up on this computer";
  let db = null;
  let deps = {};
  const cache = {};                 // number(string) -> invoice doc
  const listeners = [];
  const unsubs = [];
  const loadedFlags = { one: false, recent: false, prog: false };   // `one` is informational; loaded() uses recent && prog
  const nowMs = () => Date.now();
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

  function init(firestore, d) { db = firestore || null; deps = d || {}; }
  function onChange(cb) { listeners.push(cb); }
  function emit() { listeners.forEach(cb => { try { cb(); } catch (e) { console.warn('InvoiceStore listener threw:', e); } }); }
  // Live listeners only: the one-time startup read may fail or come from cache and never recovers.
  const loaded = () => !db || (loadedFlags.recent && loadedFlags.prog);
  const putCache = doc => { cache[String(doc.number)] = clone(doc); };
  const hasDatabase = () => (deps.hasDatabase ? !!deps.hasDatabase() : !!db);

  function absorb(snap) {
    snap.forEach(d => { const v = d.data(); if (v && v.number != null) putCache(v); });
    emit();
  }

  async function loadAll() {
    if (!db) { loadedFlags.one = loadedFlags.recent = loadedFlags.prog = true; return true; }
    unsubs.splice(0).forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    let ok = false;
    try {
      const snap = await db.collection('invoices').orderBy('number', 'desc').limit(40).get();
      absorb(snap);
      ok = !(snap.metadata && snap.metadata.fromCache);
    } catch (e) { console.warn('InvoiceStore load failed:', e); }
    loadedFlags.one = ok; loadedFlags.recent = false; loadedFlags.prog = false;
    const onErr = e => console.warn('InvoiceStore listener error:', e);
    const flagOf = snap => !(snap.metadata && snap.metadata.fromCache);
    unsubs.push(db.collection('invoices').orderBy('number', 'desc').limit(40).onSnapshot(snap => { loadedFlags.recent = flagOf(snap); absorb(snap); }, onErr));
    unsubs.push(db.collection('invoices').where('status', '==', 'in-progress').onSnapshot(snap => {
      loadedFlags.prog = flagOf(snap);
      absorb(snap);
      // A cached in-progress invoice that left this query (another owner imported/cancelled it) is re-read.
      const ids = new Set(); snap.forEach(d => ids.add(d.id));
      all().filter(i => i.status === 'in-progress' && !ids.has(String(i.number))).forEach(i => {
        db.collection('invoices').doc(String(i.number)).get().then(s => { if (s.exists) { putCache(s.data()); emit(); } }).catch(onErr);
      });
    }, onErr));
    emit();
    return ok;
  }

  const all = () => Object.values(cache);
  const get = number => cache[String(number)] || null;
  const inProgress = () => all().filter(i => i.status === 'in-progress').sort((a, b) => a.number - b.number);
  const recentImported = (n = 20) => all().filter(i => i.status === 'imported').sort((a, b) => b.number - a.number).slice(0, n);

  function suggestNumber() {
    const top = all().reduce((m, i) => Math.max(m, Number(i.number) || 0), 0);
    return Math.max(top, Number(OS().invoicing().seedNumber) || 0) + 1;
  }

  async function checkNumber(n) {
    const s = String(n == null ? '' : n).trim();
    if (!/^[1-9]\d*$/.test(s)) return { state: 'invalid' };
    let inv;
    // 'unknown' = the answer came from the offline cache, so the number could not be checked.
    if (db) { const snap = await db.collection('invoices').doc(s).get(); if (snap.metadata && snap.metadata.fromCache) return { state: 'unknown' }; inv = snap.exists ? snap.data() : null; }
    else inv = get(s);
    if (!inv) return { state: 'free' };
    return inv.status === 'cancelled' ? { state: 'cancelled', invoice: inv } : { state: 'used', invoice: inv };
  }

  // A reader over either a transaction (db) or the local caches (no db): read(col, id) -> doc | null.
  function readerFor(tx) {
    if (tx) return async (col, id) => { const s = await tx.get(db.collection(col).doc(String(id))); return s.exists ? s.data() : null; };
    const completion = deps.getCompletion || (k => (typeof Storage !== 'undefined' ? Storage.get(k) : null));
    return async (col, id) => {
      id = String(id);
      if (col === 'invoices') return clone(get(id));
      if (col === 'sheetBilling') return clone(OS().getSheetBilling(id));
      if (col === 'jobBilling') return clone(OS().getJobBilling(id));
      if (col === 'customerBilling') return clone(OS().getCustomerBilling(id));
      if (col === 'completions') return clone(completion(id)) || null;
      return null;
    };
  }
  async function mapRead(read, col, ids) {
    const out = {};
    for (const id of ids) out[id] = await read(col, id);
    return out;
  }
  function jobKeysOf(inv, fpJobs) {
    const s = new Set(Object.keys(fpJobs || {}));
    for (const r of inv.laborLineRefs || []) s.add(r.jobKey);
    for (const k of inv.sheetKeys || []) { const jk = ((inv.perSheet || {})[k] || {}).jobKey; if (jk) s.add(jk); }
    return [...s];
  }

  // Each gather reads everything its planner needs (all reads before any write).
  async function gatherLock(read, { draft }) {
    return {
      invoice: await read('invoices', Number(draft.number)),
      customer: await read('customerBilling', draft.customerKey),
      sheetBilling: await mapRead(read, 'sheetBilling', draft.sheetKeys || []),
      completions: await mapRead(read, 'completions', draft.sheetKeys || []),
      jobBilling: await mapRead(read, 'jobBilling', jobKeysOf(draft, (draft.fingerprint || {}).jobs)),
    };
  }
  async function gatherStored(read, { number }) {
    const invoice = await read('invoices', Number(number));
    if (!invoice) return { invoice: null };
    return {
      invoice,
      customer: await read('customerBilling', invoice.customerKey),
      sheetBilling: await mapRead(read, 'sheetBilling', invoice.sheetKeys || []),
      jobBilling: await mapRead(read, 'jobBilling', jobKeysOf(invoice)),
    };
  }

  function afterCommit(plan) {
    const owner = [];
    for (const wr of plan.writes) {
      if (wr.col === 'invoices') putCache(wr.doc);
      else owner.push({ name: wr.col, id: wr.id, doc: clone(wr.doc) });
    }
    OS()._putLocalMany(owner);   // immediate screen update, one emit
    emit();
  }

  async function execute(gatherFn, planner, args) {
    if (db) {
      let plan;
      await db.runTransaction(async tx => {
        const docs = await gatherFn(readerFor(tx), args);
        plan = planner(docs, { ...args, now: nowMs() });
        plan.writes.forEach(wr => tx.set(db.collection(wr.col).doc(wr.id), wr.doc));
      });
      afterCommit(plan);
      return plan.invoice;
    }
    const docs = await gatherFn(readerFor(null), args);
    const plan = planner(docs, { ...args, now: nowMs() });
    afterCommit(plan);
    return plan.invoice;
  }

  const lockAndCreate = async (draft, by) => {
    const n = Number(draft && draft.number);
    if (!draft || !draft.customerKey || !Number.isInteger(n) || n <= 0) throw refuse('bad-draft', 'The invoice draft needs a customer and a whole invoice number above zero.');
    return execute(gatherLock, planLock, { draft, by });
  };
  const cancel = (number, by) => execute(gatherStored, planCancel, { number, by });

  // The money change has committed; a failure of the log update must not look like a failed import.
  async function finishLog(inv, by) {
    try { return await writeBack(inv.number, by, inv); }
    catch (e) {
      const next = { ...inv, logWritten: false, logError: String((e && e.message) || e || 'Master Job Log update failed') };
      putCache(next); emit();   // local only, so Retry log update shows
      return next;
    }
  }
  async function markImported(number, by) { return finishLog(await execute(gatherStored, planImport, { number, by }), by); }
  async function addPo(number, po, by) { return finishLog(await execute(gatherStored, planAddPo, { number, po, by }), by); }

  // Master Job Log write-back. Never changes money state: the invoice stays imported either way.
  // Only logWritten/logError/logWrittenAt/updatedAt/updatedBy change (rules hasOnly).
  // `committed` = the invoice just written by markImported/addPo (rows are built from it). Retry passes nothing
  // and reads the stored invoice from the server (db) or the cache (no db).
  async function writeBack(number, by, committed) {
    number = Number(number);
    let cur = committed || null;
    if (cur) { /* use as given */ } else if (db) { const s = await db.collection('invoices').doc(String(number)).get(); cur = s.exists ? s.data() : null; }
    else cur = get(number);
    if (!cur) throw refuse('state', `Invoice ${number} was not found.`);
    if (cur.status !== 'imported') throw refuse('state', `Invoice ${number} is ${cur.status}, not imported.`);
    let patch;
    if (!(cur.sheetKeys || []).length) patch = { logWritten: true, logError: null, logWrittenAt: nowMs() };
    else {
      try {
        const token = await deps.getIdToken();
        const res = await deps.upsertLogRows(logRowsFor(cur), token);
        if (res && res.ok !== false && (!res.offline || !hasDatabase())) patch = { logWritten: true, logError: null, logWrittenAt: nowMs() };
        else if (res && res.offline) patch = { logWritten: false, logError: OFFLINE_REASON };
        else patch = { logWritten: false, logError: String((res && (res.error || res.message)) || 'The Master Job Log did not accept the rows') };
      } catch (e) {
        patch = { logWritten: false, logError: String((e && e.message) || e || 'Master Job Log update failed') };
      }
    }
    const apply = base => ({ ...base, ...patch, updatedAt: nowMs(), updatedBy: by });
    if (db) {
      let next;
      await db.runTransaction(async tx => {
        const ref = db.collection('invoices').doc(String(number));
        const s = await tx.get(ref);
        const base = s.exists ? s.data() : null;
        if (!base || base.status !== 'imported') throw refuse('state', `Invoice ${number} is no longer imported.`);
        next = apply(base);
        tx.set(ref, next);
      });
      putCache(next); emit();
      return next;
    }
    const next = apply(cur);
    putCache(next); emit();
    return next;
  }

  function _resetForTests() {
    Object.keys(cache).forEach(k => delete cache[k]);
    listeners.length = 0; unsubs.splice(0).forEach(u => u()); db = null; deps = {}; loadedFlags.one = loadedFlags.recent = loadedFlags.prog = false;
  }

  return {
    _plan: { lock: planLock, import: planImport, cancel: planCancel, addPo: planAddPo }, logRowsFor,
    init, loadAll, onChange, loaded, get, inProgress, recentImported, suggestNumber, checkNumber,
    lockAndCreate, markImported, cancel, addPo, writeBack, _resetForTests,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InvoiceStore;
