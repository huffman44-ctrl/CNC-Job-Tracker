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

  const w = (col, id, doc) => ({ col, id: String(id), doc });
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
      throw refuse('sheet-taken', (taken.length === 1 ? '1 of these sheets was' : `${taken.length} of these sheets were`)
        + ' just put on invoice ' + (num != null ? num : 'another invoice') + '.');
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
    const jobKeys = new Set([...Object.keys(fp.jobs || {}), ...Object.keys(refsByJob)]);
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
      history: prev ? [...(prev.history || []), { status: prev.status, customerName: prev.customerName, total: prev.total, sheetKeys: prev.sheetKeys, cancelledAt: prev.cancelledAt, cancelledBy: prev.cancelledBy }] : [],
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
    return { writes, invoice };
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
    const next = { ...inv, status: 'imported', importedAt: now, importedBy: by, updatedAt: now, updatedBy: by };
    const writes = [w('invoices', number, next)];
    for (const k of inv.sheetKeys) {
      const snap = (inv.perSheet || {})[k] || {};
      writes.push(w('sheetBilling', k, stamp({ ...docs.sheetBilling[k], status: 'billed', billedAt: now, cutAtBilled: nz(snap.cutAt), priced: nz(snap.priced), poNumber: inv.poNumber || null }, by, now)));
    }
    lineWrites(docs, inv, number, by, now, l => ({ ...l, status: 'billed', billedAt: now }), writes);
    customerClosed(docs, number, by, now, writes);
    return { writes, invoice: next };
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
    return { writes, invoice: next };
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
    return { writes, invoice: next };
  }

  // The Master Job Log rows for an invoice: the lock-time row of each sheet (so column F is the
  // cut time it was priced on) plus K = number, L = PO when there is one, N = 'Y' (Decision 5).
  function logRowsFor(invoice) {
    return invoice.sheetKeys.map(k => L.withBilling(invoice.perSheet[k].row, { invoiceNumber: invoice.number, poNumber: invoice.poNumber, billed: 'Y' }));
  }

  return { _plan: { lock: planLock, import: planImport, cancel: planCancel, addPo: planAddPo }, logRowsFor };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = InvoiceStore;
