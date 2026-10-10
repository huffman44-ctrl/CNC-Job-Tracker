/**
 * js/billing-model.js — the PURE model behind the Billing screen (Phase 2, Task 11): which sheets and
 * labor are billable now, the row states (ready / partly / labor-only — every row included by default, no Done gate; prior labor hours go to pricing), the through-date and billing-start gates, the invoice
 * draft and its fingerprint. No DOM, no Firestore, no clock (today is passed in), and NO money
 * arithmetic — every dollar comes from Pricing.priceInvoice(). All data arrives through build()'s
 * accessors. Local-date math only: YYYY-MM-DD is never parsed as UTC.
 * Browser global `BillingModel`; module.exports for node --test.
 */
const BillingModel = (() => {
  const P = typeof Pricing !== 'undefined' ? Pricing : require('./pricing.js');
  const L = typeof LogRows !== 'undefined' ? LogRows : require('./log-rows.js');
  const K = typeof Keys !== 'undefined' ? Keys : require('./keys.js');

  const nz = v => (v === undefined ? null : v);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function parseYmd(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  function fmtYmd(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const monthDay = ymd => { const d = parseYmd(ymd); return d ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : ''; };
  function rangeText(dates) {
    const s = dates.filter(Boolean).sort();
    if (!s.length) return '';
    return s[0] === s[s.length - 1] ? monthDay(s[0]) : `${monthDay(s[0])} – ${monthDay(s[s.length - 1])}`;
  }

  // Most recent weekEndingDay (0 = Sun … 6 = Sat) on or before today.
  function defaultThroughDate(todayYmd, weekEndingDay) {
    const d = parseYmd(todayYmd);
    if (!d) throw new Error('defaultThroughDate: bad date ' + todayYmd);
    if (!Number.isInteger(weekEndingDay) || weekEndingDay < 0 || weekEndingDay > 6) throw new Error('defaultThroughDate: weekEndingDay must be a whole number 0-6');
    const back = (d.getDay() - weekEndingDay + 7) % 7;
    return fmtYmd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back));
  }

  function build(input) {
    const { completionOf, sheetBillingOf, jobBillingOf, customerBillingOf, projectCustomerOf, customerKeyOf, jobKeyOf, compare } = input;
    const throughDate = input.throughDate || null;
    const billingStart = input.billingStart || null;
    const startMs = billingStart && parseYmd(billingStart) ? parseYmd(billingStart).getTime() : null;
    const types = {};
    (input.laborTypes || []).forEach(t => { types[t.id] = t; });
    const invoices = input.inProgressInvoices || [];
    const priceListFor = input.priceListFor || (() => null);

    // Group by job, de-duplicated by fileKey, ordered by compare (order is over ALL the job's sheets).
    const groups = new Map();
    const seen = new Set();
    (input.sheets || []).forEach(s => {
      if (!s || seen.has(s.fileKey)) return;
      seen.add(s.fileKey);
      const name = K.jobOf(s);
      const jk = jobKeyOf(name);
      if (!groups.has(jk)) groups.set(jk, { jobKey: jk, jobName: name, sheets: [] });
      groups.get(jk).sheets.push(s);
    });

    const customers = new Map();
    const needsDetails = [];
    const needsAttention = [];
    const plCache = {};
    const priceListOf = ck => (ck in plCache ? plCache[ck] : (plCache[ck] = priceListFor(ck) || null));
    const outside = ck => !!(ck && (customerBillingOf(ck) || {}).billedOutsideApp);

    groups.forEach(g => {
      const jk = g.jobKey;
      const jb = jobBillingOf(jk) || null;
      g.sheets.sort(compare);
      const buckets = { eligible: [], uncut: [], later: [], locked: [], billed: [], beforeStart: [], external: [] };
      g.sheets.forEach((s, i) => {
        const fk = s.fileKey;
        const sb = sheetBillingOf(fk) || null;
        const status = (sb && sb.status) || 'unbilled';
        const comp = completionOf(fk) || null;
        const cutDate = P.effectiveCutDate(comp, sb);
        const known = ['unbilled', 'in-progress', 'billed', 'external'];
        const toolpathCount = Array.isArray(s.toolpaths) ? s.toolpaths.length : 0;
        const sheetInput = {
          fileKey: fk, jobKey: jk, order: i + 1, sheetLabel: s.sheetTitle || s.fileName || '',
          totalTimeSec: P.parseTimeSec(s.totalTime), toolpathCount, hasVbit: P.sheetHasVbit(s), cutDate,
        };
        const entry = { captured: { sheet: { ...s, toolpaths: Array.isArray(s.toolpaths) ? s.toolpaths.map(t => ({ ...t })) : s.toolpaths }, completion: comp ? { ...comp } : null, cutDateOverride: nz(sb && sb.cutDateOverride) }, fileKey: fk, jobKey: jk, sheetLabel: sheetInput.sheetLabel, cutDate, invoiceNumber: sb && sb.invoiceNumber != null ? sb.invoiceNumber : null, sheetInput };
        if (status === 'external') buckets.external.push(entry);
        else if (status === 'billed') buckets.billed.push({ ...entry, prior: { jobKey: jk, signature: P.signatureOf(sheetInput), order: i + 1 } });
        else if (status === 'in-progress' || !known.includes(status)) buckets.locked.push(entry);   // an unknown status is never billable
        else if (!cutDate) buckets.uncut.push(entry);
        else if (billingStart && cutDate < billingStart) buckets.beforeStart.push({ ...entry, prior: { jobKey: jk, signature: P.signatureOf(sheetInput), order: i + 1 } });   // billed the old way: never listed, still counts for repeats
        else if (throughDate && cutDate > throughDate) buckets.later.push(entry);
        else buckets.eligible.push(entry);
      });

      // Job details.
      const custName = (jb && jb.customerName) || null;
      const ck = (jb && (jb.customerKey || (jb.customerName && customerKeyOf(jb.customerName)))) || null;
      const missing = [];
      if (!ck) missing.push('customer');
      if (!(jb && jb.material && jb.material.kind)) missing.push('material');
      if (!(jb && jb.turnaround)) missing.push('turnaround');
      const billableLater = buckets.eligible.length + buckets.uncut.length + buckets.later.length;

      if (missing.length) {
        const pcName = custName || projectCustomerOf(jk) || null;
        const outKey = ck || (pcName && customerKeyOf(pcName)) || null;
        if (outside(outKey)) return;
        if (!billableLater) return;
        needsDetails.push({ jobKey: jk, jobName: g.jobName, customerName: pcName, missing, sheetCount: g.sheets.length });
        return;
      }
      if (outside(ck)) return;

      const cb = customerBillingOf(ck) || null;
      let cs = customers.get(ck);
      if (!cs) {
        cs = { customerKey: ck, customerName: custName || (cb && cb.name) || '', priceListName: (input.priceListNameOf && input.priceListNameOf(ck)) || (cb && cb.priceList) || 'standard', busyInvoice: null,
          rows: [], lockedSheets: [], uncutSheets: [], laterSheets: [], laterFirstDate: null, summary: '', _cb: cb };
        customers.set(ck, cs);
      }
      const strip = e => ({ fileKey: e.fileKey, jobKey: e.jobKey, sheetLabel: e.sheetLabel, cutDate: e.cutDate, invoiceNumber: e.invoiceNumber });
      buckets.locked.forEach(e => cs.lockedSheets.push(strip(e)));
      buckets.uncut.forEach(e => cs.uncutSheets.push(strip(e)));
      buckets.later.forEach(e => cs.laterSheets.push(strip(e)));

      // Labor — every unbilled line goes on the next bill (no Done step, spec 2026-10-06); never gated
      // by the through date (§15.4). Lines already billed / in progress are the once-per-job minimum's `prior`.
      const lines = (jb.laborLines || []).filter(l =>
        ((l && l.status) || 'unbilled') === 'unbilled' && (startMs === null || (Number(l.enteredAt) || 0) >= startMs));
      const priorLabor = P.priorLaborHours(jb.laborLines);
      const hasSheets = buckets.eligible.length > 0;
      if (!hasSheets && !lines.length) return;

      const priceList = priceListOf(ck);
      if (!priceList) { needsAttention.push({ jobKey: jk, jobName: g.jobName, reason: 'Price list not set up' }); return; }
      const gone = lines.filter(l => !types[l.typeId]);
      if (gone.length) {
        const names = [...new Set(gone.map(l => l.typeName || l.typeId))].join(', ');
        needsAttention.push({ jobKey: jk, jobName: g.jobName, reason: `Labor type ${names} was removed from Settings — fix or delete those hours before billing.` });
        return;
      }

      const state = !hasSheets ? 'labor-only' : (buckets.uncut.length ? 'partly' : 'ready');
      const laborLines = lines.map(l => ({ id: l.id, typeId: l.typeId, typeName: l.typeName || (types[l.typeId] || {}).name || '', hours: l.hours, note: l.note || '' }));
      const sheetInputs = buckets.eligible.map(e => e.sheetInput);
      const row = {
        jobKey: jk, jobName: g.jobName, state, defaultIncluded: true,   // the owner removes, never adds (spec 2026-10-06 §3.1)
        sheetKeys: buckets.eligible.map(e => e.fileKey), laborLineIds: lines.map(l => l.id),
        uncutCount: buckets.uncut.length, laterCount: buckets.later.length, lockedCount: buckets.locked.length,
        zeroTimeCount: sheetInputs.filter(s => !(s.totalTimeSec > 0)).length,
        sheetInputs, priorBilled: [...buckets.billed, ...buckets.beforeStart].map(e => e.prior),
        priorLaborHours: { ...priorLabor },
        billedOn: [...new Set(buckets.billed.map(e => e.invoiceNumber).filter(v => v != null))].sort((a, b) => a - b),
        // Invoices carrying this job's billed / in-progress labor lines — so a sheets-only row can say the design is already billed.
        laborBilledOn: [...new Set((jb.laborLines || []).filter(l => l && ['billed', 'in-progress'].includes(l.status) && l.invoiceNumber != null).map(l => l.invoiceNumber))].sort((a, b) => a - b),
        captured: {
          sheets: Object.fromEntries(buckets.eligible.map(e => [e.fileKey, e.captured])),
          job: { turnaround: nz(jb.turnaround), materialKind: nz(jb.material.kind), materialId: nz(jb.material.materialId), pricePerSheet: nz(jb.material.pricePerSheet),
            priorLabor: { ...priorLabor }, labor: Object.fromEntries(lines.map(l => [l.id, { typeId: nz(l.typeId), hours: nz(l.hours) }])) },
        },
        jobInput: { jobName: g.jobName, turnaround: jb.turnaround, material: jb.material, includeLabor: laborLines.length > 0, laborLines },
        amount: null, error: null,
      };
      const rp = rowPricing(row, { priceList, laborTypes: input.laborTypes || [] });
      row.amount = rp.amount; row.error = rp.error;
      cs.priceList = priceList;
      cs.rows.push(row);
    });

    const out = [];
    customers.forEach(cs => {
      const inv = invoices.find(i => i && i.customerKey === cs.customerKey && (!i.status || i.status === 'in-progress'));
      cs.busyInvoice = inv ? inv.number : (cs._cb && cs._cb.openInvoice != null ? cs._cb.openInvoice : null);
      delete cs._cb;
      const laterDates = cs.laterSheets.map(s => s.cutDate).filter(Boolean).sort();
      cs.laterFirstDate = laterDates.length ? laterDates[0] : null;
      if (!(cs.rows.length || cs.lockedSheets.length || cs.uncutSheets.length || cs.laterSheets.length || cs.busyInvoice != null)) return;
      cs.summary = summaryText(cs);
      out.push(cs);
    });
    out.sort((a, b) => a.customerName.localeCompare(b.customerName));
    return { customers: out, needsDetails, needsAttention, throughDate, billingStart };
  }

  // Prices ONE row alone (its sheets and its labor). Never throws: a pricing refusal comes back as `error`.
  function rowPricing(row, ctx) {
    try {
      const priced = P.priceInvoice({
        priceList: ctx.priceList, laborTypes: ctx.laborTypes,
        jobs: { [row.jobKey]: row.jobInput }, sheets: row.sheetInputs.map(s => ({ ...s })), priorBilled: row.priorBilled.map(p => ({ ...p })),
        priorLaborHours: { [row.jobKey]: { ...row.priorLaborHours } },
      });
      return { priced, amount: priced.perJob[row.jobKey].subtotal, error: null };
    } catch (e) {
      return { priced: null, amount: null, error: e.message || String(e) };
    }
  }
  // Prices the row's labor alone (no sheets): the per-job subtotal of a sheetless pricing is labor only.
  function laborAmount(row, ctx) {
    if (!row.laborLineIds.length) return 0;
    try {
      const priced = P.priceInvoice({ priceList: ctx.priceList, laborTypes: ctx.laborTypes, jobs: { [row.jobKey]: { ...row.jobInput, includeLabor: true } }, sheets: [], priorBilled: [], priorLaborHours: { [row.jobKey]: { ...row.priorLaborHours } } });
      return priced.perJob[row.jobKey].subtotal;
    } catch (e) { return null; }
  }
  const rowAmount = (row, ctx) => rowPricing(row, ctx).amount;

  // selection = { [jobKey]: { sheets: bool } }; absent -> row.defaultIncluded (always true).
  // The choice switches the whole row — its cut sheets AND its unbilled labor — in every state (spec 2026-10-06 §3.1).
  function pricingInput(customer, selection, ctx) {
    const jobs = {}, sheets = [], priorBilled = [], priorLaborHours = {};
    customer.rows.forEach(r => {
      const sel = selection && selection[r.jobKey];
      const on = sel && typeof sel.sheets === 'boolean' ? sel.sheets : r.defaultIncluded;
      if (!on) return;
      const withSheets = r.sheetKeys.length > 0;
      const withLabor = r.laborLineIds.length > 0;
      if (!withSheets && !withLabor) return;
      jobs[r.jobKey] = { ...r.jobInput, includeLabor: withLabor, laborLines: withLabor ? r.jobInput.laborLines.map(l => ({ ...l })) : [] };
      if (withLabor) priorLaborHours[r.jobKey] = { ...r.priorLaborHours };
      if (withSheets) {
        r.sheetInputs.forEach(s => sheets.push({ ...s }));
        r.priorBilled.forEach(p => priorBilled.push({ ...p }));
      }
    });
    return { priceList: ctx.priceList, laborTypes: ctx.laborTypes, jobs, sheets, priorBilled, priorLaborHours };
  }

  function summaryText(customer) {
    const rows = customer.rows || [];
    const later = customer.laterSheets || [];
    const laterPart = later.length
      ? `${plural(later.length, 'sheet', 'sheets')} cut ${rangeText(later.map(s => s.cutDate))} ${later.length === 1 ? 'waits' : 'wait'} for next week` : '';
    if (rows.length) {
      const dates = [];
      let n = 0;
      rows.forEach(r => r.sheetInputs.forEach(s => { n++; dates.push(s.cutDate); }));
      const parts = [plural(rows.length, 'job', 'jobs'), n ? `${plural(n, 'sheet', 'sheets')} cut ${rangeText(dates)}` : 'labor only'];
      if (laterPart) parts.push(laterPart);
      return parts.join(' · ');
    }
    const locked = customer.lockedSheets || [];
    const parts = [];
    if (locked.length) {
      const nums = [...new Set(locked.map(s => s.invoiceNumber).filter(v => v != null))];
      const where = nums.length ? `invoice${nums.length > 1 ? 's' : ''} ${nums.join(' and ')}` : 'an invoice';
      parts.push(`${locked.length} cut ${locked.length === 1 ? 'sheet is' : 'sheets are'} on ${where} (in progress)`);
    }
    const uncut = (customer.uncutSheets || []).length;
    if (uncut) parts.push(`${uncut} still to cut`);
    if (laterPart) parts.push(laterPart);
    return parts.length ? `Nothing ready — ${parts.join(', ')}.` : 'Nothing ready.';
  }

  // "1.5 h Design" / "1.5 h Design, 0.25 h CAM" / "no design hours" — entered hours per type, in line order.
  function laborText(lines) {
    const byType = {}, order = [];
    (lines || []).forEach(l => {
      const k = (l && (l.typeName || l.typeId)) || '';
      if (!(k in byType)) { byType[k] = 0; order.push(k); }
      byType[k] += Number(l && l.hours) || 0;
    });
    return order.length ? order.map(k => `${P.round2(byType[k])} h ${k}`).join(', ') : 'no design hours';
  }

  function rowDetail(row, priced) {
    const parts = [];
    const jp = priced && priced.perJob && priced.perJob[row.jobKey];
    const n = row.sheetKeys.length;
    if (n) {
      parts.push(plural(n, 'sheet', 'sheets'));
      if (jp && jp.repeats > 0) parts.push(`${plural(jp.firsts, 'design', 'designs')}, ${plural(jp.repeats, 'repeat', 'repeats')}`);
    }
    const ta = row.jobInput.turnaround;
    if (n && ta && ta !== 'standard') parts.push(P.TURNAROUND_LABEL[ta] || ta);
    if (priced && n) {
      const wk = row.sheetKeys.filter(k => ((priced.perSheet || {})[k] || {}).weekendPremium > 0).length;
      if (wk) parts.push(`${plural(wk, 'weekend sheet', 'weekend sheets')}`);
    }
    if (n) parts.push(`${P.formatDuration(row.sheetInputs.reduce((a, s) => a + s.totalTimeSec, 0))} Aspire time`);
    if (n) { const m = row.jobInput.material || {}; parts.push(m.kind === 'ours' ? (m.name || 'our material') : 'customer supplied'); }
    // The design state (spec 2026-10-06 §3.1), always last.
    const billedOn = row.billedOn || [];
    if (!n && billedOn.length) parts.push(`Sheets billed on ${billedOn.map(x => '#' + x).join(' and ')}`);
    else if (!n && row.uncutCount) parts.push(`${row.uncutCount} still to cut`);
    const lt = laborText(row.jobInput.laborLines);
    const lbo = row.laborBilledOn || [];
    if (n && !row.laborLineIds.length && lbo.length) parts.push(`design hours billed on ${lbo.map(x => '#' + x).join(' and ')}`);
    else parts.push(!n && billedOn.length && row.laborLineIds.length ? `${lt} added after` : lt);
    let s = parts.join(' · ');
    if (row.zeroTimeCount) s += `${s ? ' · ' : ''}${row.zeroTimeCount === 1 ? '1 sheet has' : row.zeroTimeCount + ' sheets have'} no Aspire time`;
    return s;
  }

  // The invoice draft (Task 8 shape). `priced` is the priceInvoice result for pricingInput(customer, selection):
  // sheetKeys, laborLineRefs, per-sheet figures all come from IT, and the fingerprint is read from the
  // same accessors, so what is locked is exactly what was priced.
  function buildDraft(a) {
    const { customer, priced, settings } = a;
    // Everything below comes from the values captured by build() — the same ones that were priced —
    // never from a fresh read, so a change since the screen was drawn still trips planLock's fingerprint.
    const capSheet = {}, rowOfSheet = {}, rowOfJob = {};
    customer.rows.forEach(r => { rowOfJob[r.jobKey] = r; r.sheetKeys.forEach(k => { capSheet[k] = r.captured.sheets[k]; rowOfSheet[k] = r; }); });
    const sheetKeys = Object.keys(priced.perSheet);
    const laborLineRefs = (priced.labor || []).map(l => ({ jobKey: l.jobKey, lineId: l.lineId }));
    const perSheet = {}, fpSheets = {};
    sheetKeys.forEach(k => {
      const cap = capSheet[k];
      const comp = cap.completion;
      const ps = priced.perSheet[k];
      perSheet[k] = {
        jobKey: rowOfSheet[k].jobKey, cutAt: nz(comp && comp.completedAt), cutDate: P.effectiveCutDate(comp, { cutDateOverride: cap.cutDateOverride }), operator: (comp && comp.operator) || '',
        priced: { handling: ps.handling, timeCharge: ps.timeCharge, weekendPremium: ps.weekendPremium, repeatOf: ps.repeatOf,
          hourlyRate: nz(settings && settings.priceList && settings.priceList.hourlyRate), priceList: customer.priceListName },
        row: L.build(cap.sheet, comp, customer.customerName),
      };
      fpSheets[k] = { completedAt: nz(comp && comp.completedAt), cutDateOverride: cap.cutDateOverride };
    });
    const jobKeys = [...new Set([...sheetKeys.map(k => perSheet[k].jobKey), ...laborLineRefs.map(r => r.jobKey)].filter(Boolean))];
    const fpJobs = {};
    jobKeys.forEach(jk => {
      const c = rowOfJob[jk].captured.job;
      const labor = {};
      laborLineRefs.filter(r => r.jobKey === jk).forEach(r => { labor[r.lineId] = { ...c.labor[r.lineId] }; });
      fpJobs[jk] = { turnaround: c.turnaround, materialKind: c.materialKind, materialId: c.materialId, pricePerSheet: c.pricePerSheet, priorLabor: { ...(c.priorLabor || {}) }, labor };
    });
    return {
      number: a.number, customerKey: customer.customerKey, customerName: customer.customerName, throughDate: a.throughDate || null,
      invoiceDate: a.invoiceDate, dueDate: a.dueDate, dueTerm: a.dueTerm, poNumber: a.poNumber || '',
      sheetKeys, laborLineRefs, lines: a.lines, breakdown: priced.breakdown, total: priced.total, priceListName: customer.priceListName,
      settingsSnapshot: settings, perSheet, fingerprint: { sheets: fpSheets, jobs: fpJobs }, csv: a.csv,
    };
  }

  const monthDayMs = ms => { const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getMonth()]} ${d.getDate()}`; };

  // Recent jobs (spec 2026-10-06 §3.3): one line per job whose sheets are ALL finished (none on the board)
  // and whose latest finishedAt is within `days` of nowMs; newest first; customers billed outside this
  // app left out. Built from the finished list Billing already holds — no new reads.
  function recentJobs(input) {
    const { sheetBillingOf, jobBillingOf, customerBillingOf, projectCustomerOf, customerKeyOf, jobKeyOf } = input;
    const cutoff = input.nowMs - (input.days || 30) * 86400000;
    const onBoard = new Set((input.activeSheets || []).map(s => jobKeyOf(K.jobOf(s))));
    const groups = new Map();
    const seen = new Set();
    (input.finishedSheets || []).forEach(s => {
      if (!s || seen.has(s.fileKey)) return;
      seen.add(s.fileKey);
      const name = K.jobOf(s);
      const jk = jobKeyOf(name);
      if (!groups.has(jk)) groups.set(jk, { jobKey: jk, jobName: name, sheets: [] });
      groups.get(jk).sheets.push(s);
    });
    const out = [];
    groups.forEach(g => {
      if (onBoard.has(g.jobKey)) return;
      const finishedAt = g.sheets.reduce((m, s) => Math.max(m, Number(s.finishedAt) || 0), 0);
      if (!finishedAt || finishedAt < cutoff) return;
      const jb = jobBillingOf(g.jobKey) || null;
      const custName = (jb && jb.customerName) || projectCustomerOf(g.jobKey) || null;
      const ck = (jb && jb.customerKey) || (custName && customerKeyOf(custName)) || null;
      if (ck && (customerBillingOf(ck) || {}).billedOutsideApp) return;
      let billed = 0, counted = 0;
      const nums = [];
      g.sheets.forEach(s => {
        const sb = sheetBillingOf(s.fileKey) || null;
        const st = (sb && sb.status) || 'unbilled';
        if (st === 'external') return;
        counted++;
        if (st === 'billed') { billed++; if (sb.invoiceNumber != null && !nums.includes(sb.invoiceNumber)) nums.push(sb.invoiceNumber); }
      });
      nums.sort((a, b) => a - b);
      let billingText;
      if (!counted) billingText = 'no charge';
      else if (billed === counted) billingText = `${plural(counted, 'sheet', 'sheets')} billed ${nums.map(n => '#' + n).join(', ')}`;
      else if (billed > 0) billingText = `${billed} of ${counted} sheets billed`;
      else billingText = 'not billed yet';
      out.push({ jobKey: g.jobKey, jobName: g.jobName, customerName: custName || 'No customer yet', finishedAt, finishedText: monthDayMs(finishedAt),
        sheetCount: g.sheets.length, billingText, laborText: laborText(jb && jb.laborLines) });
    });
    out.sort((a, b) => b.finishedAt - a.finishedAt);
    return out;
  }

  return { defaultThroughDate, build, pricingInput, rowPricing, rowAmount, laborAmount, summaryText, rowDetail, laborText, recentJobs, buildDraft };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BillingModel;
