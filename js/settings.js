/**
 * js/settings.js — the Settings screen (spec §7.7). Cards: Screens on/off, Customers
 * (billing), Prices, Labor types, QuickBooks, Invoicing (Phase 2 — the pure validate*
 * functions below, exported for node --test) and Maintenance; Materials is Task 13.
 * Owners only: reached through a header button that exists
 * only when Features.on('settings'). app.js owns navigation; this file owns the cards.
 * Uses app.js's global escHtml / formatDT (resolved at call time, after app.js loads).
 */
/* ── Pure validators (no DOM) — every Settings form goes through one of these ── */
const SettingsValidate = (() => {
  const fail = error => ({ ok: false, error });
  // Strict numeric parse: blank / junk / Infinity → null.
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v == null ? '' : v).trim();
    if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t);
  }
  const pctToFraction = p => Math.round(p * 100) / 10000;       // 50 → 0.5
  const fractionToPct = f => Math.round(f * 10000) / 100;       // 0.5 → 50

  function validatePrices(form, base) {
    const f = form || {};
    const fields = [
      ['handlingFirst', 'First-sheet handling'], ['handlingRepeat', 'Repeat handling'], ['hourlyRate', 'Hourly rate'],
      ['rush48Pct', '48-hour rush'], ['rush24Pct', '24-hour rush'], ['weekendPct', 'Weekend'],
      ['cutMinimum', 'Cut minimum'], ['roundTo', 'Round to'],
    ];
    const v = {};
    for (const [k, label] of fields) {
      const n = num(f[k]);
      if (n === null) return fail(`${label} must be a number.`);
      if (n < 0) return fail(`${label} can't be negative.`);
      v[k] = n;
    }
    if (v.roundTo <= 0) return fail('Round to must be more than 0.');
    for (const [k, label] of [['rush48Pct', '48-hour rush'], ['rush24Pct', '24-hour rush'], ['weekendPct', 'Weekend']]) {
      if (v[k] > 300) return fail(`${label} can't be more than 300%.`);
    }
    const keepStandard = base && base.rush && Number.isFinite(base.rush.standard) ? base.rush.standard : 0;
    return { ok: true, list: {
      handlingFirst: v.handlingFirst, handlingRepeat: v.handlingRepeat, hourlyRate: v.hourlyRate,
      rush: { standard: keepStandard, rush48: pctToFraction(v.rush48Pct), rush24: pctToFraction(v.rush24Pct) },
      weekendRate: pctToFraction(v.weekendPct), cutMinimum: v.cutMinimum, roundTo: v.roundTo,
    } };
  }

  function newLaborTypeId(name) {
    const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'type';
    return `lt_${slug}_${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
  }

  // inUse: { typeId: jobCount } (array of ids also accepted). Rows with removed:true are being deleted.
  function validateLaborTypes(rows, inUse) {
    const use = Array.isArray(inUse) ? Object.fromEntries(inUse.map(id => [id, 0])) : (inUse || {});
    const types = [];
    const seen = new Set();
    for (const r of rows || []) {
      const name = String(r.name || '').trim();
      if (r.removed) {
        if (r.id && Object.prototype.hasOwnProperty.call(use, r.id)) {
          const n = use[r.id];
          return fail(n ? `${name || r.id} is used on ${n} job${n === 1 ? '' : 's'} that ${n === 1 ? "isn't" : "aren't"} billed yet.` : `${name || r.id} is still used on jobs that aren't billed yet.`);
        }
        continue;
      }
      if (!name) return fail('Every labor type needs a name.');
      if (seen.has(name.toLowerCase())) return fail(`Two labor types are named ${name}.`);
      seen.add(name.toLowerCase());
      const rate = num(r.rate);
      if (rate === null || rate < 0) return fail(`${name}: the rate must be a number, 0 or more.`);
      const minHours = num(r.minHours);
      if (minHours === null || minHours < 0) return fail(`${name}: minimum hours must be a number, 0 or more.`);
      const qbItem = String(r.qbItem || '').trim();
      if (!qbItem) return fail(`${name}: the QuickBooks item can't be empty.`);
      types.push({ id: r.id || newLaborTypeId(name), name, rate, minHours, qbItem });
    }
    return { ok: true, types };
  }

  function validateQbItems(form) {
    const f = form || {};
    const cnc = String(f.cnc || '').trim(), materials = String(f.materials || '').trim();
    if (!cnc) return fail("The QuickBooks item for CNC work can't be empty.");
    if (!materials) return fail("The QuickBooks item for materials can't be empty.");
    for (const [k, label] of [['taxableCnc', 'CNC work'], ['taxableLabor', 'labor']]) {
      if (f[k] !== 'Y' && f[k] !== 'N') return fail(`Taxable for ${label} must be Y or N.`);
    }
    return { ok: true, doc: { cnc, materials, taxable: { cnc: f.taxableCnc, labor: f.taxableLabor } } };
  }

  function realDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }

  function validateInvoicing(form) {
    const f = form || {};
    const seedText = String(f.seedNumber == null ? '' : f.seedNumber).trim();
    if (!/^\d+$/.test(seedText) || Number(seedText) < 1) return fail('The last invoice number must be a whole number, 1 or more.');
    const dayText = String(f.weekEndingDay == null ? '' : f.weekEndingDay).trim();
    if (!/^[0-6]$/.test(dayText)) return fail('Pick the day the week ends on.');
    if (!['receipt', 'net15', 'net30'].includes(f.defaultDue)) return fail('Pick a default due date.');
    const bs = String(f.billingStartDate || '').trim();
    if (bs && !realDate(bs)) return fail('Billing starts on must be a real date, or blank.');
    return { ok: true, doc: { seedNumber: Number(seedText), weekEndingDay: Number(dayText), defaultDue: f.defaultDue, billingStartDate: bs || null } };
  }

  return { validatePrices, validateLaborTypes, validateQbItems, validateInvoicing, newLaborTypeId, pctToFraction, fractionToPct };
})();

