/**
 * js/pricing.js — the ONE place that knows what makes two sheets "the same design", how an
 * Aspire time is read, and what a sheet's cut date is. Phase 1 (2026-10-04 spec §8.1, §12.1)
 * shipped these helpers.
 * Phase 2: priceInvoice() — the ONLY place money is computed. Nothing else in the app does price math.
 * 2026-10-06: the labor minimum is charged once per job across bills (`priorLaborHours`).
 * Pure: no DOM, no Firestore, no Date.now() — callers pass dates.
 * Browser global `Pricing`; module.exports for node --test.
 */
const Pricing = (() => {
  // Moved here from app.js so the log's "Has V-bit" column and the repeat rule read one list.
  const VBIT_KEYWORDS = ['V-Carve', 'V-carve', 'V Carve', 'VCarve', 'V-Groove', 'V-groove', 'V Groove'];

  function sheetHasVbit(sheet) {
    const toolpaths = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths : [];
    return toolpaths.some(tp => VBIT_KEYWORDS.some(kw => new RegExp(kw, 'i').test((tp && tp.name) || '')));
  }

  // 'HH:MM:SS' (Aspire) or 'MM:SS' -> seconds. Anything unreadable is 0, never NaN.
  function parseTimeSec(text) {
    const parts = String(text || '').trim().split(':');
    if (!parts.length || parts.some(p => !/^\d+$/.test(p))) return 0;
    return parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
  }

  // Spec §8.1: signature = totalTimeSec | toolpathCount | V-bit flag. Two sheets of one job with
  // the same signature are one design (the first pays handlingFirst, the rest handlingRepeat).
  function signatureOf(s) {
    return `${Number(s && s.totalTimeSec) || 0}|${Number(s && s.toolpathCount) || 0}|${s && s.hasVbit ? 'V' : '-'}`;
  }

  function signature(sheet) {
    const count = (sheet && Array.isArray(sheet.toolpaths)) ? sheet.toolpaths.length : 0;
    return signatureOf({ totalTimeSec: parseTimeSec(sheet && sheet.totalTime), toolpathCount: count, hasVbit: sheetHasVbit(sheet) });
  }

  // orderedSheets = one job's sheets in display order (app.js compareSheets).
  function repeatGroups(orderedSheets) {
    const firstPosition = {};
    const out = {};
    (orderedSheets || []).forEach((sheet, i) => {
      const sig = signature(sheet);
      if (firstPosition[sig] === undefined) {
        firstPosition[sig] = i + 1;
        out[sheet.fileKey] = { signature: sig, repeatOf: null };
      } else {
        out[sheet.fileKey] = { signature: sig, repeatOf: firstPosition[sig] };
      }
    });
    return out;
  }

  function repeatCount(orderedSheets) {
    return Object.values(repeatGroups(orderedSheets)).filter(g => g.repeatOf !== null).length;
  }

  // ISO timestamp -> local 'YYYY-MM-DD'. Never slice the ISO string: it is UTC and shifts the
  // weekday in US zones (spec §12.1 "weekday fixture trap").
  function localDate(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 'YYYY-MM-DD' parsed as LOCAL parts (new Date('2026-10-03') would be UTC midnight).
  function isWeekendDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return false;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
    return day === 0 || day === 6;
  }

  // The owner's correction (sheetBilling.cutDateOverride) wins over Collin's completion time.
  function effectiveCutDate(completion, sheetBilling) {
    if (sheetBilling && sheetBilling.cutDateOverride) return sheetBilling.cutDateOverride;
    if (completion && completion.status === 'complete' && completion.completedAt) return localDate(completion.completedAt);
    return null;
  }

  // Hours of a job's labor lines already billed or on an invoice in progress, per type — the
  // `prior` of the once-per-job minimum (spec 2026-10-06 §5). Real hours; top-ups are never stored.
  function priorLaborHours(laborLines) {
    const out = {};
    (laborLines || []).forEach(l => {
      const st = (l && l.status) || 'unbilled';
      if (st !== 'billed' && st !== 'in-progress') return;
      out[l.typeId] = (out[l.typeId] || 0) + (Number(l.hours) || 0);
    });
    return out;
  }

  /* -- Phase 2: the price engine (spec 8). Money lives ONLY here. -- */
  const TURNAROUND_LABEL = { standard: 'Standard', rush48: '48-hour rush', rush24: '24-hour rush' };
  const PRICE_KEYS = ['handlingFirst', 'handlingRepeat', 'hourlyRate', 'weekendRate', 'cutMinimum', 'roundTo'];

  // Half-up to the cent; the nudge absorbs binary noise (643.125 is stored as 643.12499…).
  function round2(x) { return Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100; }
  function roundToStep(x, step) { const s = Number(step) > 0 ? Number(step) : 1; return Math.round(x / s + 1e-9) * s; }

  function priceInvoice(input) {
    const pl = input && input.priceList;
    if (!pl) throw new Error('priceInvoice: no price list');
    PRICE_KEYS.forEach(k => { if (!(typeof pl[k] === 'number' && isFinite(pl[k]))) throw new Error(`Price list is missing ${k}`); });
    const rushOf = t => {
      const v = pl.rush && pl.rush[t];
      if (!(typeof v === 'number' && isFinite(v))) throw new Error(`Price list has no rush rate for ${t}`);
      return v;
    };
    const types = {};
    (input.laborTypes || []).forEach(t => { types[t.id] = t; });
    const jobs = input.jobs || {};
    const sheets = input.sheets || [];
    const prior = input.priorBilled || [];

    sheets.forEach(s => {
      if (!jobs[s.jobKey]) throw new Error(`Sheet ${s.fileKey} has no job ${s.jobKey}`);
      if (!(typeof s.totalTimeSec === "number" && isFinite(s.totalTimeSec) && s.totalTimeSec >= 0)) throw new Error(`Sheet ${s.fileKey} has no valid Aspire time`);
      if (!s.cutDate) throw new Error(`Sheet ${s.fileKey} is not cut — it cannot be on an invoice`);
    });

    // 1. Repeats (§8.3.1). A 0-second sheet is never grouped (it has no real signature).
    const zero = s => !(Number(s.totalTimeSec) > 0);
    const gk = s => s.jobKey + '\u0000' + signatureOf(s);
    const firstOn = {};
    sheets.forEach(s => {
      if (zero(s)) return;
      const cur = firstOn[gk(s)];
      if (!cur || s.order < cur.order || (s.order === cur.order && String(s.fileKey) < String(cur.fileKey))) firstOn[gk(s)] = s;
    });
    const priorFirst = {};
    prior.forEach(p => {
      if (String(p.signature).split('|')[0] === '0') return;
      const k = p.jobKey + '\u0000' + p.signature;
      if (priorFirst[k] === undefined || p.order < priorFirst[k]) priorFirst[k] = p.order;
    });

    // 2–3. Time and weekend per sheet.
    const perSheet = {};
    sheets.forEach(s => {
      let repeatOf = null;
      if (!zero(s)) {
        if (priorFirst[gk(s)] !== undefined) repeatOf = priorFirst[gk(s)];
        else if (firstOn[gk(s)] !== s) repeatOf = firstOn[gk(s)].order;
      }
      const handling = repeatOf === null ? pl.handlingFirst : pl.handlingRepeat;
      const timeCharge = (Number(s.totalTimeSec) || 0) / 3600 * pl.hourlyRate;
      const weekendPremium = isWeekendDate(s.cutDate) ? (handling + timeCharge) * pl.weekendRate : 0;
      perSheet[s.fileKey] = { handling, timeCharge, weekendPremium, repeatOf };
    });

    // 4. Per job.
    const jobKeys = [];
    sheets.forEach(s => { if (!jobKeys.includes(s.jobKey)) jobKeys.push(s.jobKey); });
    Object.keys(jobs).forEach(k => { if (jobs[k].includeLabor && (jobs[k].laborLines || []).length && !jobKeys.includes(k)) jobKeys.push(k); });
    const perJob = {};
    const labor = [];
    jobKeys.forEach(jk => {
      const job = jobs[jk];
      const rp = rushOf(job.turnaround || 'standard');
      const js = sheets.filter(s => s.jobKey === jk);
      let cutBase = 0, weekend = 0, firsts = 0;
      js.forEach(s => { const p = perSheet[s.fileKey]; cutBase += p.handling + p.timeCharge; weekend += p.weekendPremium; if (p.repeatOf === null) firsts++; });
      let laborBase = 0, laborRush = 0;
      if (job.includeLabor) {
        const lines = job.laborLines || [];
        lines.forEach(l => {
          const t = types[l.typeId];
          if (!t) throw new Error(`Unknown labor type "${l.typeId}" on ${job.jobName}`);
          if (!(typeof t.rate === "number" && isFinite(t.rate))) throw new Error(`Labor type "${t.id}" has no rate`);
          if (!(typeof t.minHours === "number" && isFinite(t.minHours) && t.minHours >= 0)) throw new Error(`Labor type "${t.id}" has no minimum hours`);
          if (!(typeof l.hours === "number" && isFinite(l.hours) && l.hours > 0)) throw new Error(`A ${t.name || t.id} line on ${job.jobName} has no hours`);
        });
        // Minimums per job, per type (Decision 7), charged ONCE per job across all of its bills
        // (spec 2026-10-06 §5):
        //   prior    = hours of this type already billed / in progress on earlier invoices (real hours, no top-up)
        //   charged  = prior > 0 ? max(minHours, prior) : 0
        //   thisBill = max(minHours, prior + now) − charged           (never negative)
        // thisBill − now lands on the LAST line of that type: a shortfall as a top-up, a credit (the
        // minimum was already charged) as negative topUpHours. A credit larger than the last line's
        // hours continues onto the line before it, so no line ever bills negative hours.
        const priorOf = (input.priorLaborHours || {})[jk] || {};
        const z = x => (Math.abs(x) < 1e-9 ? 0 : x);
        const sumByType = {};
        lines.forEach(l => { sumByType[l.typeId] = (sumByType[l.typeId] || 0) + (Number(l.hours) || 0); });
        const adjust = {};   // line index -> signed hours adjustment
        Object.keys(sumByType).forEach(typeId => {
          const min = Number(types[typeId].minHours) || 0;
          const prior = Number(priorOf[typeId]) || 0;
          const now = sumByType[typeId];
          // `charged` assumes the earlier bill used the CURRENT minimum; changing a labor type's minimum between a job's two bills is not back-corrected.
          const charged = prior > 0 ? Math.max(min, prior) : 0;
          const thisBill = Math.max(0, Math.max(min, prior + now) - charged);
          let diff = z(thisBill - now);
          for (let i = lines.length - 1; i >= 0 && diff !== 0; i--) {
            if (lines[i].typeId !== typeId) continue;
            const take = diff > 0 ? diff : Math.max(diff, -(Number(lines[i].hours) || 0));
            adjust[i] = take;
            diff = z(diff - take);
          }
        });
        lines.forEach((l, i) => {
          const t = types[l.typeId];
          const hours = Number(l.hours) || 0;
          const topUpHours = adjust[i] || 0;
          const billedHours = z(hours + topUpHours);
          const base = billedHours * Number(t.rate);
          const rush = base * rp;
          laborBase += base; laborRush += rush;
          labor.push({ jobKey: jk, lineId: l.id, typeId: t.id, typeName: t.name, note: l.note || '', hours, topUpHours, billedHours,
            coveredHours: topUpHours < 0 ? -topUpHours : 0,
            minHours: Number(t.minHours) || 0, rate: Number(t.rate), base, rush, rushPct: rp });
        });
      }
      const m = job.material || {};
      if (m.kind === "ours" && !(typeof m.pricePerSheet === "number" && isFinite(m.pricePerSheet) && m.pricePerSheet >= 0)) throw new Error(`Material on ${job.jobName} has no price`);
      const material = m.kind === 'ours' ? (Number(m.pricePerSheet) || 0) * js.length : 0;
      const rush = cutBase * rp;
      perJob[jk] = { cutBase, weekend, rush, laborBase, laborRush, material, subtotal: cutBase + weekend + rush + laborBase + laborRush + material,
        sheetCount: js.length, firsts, repeats: js.length - firsts };
    });

    if (!sheets.length && !labor.length) throw new Error('Nothing to bill');

    // 5–8. Per invoice.
    let cutPortion = 0, laborPortion = 0, materialPortion = 0;
    jobKeys.forEach(jk => { const p = perJob[jk]; cutPortion += p.cutBase + p.weekend + p.rush; laborPortion += p.laborBase + p.laborRush; materialPortion += p.material; });
    const rounded = roundToStep(cutPortion + laborPortion, pl.roundTo);
    const minimumAdjustment = sheets.length ? Math.max(0, pl.cutMinimum - roundToStep(cutPortion, pl.roundTo)) : 0;
    const total = round2(rounded + minimumAdjustment + materialPortion);

    const result = { total, cutPortion, laborPortion, materialPortion,
      roundingAdjustment: rounded - (cutPortion + laborPortion), minimumAdjustment, minimumApplied: minimumAdjustment > 0,
      perJob, perSheet, labor, lines: [], breakdown: [], _ctx: { priceList: pl, jobs, sheets, jobKeys } };
    result.lines = buildLines(result);
    result.breakdown = buildBreakdown(result);
    delete result._ctx;
    return result;
  }

  // Lines in the estimator's order: one combined Materials line, the cut line, one line per labor entry.
  // No descriptions / item names / Taxable here — InvoiceLines (Task 5) adds them.
  function buildLines(result) {
    const { jobs, sheets, jobKeys } = result._ctx;
    const lines = [];
    const ours = jobKeys.filter(jk => (jobs[jk].material || {}).kind === 'ours' && result.perJob[jk].sheetCount > 0);
    if (ours.length) {
      const names = [];
      ours.forEach(jk => { const n = jobs[jk].material.name; if (!names.includes(n)) names.push(n); });
      const tax = [...new Set(ours.map(jk => !!jobs[jk].material.taxable))];
      const amount = round2(ours.reduce((a, jk) => a + result.perJob[jk].material, 0));
      lines.push({ type: 'material', amount, rate: amount, quantity: 1, serviceDate: '', jobKeys: ours,
        facts: { names, taxable: tax.length === 1 ? tax[0] : 'mixed', sheetCount: ours.reduce((a, jk) => a + result.perJob[jk].sheetCount, 0) } });
    }
    let cutIdx = -1;
    if (sheets.length) {
      const cutJobs = jobKeys.filter(jk => result.perJob[jk].sheetCount > 0);
      const rush = cutJobs.filter(jk => (result._ctx.priceList.rush[jobs[jk].turnaround || 'standard'] || 0) > 0)
        .map(jk => ({ jobName: jobs[jk].jobName, label: TURNAROUND_LABEL[jobs[jk].turnaround || 'standard'] }));
      const amount = round2(result.cutPortion + result.minimumAdjustment);
      cutIdx = lines.length;
      lines.push({ type: 'cutSheets', amount, rate: amount, quantity: 1,
        serviceDate: sheets.reduce((a, s) => (s.cutDate > a ? s.cutDate : a), ''), jobKeys: cutJobs,
        facts: { sheetCount: sheets.length, perJob: cutJobs.map(jk => ({ jobName: jobs[jk].jobName, count: result.perJob[jk].sheetCount })), rush,
          weekendSheets: sheets.filter(s => result.perSheet[s.fileKey].weekendPremium > 0).length,
          weekendRate: result._ctx.priceList.weekendRate, minimumApplied: result.minimumApplied } });
    }
    result.labor.forEach(l => {
      const amount = round2(l.base + l.rush);
      lines.push({ type: 'labor', amount, rate: amount, quantity: 1, serviceDate: '', jobKeys: [l.jobKey], facts: { ...l } });
    });
    // Reconcile: per-line cents rounding must not drift from the total; the difference goes on the cut line, else the largest labor line.
    const diff = round2(result.total - lines.reduce((a, l) => a + l.amount, 0));
    if (diff !== 0) {
      // No cut line: the LARGEST labor line (first on ties) absorbs it, so no line can go negative.
      let target = cutIdx >= 0 ? lines[cutIdx] : lines[0];
      if (cutIdx < 0) lines.forEach(l => { if (l.amount > target.amount) target = l; });
      target.amount = round2(target.amount + diff);
      target.rate = target.amount;
    }
    return lines;
  }

  const money = x => { const v = round2(x); return '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2)); };
  const hoursText = h => `${round2(h)} h`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Plain-words breakdown (spec 7.5 / Example C). Amounts stay unrounded numbers; the screen formats them.
  function buildBreakdown(result) {
    const { priceList: pl, jobs, sheets, jobKeys } = result._ctx;
    const out = [];
    const firsts = sheets.filter(s => result.perSheet[s.fileKey].repeatOf === null);
    const repeats = sheets.filter(s => result.perSheet[s.fileKey].repeatOf !== null);
    if (firsts.length) out.push({ label: `Handling ${firsts.length} × ${money(pl.handlingFirst)}`, amount: firsts.length * pl.handlingFirst });
    if (repeats.length) out.push({ label: `Handling ${plural(repeats.length, 'repeat', 'repeats')} × ${money(pl.handlingRepeat)}`, amount: repeats.length * pl.handlingRepeat });
    if (sheets.length) {
      const sec = sheets.reduce((a, s) => a + (Number(s.totalTimeSec) || 0), 0);
      out.push({ label: `Cutting ${formatDuration(sec)} × ${money(pl.hourlyRate)}/hr`, amount: sheets.reduce((a, s) => a + result.perSheet[s.fileKey].timeCharge, 0) });
    }
    const wk = sheets.filter(s => result.perSheet[s.fileKey].weekendPremium > 0);
    if (wk.length) out.push({ label: `Weekend (+${Math.round(pl.weekendRate * 100)}%) on ${plural(wk.length, 'sheet', 'sheets')}`, amount: wk.reduce((a, s) => a + result.perSheet[s.fileKey].weekendPremium, 0) });
    jobKeys.forEach(jk => {
      if (!((pl.rush[jobs[jk].turnaround || 'standard'] || 0) > 0)) return;
      const p = result.perJob[jk];
      out.push({ label: `${TURNAROUND_LABEL[jobs[jk].turnaround]} on ${jobs[jk].jobName}`, amount: p.rush + p.laborRush });
    });
    result.labor.forEach(l => {
      let bracket = '';
      if (l.topUpHours > 0) bracket = ` (includes ${l.minHours}-h minimum)`;
      else if (l.coveredHours > 0) bracket = l.billedHours > 0 ? ` (${hoursText(l.coveredHours)} covered by the ${l.minHours}-h minimum)` : ` (covered by the ${l.minHours}-h minimum)`;
      const shown = l.billedHours > 0 ? l.billedHours : l.hours;   // a 0-h line still shows the hours entered
      out.push({ label: `${l.typeName} ${hoursText(shown)}${bracket}${l.note ? ' — ' + l.note : ''}`, amount: l.base });
    });
    if (Math.abs(result.roundingAdjustment) > 1e-9) out.push({ label: `Rounded to the nearest ${money(pl.roundTo)}`, amount: result.roundingAdjustment });
    if (result.minimumApplied) out.push({ label: `Cut minimum ${money(pl.cutMinimum)}`, amount: result.minimumAdjustment });
    const ours = jobKeys.filter(jk => (jobs[jk].material || {}).kind === 'ours' && result.perJob[jk].sheetCount > 0);
    if (ours.length) {
      const names = [];
      ours.forEach(jk => { const n = jobs[jk].material.name; if (!names.includes(n)) names.push(n); });
      const count = ours.reduce((a, jk) => a + result.perJob[jk].sheetCount, 0);
      out.push({ label: `Material — ${names.join(', ')}, ${plural(count, 'sheet', 'sheets')}`, amount: result.materialPortion });
    } else if (sheets.length) {
      out.push({ label: 'Material — customer supplied', amount: 0 });
    }
    return out;
  }

  return { signatureOf, round2, roundToStep, TURNAROUND_LABEL, priceInvoice, priorLaborHours, VBIT_KEYWORDS, sheetHasVbit, parseTimeSec, formatDuration, signature, repeatGroups, repeatCount, localDate, isWeekendDate, effectiveCutDate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pricing;
