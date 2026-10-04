/**
 * js/job-card.js — the owner panel on the job card (spec §7.2) plus the two small owner
 * decorations elsewhere: the board card's job-level chip and the sidebar row's status/tags.
 * Collin's sheet workspace is untouched: app.js calls nothing here unless
 * Features.on('jobCard'). Plain words, no status key, never a price (spec §5.1).
 * Globals used at runtime: escHtml, formatDT (app.js), OwnerStore, Storage, Pricing.
 */
const JobCard = (() => {
  let hooks = { noteKey: null, currentEmail: () => '', openEdit: async () => false, onChanged() {}, onPutBack: async () => {} };
  let editingCutDateKey = null;   // fileKey whose cut-date editor is open
  let statusText = '';
  let sheetsProvider = () => [];
  const TURNAROUND = { standard: 'Standard', rush48: '48-hour rush', rush24: '24-hour rush' };
  const NOT_LOADED = "Owner data didn't load — reload the page.";

  function init(h) { hooks = { ...hooks, ...h }; }
  function setSheetsProvider(fn) { sheetsProvider = fn; }

  // Real local calendar date, 'YYYY-MM-DD' only (a typed or pasted value must round-trip).
  function validYmd(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return false;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }

  function longDate(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return ymd || '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function shortDate(ms) { const d = new Date(ms); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

  /* ── Job-level state ── */
  function jobState(jobName) {
    const jobKey = hooks.noteKey(jobName);
    if (!OwnerStore.hasJobDetails(jobKey)) return 'needs';
    return OwnerStore.getJobBilling(jobKey).readyForBilling ? 'ready' : 'not-ready';
  }

  function chip(state) {
    const span = document.createElement('span');
    span.className = 'jc-chip ' + { needs: 'jc-chip--needs', ready: 'jc-chip--ready', 'not-ready': 'jc-chip--muted' }[state];
    span.textContent = { needs: 'Needs job details', ready: 'Ready for billing ✓', 'not-ready': 'Not sent to billing yet' }[state];
    return span;
  }

  function cardChip(jobName) { return chip(jobState(jobName)); }

  /* ── Sheet-level words ── */
  function sheetStatus(sheet) {
    const sb = OwnerStore.getSheetBilling(sheet.fileKey);
    if (sb && sb.status === 'billed') return `Billed · #${sb.invoiceNumber}`;
    if (sb && sb.status === 'in-progress') return `On invoice ${sb.invoiceNumber} (in progress)`;
    const rec = Storage.get(sheet.fileKey, 'sheet');
    return rec && rec.status === 'complete' ? 'Cut' : 'Not cut yet';
  }

  function sheetTags(sheet, groups) {
    const tags = [];
    const rec = Storage.get(sheet.fileKey, 'sheet');
    const sb = OwnerStore.getSheetBilling(sheet.fileKey);
    const cutDate = Pricing.effectiveCutDate(rec, sb);
    if (cutDate && Pricing.isWeekendDate(cutDate)) tags.push('Weekend');
    const g = groups && groups[sheet.fileKey];
    if (g && g.repeatOf) tags.push(`Repeat of sheet ${g.repeatOf}`);
    // Billed on one cut time, cut again since (or the record cleared): a re-cut, never charged.
    if (sb && sb.cutAtBilled && (!rec || rec.completedAt !== sb.cutAtBilled)) {
      tags.push(rec && rec.completedAt ? `Re-cut ${shortDate(rec.completedAt)}` : 'Re-cut (record cleared)');
    }
    if (sb && sb.cutDateOverride) tags.push(`cut date corrected to ${longDate(sb.cutDateOverride)}`);
    return tags;
  }

  function navRowExtras(sheet, groups) {
    const div = document.createElement('div');
    div.className = 'jc-row-tags';
    const parts = [escHtml(sheetStatus(sheet))].concat(sheetTags(sheet, groups).map(t => t === 'Weekend' ? '<span class="jc-row-weekend">Weekend</span>' : escHtml(t)));
    div.innerHTML = parts.join(' · ');
    return div;
  }

  /* ── The panel ── */
  function renderOwnerPanel(container, jobName, orderedSheets) {
    if (!container.dataset.jcBound) { container.addEventListener('click', onClick); container.addEventListener('change', onChange); container.dataset.jcBound = '1'; }
    const e = escHtml;
    const jobKey = hooks.noteKey(jobName);
    const jb = OwnerStore.getJobBilling(jobKey);
    const hasDetails = OwnerStore.hasJobDetails(jobKey);
    const groups = Pricing.repeatGroups(orderedSheets);
    const cut = orderedSheets.filter(s => { const r = Storage.get(s.fileKey, 'sheet'); return r && r.status === 'complete'; }).length;
    const finished = orderedSheets.length > 0 && orderedSheets.every(s => s.finished === true);
    const jbOk = OwnerStore.loaded('jobBilling');
    const sbOk = OwnerStore.loaded('sheetBilling');
    const noWrite = jbOk ? '' : ' disabled';
    container.dataset.jobName = jobName;

    const chips = [];
    if (hasDetails && jb.turnaround && jb.turnaround !== 'standard') chips.push(TURNAROUND[jb.turnaround] || jb.turnaround);
    if (hasDetails && jb.material) chips.push(jb.material.kind === 'ours' ? (jb.material.name || 'Our material') : 'Customer supplied');

    let html = `<div class="jc-head">
      <strong>${e(hasDetails ? jb.customerName : 'No customer yet')}</strong>
      ${chips.map(c => `<span class="jc-chip">${e(c)}</span>`).join('')}
      <button type="button" class="btn btn-outline btn-sm" data-action="edit"${noWrite}>${hasDetails ? 'Edit job details' : 'Add job details'}</button>
      <span class="jc-caption">${cut} of ${orderedSheets.length} sheet${orderedSheets.length !== 1 ? 's' : ''} cut</span>
      ${chip(jobState(jobName)).outerHTML}
      ${finished ? '<button type="button" class="btn btn-ghost btn-sm" data-action="putback">Put back on the board</button>' : ''}
    </div>`;
    if (!jbOk) html += `<div class="jc-caption vanlab-status-error">${e(NOT_LOADED)}</div>`;

    html += `<table class="jc-table"><thead><tr><th>#</th><th>Sheet</th><th>Aspire time</th><th>Cut</th><th>Status</th><th>Tags</th>${finished ? '<th></th>' : ''}</tr></thead><tbody>`;
    orderedSheets.forEach((s, i) => {
      const rec = Storage.get(s.fileKey, 'sheet');
      const sb = OwnerStore.getSheetBilling(s.fileKey);
      const locked = !!(sb && (sb.status === 'in-progress' || sb.status === 'billed'));
      const cutText = rec && rec.status === 'complete' ? e(formatDT(new Date(rec.completedAt))) : '';
      const cutCell = rec && rec.status === 'complete'
        ? ((locked || !sbOk) ? cutText : `<button type="button" class="jc-link" data-action="cutdate" data-key="${e(s.fileKey)}" title="Correct the cut date">${cutText}</button>`) + (rec.operator ? ` · ${e(rec.operator)}` : '')
        : '—';
      const editor = editingCutDateKey === s.fileKey && sbOk ? `<div class="jc-cutdate-edit"><input type="date" class="form-input" data-cutdate-input value="${e((sb && sb.cutDateOverride) || Pricing.effectiveCutDate(rec, null) || '')}">
          <button type="button" class="btn btn-primary btn-sm" data-action="cutdate-save" data-key="${e(s.fileKey)}">Save</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cutdate-clear" data-key="${e(s.fileKey)}">Use Collin's time</button>
          <button type="button" class="btn btn-ghost btn-sm" data-action="cutdate-cancel">Cancel</button></div>` : '';
      html += `<tr><td>${i + 1}</td><td>${e(s.sheetTitle || s.fileName)}</td><td>${e(s.totalTime || '—')}</td><td>${cutCell}${editor}</td><td>${e(sheetStatus(s))}</td><td class="jc-tags">${sheetTags(s, groups).map(e).join(' · ')}</td>`;
      if (finished) html += `<td>${s.archiveUrl ? `<a href="${e(s.archiveUrl)}" target="_blank" rel="noopener">Open archived drawing</a>` : ''}</td>`;
      html += '</tr>';
    });
    html += '</tbody></table>';
    if (!sbOk) html += `<div class="jc-caption vanlab-status-error">${e("Cut dates can't be corrected — owner data didn't load. Reload the page.")}</div>`;

    if (hasDetails) {
      const types = OwnerStore.laborTypes();
      const lines = Array.isArray(jb.laborLines) ? jb.laborLines : [];
      const anyBilled = lines.some(l => l.status === 'billed' || l.status === 'in-progress');
      const rateOf = id => types.find(t => t.id === id);
      html += `<div class="jc-labor"><div class="jc-labor-title">Design / CAM hours</div>`;
      if (lines.length) {
        html += `<table class="jc-table"><thead><tr><th>Type</th><th>Hours</th><th>What it was for (prints on the invoice)</th><th>Entered</th><th></th></tr></thead><tbody>` +
          lines.map(l => {
            const t = rateOf(l.typeId);
            const typeCell = (l.typeName || (t && t.name) || l.typeId) + (t && t.rate != null ? ` — $${Number(t.rate).toFixed(0)}/hr` : '');
            return `<tr><td>${e(typeCell)}</td><td>${e(l.hours)}</td><td>${e(l.note || '')}</td><td class="jc-caption">${e(l.enteredBy ? l.enteredBy.split('@')[0] : '')}${l.enteredAt ? ' · ' + e(formatDT(new Date(l.enteredAt))) : ''}</td>
            <td>${(l.status || 'unbilled') === 'unbilled' ? `<button type="button" class="jc-link" data-action="line-remove" data-line="${e(l.id)}"${noWrite}>Remove</button>` : `<span class="jc-caption">${l.status === 'billed' ? `Billed · #${e(l.invoiceNumber)}` : `On invoice ${e(l.invoiceNumber)} (in progress)`}</span>`}</td></tr>`;
          }).join('') +
          '</tbody></table>';
      }
      if (!jb.readyForBilling) {
        html += `<div class="jc-labor-add">
          <select class="form-input" data-line-type${noWrite}>${types.map(t => `<option value="${e(t.id)}">${e(t.name)} — $${Number(t.rate).toFixed(0)}/hr${t.minHours ? ` (min ${t.minHours} h)` : ''}</option>`).join('')}</select>
          <input type="number" class="form-input jc-hours" data-line-hours min="0" step="0.25" placeholder="Hours"${noWrite}>
          <input type="text" class="form-input jc-note" data-line-note placeholder="What it was for (prints on the invoice)"${noWrite}>
          <button type="button" class="btn btn-outline btn-sm" data-action="line-add"${noWrite}>Add line</button>
        </div>`;
      }
      html += `<label class="jc-caption"><input type="checkbox" data-action="nodesign" ${jb.noDesignTime ? 'checked' : ''} ${(jb.readyForBilling || !jbOk) ? 'disabled' : ''}> No design time on this job</label>`;
      html += `<div class="jc-actions">`;
      if (jb.readyForBilling) {
        html += `<span class="jc-caption">Marked ready${jb.readyBy ? ' by ' + e(jb.readyBy.split('@')[0]) : ''}${jb.readyAt ? ' · ' + e(formatDT(new Date(jb.readyAt))) : ''}.</span>
          <button type="button" class="btn btn-ghost btn-sm" data-action="notready" ${(anyBilled || !jbOk) ? `disabled title="${anyBilled ? 'Design hours on this job are already on an invoice' : e(NOT_LOADED)}"` : ''}>Edit — not ready yet</button>`;
      } else {
        html += `<button type="button" class="btn btn-primary btn-sm" data-action="done" ${((lines.length || jb.noDesignTime) && jbOk) ? '' : 'disabled'}>Done — ready for billing</button>
          <span class="jc-caption">Cut sheets can still go on a weekly bill before this. Design hours wait for this button.${jb.turnaround !== 'standard' ? ' Rush applies to these hours too.' : ''}</span>`;
      }
      html += `</div>`;
      if (jb.updatedBy || jb.updatedAt) html += `<div class="jc-caption">Saved by ${e((jb.updatedBy || '').split('@')[0] || 'owner')}${jb.updatedAt ? ' · ' + e(formatDT(new Date(jb.updatedAt))) : ''}</div>`;
      html += '</div>';
    } else {
      html += `<div class="jc-caption">Set the customer, material and turnaround so this job can be billed. Collin can still cut and export it meanwhile.</div>`;
    }
    html += `<div class="jc-status${/^Couldn/.test(statusText) ? ' vanlab-status-error' : ''}">${e(statusText)}</div>`;
    container.innerHTML = html;
  }

  function setStatus(t) { statusText = t || ''; hooks.onChanged(); }

  async function onClick(ev) {
    const btn = ev.target.closest('[data-action]');
    if (!btn || btn.tagName !== 'BUTTON' || btn.disabled) return;
    const container = ev.currentTarget;
    const jobName = container.dataset.jobName;
    const jobKey = hooks.noteKey(jobName);
    const by = hooks.currentEmail();
    const action = btn.dataset.action;
    // P24: every write that rebuilds jobBilling / sheetBilling from the cache needs a real load.
    const needsJb = ['edit', 'line-add', 'line-remove', 'done', 'notready'].includes(action);
    const needsSb = action === 'cutdate' || action === 'cutdate-save' || action === 'cutdate-clear';
    if ((needsJb && !OwnerStore.loaded('jobBilling')) || (needsSb && !OwnerStore.loaded('sheetBilling'))) { setStatus(`Couldn't save — ${NOT_LOADED}`); return; }
    const jb = OwnerStore.getJobBilling(jobKey);
    try {
      if (action === 'edit') {
        await hooks.openEdit(jobName, sheetsProvider());
        statusText = '';
        hooks.onChanged();
      } else if (action === 'cutdate') {
        editingCutDateKey = btn.dataset.key; statusText = ''; hooks.onChanged();
      } else if (action === 'cutdate-cancel') {
        editingCutDateKey = null; hooks.onChanged();
      } else if (action === 'cutdate-save' || action === 'cutdate-clear') {
        const input = container.querySelector('[data-cutdate-input]');
        const ymd = action === 'cutdate-clear' ? null : (input && input.value);
        if (action === 'cutdate-save') {
          if (!ymd) { setStatus("Couldn't save — pick a date first."); return; }
          if (!validYmd(ymd)) { setStatus("Couldn't save — that isn't a real date (use YYYY-MM-DD)."); return; }
        }
        await OwnerStore.setCutDateOverride(btn.dataset.key, ymd, { jobKey, customerKey: jb && jb.customerKey }, by);
        editingCutDateKey = null;
        setStatus(ymd ? `Cut date corrected to ${longDate(ymd)}.` : "Using Collin's cut time again.");
      } else if (action === 'line-add') {
        const typeId = container.querySelector('[data-line-type]').value;
        const hours = Number(container.querySelector('[data-line-hours]').value);
        const note = container.querySelector('[data-line-note]').value.trim();
        if (!typeId) { setStatus("Couldn't add — pick a type."); return; }
        if (!(hours > 0)) { setStatus("Couldn't add — hours must be more than 0."); return; }
        await OwnerStore.setJobBilling(jobKey, { laborLines: [...(jb.laborLines || []), OwnerStore.newLaborLine(typeId, hours, note, by)] }, by);
        setStatus(`${hours} h added.`);
      } else if (action === 'line-remove') {
        await OwnerStore.setJobBilling(jobKey, { laborLines: (jb.laborLines || []).filter(l => !(l.id === btn.dataset.line && (l.status || 'unbilled') === 'unbilled')) }, by);
        setStatus('Line removed.');
      } else if (action === 'done') {
        await OwnerStore.setJobBilling(jobKey, { readyForBilling: true, readyAt: Date.now(), readyBy: by }, by);
        setStatus('Ready for billing. Design hours go on the next bill.');
      } else if (action === 'notready') {
        await OwnerStore.setJobBilling(jobKey, { readyForBilling: false, readyAt: null, readyBy: null }, by);
        setStatus('Not ready — edit away.');
      } else if (action === 'putback') {
        const sheetsNow = sheetsProvider();
        if (!confirm(`Put "${jobName}" back on the board for everyone? Its ${sheetsNow.length} sheet${sheetsNow.length !== 1 ? 's' : ''} become active again; billing records are untouched.`)) return;
        await Storage.unfinishSheets(sheetsNow.map(s => s.fileKey));
        await Storage.reopenJob(jobKey);
        statusText = '';
        await hooks.onPutBack(jobName);
      }
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`);
    }
  }

  async function onChange(ev) {
    const box = ev.target.closest('input[data-action="nodesign"]');
    if (!box) return;
    const container = ev.currentTarget;
    if (!OwnerStore.loaded('jobBilling')) { setStatus(`Couldn't save — ${NOT_LOADED}`); return; }
    const jobKey = hooks.noteKey(container.dataset.jobName);
    try {
      await OwnerStore.setJobBilling(jobKey, { noDesignTime: box.checked }, hooks.currentEmail());
      setStatus(box.checked ? 'No design time on this job.' : '');
    } catch (err) {
      setStatus(`Couldn't save — ${err.message}`);
    }
  }

  return { init, setSheetsProvider, cardChip, sheetStatus, sheetTags, navRowExtras, renderOwnerPanel, validYmd };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JobCard;
