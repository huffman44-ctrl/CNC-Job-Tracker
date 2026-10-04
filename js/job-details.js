/**
 * js/job-details.js — the owner's job-details step (spec §7.1): after a drop, one blocking form
 * per NEW job (no jobBilling doc yet) asks customer, material and turnaround, then writes
 * projectCustomer/, jobs/ and jobBilling/. The same form reopens from the job card as "Edit job
 * details". Collin never sees it: app.js opens it only when Features.on('jobDetails').
 * Pure helpers (thickness, size) have no DOM so node --test can load this file; init() wires it.
 * Uses app.js globals at runtime only: escHtml.
 */
const JobDetails = (() => {
  const num = s => { const m = /(-?\d+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1]) : null; };

  // VCarve: "Material Block: X: 48"  Y: 96"  Z: 0.47"" — Z is the thickness. A line labelled
  // Thickness wins when the CAM template has one; "Material Size" falls back to its last number.
  function thicknessFromMaterialInfo(materialInfo) {
    const info = Array.isArray(materialInfo) ? materialInfo : [];
    const thick = info.find(x => /thickness/i.test(x.label || ''));
    if (thick) return num(thick.value);
    const block = info.find(x => /material\s*(block|size)/i.test(x.label || ''));
    if (!block) return null;
    const z = /Z:\s*(-?\d+(?:\.\d+)?)/i.exec(String(block.value || ''));
    if (z) return Number(z[1]);
    const nums = String(block.value || '').match(/-?\d+(?:\.\d+)?/g);
    return nums && nums.length ? Number(nums[nums.length - 1]) : null;
  }

  function sheetSizeLabel(materialInfo) {
    const info = Array.isArray(materialInfo) ? materialInfo : [];
    const block = info.find(x => /material\s*(block|size)/i.test(x.label || ''));
    if (!block) return '';
    const x = /X:\s*(\d+(?:\.\d+)?)/i.exec(block.value || ''), y = /Y:\s*(\d+(?:\.\d+)?)/i.exec(block.value || '');
    return x && y ? `${x[1]}×${y[1]}` : '';
  }

  let els = null;
  let hooks = { noteKey: null, customerKey: null, currentEmail: () => '', onCancelJob: async () => {}, fillCustomerSelect: null };
  let ctx = null;   // { mode:'new'|'edit', jobName, jobKey, jobSheets, thicknessIn, resolve }

  function init(h) {
    hooks = { ...hooks, ...h };
    const byId = id => document.getElementById(id);
    els = {
      overlay: byId('job-details-overlay'), title: byId('job-details-title'), subtitle: byId('job-details-subtitle'),
      sheets: byId('job-details-sheets'), summary: byId('job-details-summary'),
      customer: byId('job-details-customer'), otherGroup: byId('job-details-customer-other-group'), other: byId('job-details-customer-other'),
      oursRadio: byId('job-details-material-ours'), material: byId('job-details-material'), materialHint: byId('job-details-material-hint'),
      error: byId('job-details-error'), cancel: byId('job-details-cancel'), confirm: byId('job-details-confirm'),
    };
    els.customer.addEventListener('change', () => { els.otherGroup.hidden = els.customer.value !== '__other__'; applyMaterialDefault(); });
    els.cancel.addEventListener('click', () => close(false));
    els.confirm.addEventListener('click', submit);
    // No click-outside-to-close: this step is blocking on purpose (a job without details is
    // what "Needs job details" exists to catch).
  }

  function showError(msg) { els.error.textContent = msg || ''; els.error.hidden = !msg; }

  function open(mode, jobName, jobSheets) {
    return new Promise(resolve => {
      const jobKey = hooks.noteKey(jobName);
      const existing = OwnerStore.getJobBilling(jobKey);
      const thicknessIn = thicknessFromMaterialInfo(jobSheets[0] && jobSheets[0].materialInfo);
      ctx = { mode, jobName, jobKey, jobSheets, thicknessIn, resolve };
      els.title.textContent = mode === 'edit' ? 'Edit job details' : 'Job details';
      els.subtitle.textContent = jobName;
      els.confirm.textContent = mode === 'edit' ? 'Save job details' : 'Add job to the board';
      showError('');

      els.sheets.innerHTML = jobSheets.map((s, i) => {
        const size = sheetSizeLabel(s.materialInfo);
        const t = thicknessFromMaterialInfo(s.materialInfo);
        const dims = size ? `${size}${t != null ? ` × ${t} in` : ''}` : (t != null ? `${t} in` : '');
        return `<div class="jd-sheet-row"><span class="jd-sheet-num">${i + 1}.</span><span>${escHtml(s.sheetTitle || s.fileName)}</span>` +
          `<span class="jd-hint">${escHtml(dims)}${dims ? ' · ' : ''}${(s.toolpaths || []).length} toolpath${(s.toolpaths || []).length !== 1 ? 's' : ''} · ${escHtml(s.totalTime || '—')}</span></div>`;
      }).join('');
      const totalSec = jobSheets.reduce((n, s) => n + Pricing.parseTimeSec(s.totalTime), 0);
      const repeats = Pricing.repeatCount(jobSheets);
      els.summary.textContent = `${jobSheets.length} sheet${jobSheets.length !== 1 ? 's' : ''} · ${Pricing.formatDuration(totalSec)} Aspire time · ${repeats ? `${repeats} repeat${repeats !== 1 ? 's' : ''} found` : 'no repeats found in this job'}`;

      // Same option list + prior-customer handling as the export picker (shared in app.js).
      hooks.fillCustomerSelect(els.customer, els.otherGroup, els.other, jobKey, existing && existing.customerName);

      const materials = OwnerStore.materials();
      els.material.innerHTML = materials.map(m => `<option value="${escHtml(m.id)}">${escHtml(m.name)} — $${Number(m.pricePerSheet || 0).toFixed(2)} / sheet</option>`).join('');
      els.oursRadio.disabled = materials.length === 0;
      els.material.disabled = materials.length === 0;
      els.materialHint.textContent = materials.length ? '' : 'No materials set up yet — Settings › Materials arrives with Phase 2.';

      const mat = existing ? existing.material : null;
      setRadio('jd-material', mat && mat.kind === 'ours' && materials.length ? 'ours' : 'customer');
      if (mat && mat.kind === 'ours' && mat.materialId) els.material.value = mat.materialId;
      setRadio('jd-turnaround', (existing && existing.turnaround) || 'standard');
      if (!existing) applyMaterialDefault();

      els.overlay.classList.remove('hidden');
      setTimeout(() => els.customer.focus(), 50);
    });
  }

  function setRadio(name, value) { const el = document.querySelector(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; }
  function radio(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }

  // Pre-fill from the customer's remembered default for this thickness (spec §7.1).
  function applyMaterialDefault() {
    if (!ctx || ctx.mode === 'edit' || ctx.thicknessIn == null) return;
    const key = els.customer.value && els.customer.value !== '__other__' ? els.customer.value : null;
    const cb = key ? OwnerStore.getCustomerBilling(key) : null;
    const def = cb && cb.defaultMaterialByThickness && cb.defaultMaterialByThickness[String(ctx.thicknessIn)];
    if (!def) return;
    const name = (Storage.getCustomers().find(c => c.key === key) || {}).name || 'this customer';
    if (def.kind === 'ours' && OwnerStore.materials().some(m => m.id === def.materialId)) {
      setRadio('jd-material', 'ours'); els.material.value = def.materialId;
      els.materialHint.textContent = `Picked for you: the last ${ctx.thicknessIn} in job for ${name} used ${def.name || 'our material'}.`;
    } else {
      setRadio('jd-material', 'customer');
      els.materialHint.textContent = `Picked for you: the last ${ctx.thicknessIn} in job for ${name} was customer supplied.`;
    }
  }

  async function submit() {
    if (!ctx) return;
    let customerName, customerKey;
    if (els.customer.value === '__other__') {
      customerName = els.other.value.trim();
      if (!customerName) { showError('Type the customer name exactly as QuickBooks spells it.'); return; }
      customerKey = hooks.customerKey(customerName);
    } else {
      const match = Storage.getCustomers().find(c => c.key === els.customer.value);
      if (!match) { showError('Pick a customer.'); return; }
      customerName = match.name; customerKey = match.key;
    }
    const kind = radio('jd-material');
    let material = { kind: 'customer', materialId: null, name: '', pricePerSheet: 0 };
    if (kind === 'ours') {
      const m = OwnerStore.materials().find(x => x.id === els.material.value);
      if (!m) { showError('Pick one of our materials, or choose Customer supplied.'); return; }
      material = { kind: 'ours', materialId: m.id, name: m.name, pricePerSheet: Number(m.pricePerSheet || 0) };   // price snapshot at selection
    }
    const turnaround = radio('jd-turnaround') || 'standard';
    const by = hooks.currentEmail();
    els.confirm.disabled = true;
    try {
      if (!Storage.getCustomers().some(c => c.key === customerKey)) await Storage.addCustomer(customerKey, customerName);
      await Storage.setProjectCustomer(ctx.jobKey, customerName);
      await Storage.upsertJob(ctx.jobKey, ctx.jobName, by);
      await OwnerStore.setJobBilling(ctx.jobKey, { jobName: ctx.jobName, customerKey, customerName, material, turnaround, thicknessIn: ctx.thicknessIn }, by);
      // The details are saved; a failed remembered-default must not strand the form.
      try { await OwnerStore.rememberMaterialDefault(customerKey, customerName, ctx.thicknessIn, material); }
      catch (err) { console.warn('rememberMaterialDefault failed:', err); }
      close(true);
    } catch (err) {
      showError(`Couldn't save — ${err.message}`);
    } finally {
      els.confirm.disabled = false;
    }
  }

  function close(result) {
    els.overlay.classList.add('hidden');
    const c = ctx; ctx = null;
    if (c) c.resolve(result);
  }

  // One form per job that has no details yet, in sequence (spec §7.1). Cancel = the job was
  // never uploaded: onCancel(jobName) removes ONLY what this drop saved (never pre-existing sheets).
  async function promptForNewJobs(jobNames, sheetsForJob, onCancel) {
    const cancel = onCancel || hooks.onCancelJob;
    for (const jobName of jobNames) {
      const jobKey = hooks.noteKey(jobName);
      if (OwnerStore.hasJobDetails(jobKey)) continue;
      const ok = await open('new', jobName, sheetsForJob(jobName));
      if (!ok) await cancel(jobName);
    }
  }

  function openEdit(jobName, jobSheets) { return open('edit', jobName, jobSheets); }

  return { thicknessFromMaterialInfo, sheetSizeLabel, init, promptForNewJobs, openEdit };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = JobDetails;