const SettingsScreen = (() => {
  let els = null;
  let opts = { hideOthers() {}, onBack() {}, currentEmail: () => '' };
  const extraOwners = new Set();   // emails typed into "Add column" this session

  const byId = id => document.getElementById(id);
  const localPart = email => String(email || '').split('@')[0];

  function init(options) {
    opts = { ...opts, ...options };
    els = {
      screen: byId('settings-screen'), status: byId('settings-status'), grid: byId('settings-screens-grid'),
      addEmail: byId('settings-add-owner-email'), addBtn: byId('settings-add-owner-btn'),
      customers: byId('settings-customers-list'), migStatus: byId('settings-migration-status'), migBtn: byId('settings-migrate-btn'),
    };
    byId('settings-back-btn').addEventListener('click', () => opts.onBack());
    els.addBtn.addEventListener('click', addOwnerColumn);
    els.addEmail.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOwnerColumn(); } });
    els.grid.addEventListener('change', onSwitchChange);
    els.customers.addEventListener('change', onCustomerChange);
    els.migBtn.addEventListener('click', runMigration);
    initPhase2Cards();
  }

  function setStatus(text, isError) {
    els.status.textContent = text || '';
    els.status.hidden = !text;
    els.status.classList.toggle('settings-status--error', !!isError);
  }

  function show() {
    opts.hideOthers();
    els.screen.hidden = false;
    setStatus('');
    render();
  }

  function render() {
    if (!els || els.screen.hidden) return;
    renderScreens();
    renderCustomers();
    renderPhase2Cards();
    renderMigration();
  }

  /* ── Screens on/off ── */
  function ownerColumns() {
    return [...new Set([...Features.owners(), ...extraOwners])].sort();
  }

  function renderScreens() {
    const owners = ownerColumns();
    els.grid.style.gridTemplateColumns = `minmax(160px, 1fr) repeat(${owners.length}, auto)`;
    let html = '<div class="settings-grid-head">Screen</div>' + owners.map(o => `<div class="settings-grid-head" title="${escHtml(o)}">${escHtml(localPart(o))}</div>`).join('');
    for (const s of Features.SCREENS) {
      html += `<div>${escHtml(s.label)}</div>`;
      for (const o of owners) {
        html += `<label><input type="checkbox" data-screen="${escHtml(s.key)}" data-owner="${escHtml(o)}" ${isOn(s.key, o) ? 'checked' : ''} aria-label="${escHtml(s.label)} for ${escHtml(o)}"></label>`;
      }
    }
    els.grid.innerHTML = html;
  }

  // Features.on() answers for the signed-in owner only; the grid needs every column.
  function isOn(key, owner) {
    const s = Features.getState();
    const sw = s && s[key];
    return !!(sw && sw.on && (sw.users || []).map(u => String(u).toLowerCase()).includes(owner));
  }

  async function onSwitchChange(e) {
    const box = e.target.closest('input[data-screen]');
    if (!box) return;
    try {
      await Features.setSwitch(box.dataset.screen, box.dataset.owner, box.checked);
      setStatus(`${box.checked ? 'On' : 'Off'}: ${Features.SCREENS.find(s => s.key === box.dataset.screen).label} for ${localPart(box.dataset.owner)}.`);
    } catch (err) {
      setStatus(err.message, true);
    }
    render();
  }

  function addOwnerColumn() {
    const email = els.addEmail.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setStatus('Type the full sign-in email.', true); return; }
    extraOwners.add(email);
    els.addEmail.value = '';
    setStatus(`Column added for ${localPart(email)} — tick a switch to remember it.`);
    render();
  }

  /* ── Customers (billing) ── */
  function renderCustomers() {
    const customers = Storage.getCustomers();
    if (!customers.length) { els.customers.innerHTML = '<p class="settings-card-hint">No customers yet — add them in Manage Customers.</p>'; return; }
    els.customers.innerHTML = customers.map(c => {
      const cb = OwnerStore.getCustomerBilling(c.key);
      const outside = !!(cb && cb.billedOutsideApp);
      return `<div class="settings-row"><span>${escHtml(c.name)}</span>
        <label><input type="checkbox" data-customer="${escHtml(c.key)}" data-name="${escHtml(c.name)}" ${outside ? 'checked' : ''}> Billed outside this app</label></div>`;
    }).join('');
  }

  async function onCustomerChange(e) {
    const box = e.target.closest('input[data-customer]');
    if (!box) return;
    try {
      await OwnerStore.setCustomerBilling(box.dataset.customer, { name: box.dataset.name, billedOutsideApp: box.checked }, opts.currentEmail());
      setStatus(`${box.dataset.name}: ${box.checked ? 'billed outside this app' : 'billed here'}.`);
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`, true);
      render();
    }
  }

  /* ── Phase 2 cards: Prices, Labor types, QuickBooks, Invoicing (spec §7.7, §15.8) ── */
  const VAL = SettingsValidate;
  const dirty = { prices: false, labor: false, qb: false, invoicing: false };   // a card being edited is never redrawn from the store
  let laborDraft = null;   // working copy of the labor type rows while that card is edited
  const val = id => byId(id).value;
  const setVal = (id, v) => { byId(id).value = v; };

  function initPhase2Cards() {
    for (const c of Object.keys(dirty)) {
      const card = byId(`settings-${c}-card`);
      const mark = () => { dirty[c] = true; if (c === 'labor') syncLaborDraft(); };
      card.addEventListener('input', mark);
      card.addEventListener('change', mark);
    }
    byId('settings-prices-save').addEventListener('click', savePrices);
    byId('settings-labor-save').addEventListener('click', saveLabor);
    byId('settings-labor-add').addEventListener('click', addLaborRow);
    byId('settings-labor-restore').addEventListener('click', restoreLabor);
    byId('settings-labor-body').addEventListener('click', e => {
      const b = e.target.closest('button[data-lt-remove]');
      if (b) removeLaborRow(Number(b.dataset.ltRemove));
    });
    byId('settings-qb-save').addEventListener('click', saveQb);
    byId('settings-invoicing-save').addEventListener('click', saveInvoicing);
  }

  function savedCaption(name) {
    const s = OwnerStore.getSetting(name);
    if (!s || !s.savedAt) return '';
    const d = new Date(s.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return s.savedBy ? `Saved by ${localPart(s.savedBy)} · ${d}` : `Saved ${d}`;
  }

  function renderPhase2Cards() {
    const canSave = OwnerStore.loaded('settings');
    for (const id of ['prices', 'labor', 'qb', 'invoicing']) byId(`settings-${id}-save`).disabled = !canSave;
    byId('settings-labor-restore').disabled = !canSave;
    if (!dirty.prices) {
      const std = (OwnerStore.pricing().lists || {}).standard || {};
      const rush = std.rush || {};
      const show = v => (Number.isFinite(v) ? v : '');
      const pct = v => (Number.isFinite(v) ? VAL.fractionToPct(v) : '');
      setVal('settings-price-handlingFirst', show(std.handlingFirst)); setVal('settings-price-handlingRepeat', show(std.handlingRepeat));
      setVal('settings-price-hourlyRate', show(std.hourlyRate)); setVal('settings-price-rush48Pct', pct(rush.rush48));
      setVal('settings-price-rush24Pct', pct(rush.rush24)); setVal('settings-price-weekendPct', pct(std.weekendRate));
      setVal('settings-price-cutMinimum', show(std.cutMinimum)); setVal('settings-price-roundTo', show(std.roundTo));
    }
    byId('settings-prices-saved').textContent = savedCaption('pricing');
    if (!dirty.labor) laborDraft = OwnerStore.laborTypes().map(t => ({ id: t.id, name: t.name, rate: t.rate, minHours: t.minHours, qbItem: t.qbItem }));
    if (!dirty.labor || !byId('settings-labor-body').children.length) renderLaborRows();
    byId('settings-labor-saved').textContent = savedCaption('laborTypes');
    if (!dirty.qb) {
      const q = OwnerStore.qbItems();
      setVal('settings-qb-cnc', q.cnc || ''); setVal('settings-qb-materials', q.materials || '');
      setVal('settings-qb-taxableCnc', q.taxable.cnc === 'Y' ? 'Y' : 'N'); setVal('settings-qb-taxableLabor', q.taxable.labor === 'Y' ? 'Y' : 'N');
    }
    byId('settings-qb-saved').textContent = savedCaption('qbItems');
    if (!dirty.invoicing) {
      const iv = OwnerStore.invoicing();
      setVal('settings-inv-seedNumber', iv.seedNumber == null ? '' : iv.seedNumber);
      setVal('settings-inv-weekEndingDay', String(Number.isInteger(iv.weekEndingDay) ? iv.weekEndingDay : 6));
      setVal('settings-inv-defaultDue', ['receipt', 'net15', 'net30'].includes(iv.defaultDue) ? iv.defaultDue : 'receipt');
      setVal('settings-inv-billingStartDate', iv.billingStartDate || '');
    }
    byId('settings-invoicing-saved').textContent = savedCaption('invoicing');
  }

  // Every Save: validate → setSetting → clear dirty → redraw. Errors show as "Couldn't save — …".
  async function saveCard(card, settingName, build, okMessage) {
    setStatus('');
    try {
      const out = build();
      if (!out.ok) { setStatus(`Couldn't save — ${out.error}`, true); return; }
      await OwnerStore.setSetting(settingName, out.data, opts.currentEmail());
      dirty[card] = false;
      setStatus(okMessage);
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`, true);
    }
    renderPhase2Cards();
  }

  function savePrices() {
    saveCard('prices', 'pricing', () => {
      const cur = OwnerStore.pricing();
      const r = VAL.validatePrices({
        handlingFirst: val('settings-price-handlingFirst'), handlingRepeat: val('settings-price-handlingRepeat'), hourlyRate: val('settings-price-hourlyRate'),
        rush48Pct: val('settings-price-rush48Pct'), rush24Pct: val('settings-price-rush24Pct'), weekendPct: val('settings-price-weekendPct'),
        cutMinimum: val('settings-price-cutMinimum'), roundTo: val('settings-price-roundTo'),
      }, (cur.lists || {}).standard);
      // setSetting replaces top-level keys, so write the whole lists object (other lists are kept).
      return r.ok ? { ok: true, data: { lists: { ...(cur.lists || {}), standard: r.list } } } : r;
    }, 'Prices saved.');
  }

  /* labor types */
  function syncLaborDraft() {
    if (!laborDraft) return;
    byId('settings-labor-body').querySelectorAll('tr[data-lt-idx]').forEach(tr => {
      const r = laborDraft[Number(tr.dataset.ltIdx)];
      if (!r) return;
      r.name = tr.querySelector('[data-f="name"]').value; r.rate = tr.querySelector('[data-f="rate"]').value;
      r.minHours = tr.querySelector('[data-f="minHours"]').value; r.qbItem = tr.querySelector('[data-f="qbItem"]').value;
    });
  }

  function renderLaborRows() {
    const visible = (laborDraft || []).map((r, i) => ({ r, i })).filter(x => !x.r.removed);
    byId('settings-labor-body').innerHTML = visible.map(({ r, i }) => `<tr data-lt-idx="${i}">
      <td><input class="form-input" data-f="name" value="${escHtml(r.name)}" aria-label="Name"></td>
      <td><input class="form-input" data-f="rate" inputmode="decimal" value="${escHtml(r.rate)}" aria-label="Rate per hour"></td>
      <td><input class="form-input" data-f="minHours" inputmode="decimal" value="${escHtml(r.minHours)}" aria-label="Minimum hours per job"></td>
      <td><input class="form-input" data-f="qbItem" value="${escHtml(r.qbItem)}" aria-label="QuickBooks item"></td>
      <td><button type="button" class="btn btn-outline btn-sm" data-lt-remove="${i}">Remove</button></td></tr>`).join('');
    byId('settings-labor-restore').hidden = visible.length > 0;
    byId('settings-labor-table').hidden = visible.length === 0;
  }

  // typeId → number of jobs with a labor line of that type that is not billed yet (an open invoice counts).
  function laborTypesInUse() {
    const counts = {};
    for (const jb of OwnerStore.allJobBilling()) {
      const used = new Set();
      for (const l of jb.laborLines || []) {
        if (l.typeId && (!l.status || l.status === 'unbilled' || l.status === 'in-progress')) used.add(l.typeId);
      }
      used.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    }
    return counts;
  }

  function addLaborRow() {
    syncLaborDraft(); dirty.labor = true;
    laborDraft.push({ id: null, name: '', rate: '', minHours: '0', qbItem: '' });
    renderLaborRows();
  }

  function removeLaborRow(i) {
    syncLaborDraft();
    const r = laborDraft[i];
    if (!r) return;
    const check = VAL.validateLaborTypes([{ ...r, removed: true }], laborTypesInUse());
    if (!check.ok) { setStatus(check.error, true); return; }
    setStatus('');
    if (r.id) r.removed = true; else laborDraft.splice(i, 1);   // a saved type is only deleted on Save
    dirty.labor = true;
    renderLaborRows();
  }

  function saveLabor() {
    syncLaborDraft();
    saveCard('labor', 'laborTypes', () => {
      const r = VAL.validateLaborTypes(laborDraft, laborTypesInUse());
      return r.ok ? { ok: true, data: { types: r.types } } : r;
    }, 'Labor types saved.');
  }

  function restoreLabor() {
    saveCard('labor', 'laborTypes', () => ({ ok: true, data: { types: JSON.parse(JSON.stringify(OwnerStore.SEEDS.laborTypes.types)) } }), 'Design and CAM restored.');
  }

  /* QuickBooks + Invoicing */
  function saveQb() {
    saveCard('qb', 'qbItems', () => {
      const r = VAL.validateQbItems({ cnc: val('settings-qb-cnc'), materials: val('settings-qb-materials'), taxableCnc: val('settings-qb-taxableCnc'), taxableLabor: val('settings-qb-taxableLabor') });
      return r.ok ? { ok: true, data: r.doc } : r;
    }, 'QuickBooks items saved.');
  }

  function saveInvoicing() {
    saveCard('invoicing', 'invoicing', () => {
      const r = VAL.validateInvoicing({ seedNumber: val('settings-inv-seedNumber'), weekEndingDay: val('settings-inv-weekEndingDay'), defaultDue: val('settings-inv-defaultDue'), billingStartDate: val('settings-inv-billingStartDate') });
      return r.ok ? { ok: true, data: r.doc } : r;
    }, 'Invoicing saved.');
  }

  /* ── Maintenance ── */
  function renderMigration() {
    const st = Storage.migrationState();
    els.migStatus.textContent = st
      ? `Done ${formatDT(new Date(st.at))} — ${st.count} sheet${st.count !== 1 ? 's' : ''} stamped. Running again is safe; it finds nothing to do.`
      : 'Not run yet. Until it runs, every device loads all sheets and hides finished ones in the browser. Run it once after every device, including the shop PC, has hard-refreshed onto this version.';
    els.migBtn.textContent = st ? 'Run again' : 'Run';
  }

  async function runMigration() {
    if (!confirm('Stamp every existing sheet as "on the board" (finished: false)? Nothing is deleted and nothing leaves the board. Safe to run more than once.')) return;
    els.migBtn.disabled = true;
    try {
      const res = await Storage.migrateFinishedFlag((done, total) => { els.migStatus.textContent = `Stamping ${done} of ${total}…`; });
      setStatus(`Migration done — ${res.stamped} of ${res.total} sheets needed the flag. The board now uses the finished filter on next load.`);
    } catch (err) {
      setStatus(`Migration failed — ${err.message}. Nothing is lost; run it again.`, true);
    } finally {
      els.migBtn.disabled = false;
      renderMigration();
    }
  }

  return { init, show, render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SettingsValidate;
