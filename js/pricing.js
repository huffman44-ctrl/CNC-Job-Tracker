/**
 * js/pricing.js — the ONE place that knows what makes two sheets "the same design", how an
 * Aspire time is read, and what a sheet's cut date is. Phase 1 (2026-10-04 spec §8.1, §12.1)
 * shipped these helpers.
 * Phase 2: priceInvoice() — the ONLY place money is computed. Nothing else in the app does price math.
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
        // Minimums per job, per type (Decision 7): sum each type's hours on this job, apply minHours
        // once, and put any shortfall on the LAST line of that type (one line per entry stays).
        const sumByType = {}, lastByType = {};
        lines.forEach((l, i) => { sumByType[l.typeId] = (sumByType[l.typeId] || 0) + (Number(l.hours) || 0); lastByType[l.typeId] = i; });
        lines.forEach((l, i) => {
          const t = types[l.typeId];
          const hours = Number(l.hours) || 0;
          const topUpHours = lastByType[l.typeId] === i ? Math.max(0, (Number(t.minHours) || 0) - sumByType[l.typeId]) : 0;
          const billedHours = hours + topUpHours;
          const base = billedHours * Number(t.rate);
          const rush = base * rp;
          laborBase += base; laborRush += rush;
          labor.push({ jobKey: jk, lineId: l.id, typeId: t.id, typeName: t.name, note: l.note || '', hours, topUpHours, billedHours,
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

    return { total, cutPortion, laborPortion, materialPortion,
      roundingAdjustment: rounded - (cutPortion + laborPortion), minimumAdjustment, minimumApplied: minimumAdjustment > 0,
      perJob, perSheet, labor, lines: [], breakdown: [], _ctx: { priceList: pl, jobs, sheets, jobKeys } };
  }

  return { signatureOf, round2, roundToStep, TURNAROUND_LABEL, priceInvoice, VBIT_KEYWORDS, sheetHasVbit, parseTimeSec, formatDuration, signature, repeatGroups, repeatCount, localDate, isWeekendDate, effectiveCutDate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Pricing;
