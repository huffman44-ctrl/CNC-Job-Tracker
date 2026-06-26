/* ══════════════════════════════════════════
   Dark Mode
══════════════════════════════════════════ */
const moonSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const sunSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

function updateDarkBtns() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = isDark ? sunSvg : moonSvg;
  document.getElementById('dark-mode-btn').innerHTML   = icon;
  document.getElementById('upload-dark-btn').innerHTML = icon;
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cnc::darkMode', next);
  updateDarkBtns();
}

document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);
document.getElementById('upload-dark-btn').addEventListener('click', toggleDarkMode);
updateDarkBtns();

/* ══════════════════════════════════════════
   State
══════════════════════════════════════════ */
let sheets   = [];   // [{ fileKey, fileName, sheetTitle, jobName, totalTime, toolpaths, materialInfo }]
let modalCtx = null; // { sheet, completeBtn, statusEl }
let clearCtx = null;

/* ══════════════════════════════════════════
   DOM refs
══════════════════════════════════════════ */
const uploadScreen  = document.getElementById('upload-screen');
const contentScreen = document.getElementById('content-screen');
const dropZone      = document.getElementById('drop-zone');
const fileInput     = document.getElementById('file-input');
const addFileInput  = document.getElementById('add-file-input');
const fileListEl    = document.getElementById('file-list');
const uploadErrorEl = document.getElementById('upload-error');

const headerJobName    = document.getElementById('header-job-name');
const headerSheetCount = document.getElementById('header-sheet-count');
const progressFill     = document.getElementById('progress-fill');
const progressLabel    = document.getElementById('progress-label');
const sheetsContainer  = document.getElementById('sheets-container');

const modalOverlay         = document.getElementById('modal-overlay');
const modalSubtitle        = document.getElementById('modal-subtitle');
const modalDatetime        = document.getElementById('modal-datetime');
const modalOperator        = document.getElementById('modal-operator');
const modalOperatorOther   = document.getElementById('modal-operator-other');
const modalOperatorOtherGrp= document.getElementById('modal-operator-other-group');
const modalNotes           = document.getElementById('modal-notes');

const clearOverlay  = document.getElementById('clear-overlay');
const clearSubtitle = document.getElementById('clear-subtitle');

/* ══════════════════════════════════════════
   Upload / file handling
══════════════════════════════════════════ */
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files, true);
});

/* Prevent browser from opening files if drag misses the drop zone */
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  if (!uploadScreen.hidden)  handleFiles(e.dataTransfer.files, true);
  else if (!contentScreen.hidden) handleFiles(e.dataTransfer.files, false);
});

fileInput.addEventListener('change', e => { handleFiles(e.target.files, true);  fileInput.value = ''; });
addFileInput.addEventListener('change', e => { handleFiles(e.target.files, false); addFileInput.value = ''; });

document.getElementById('new-job-btn').addEventListener('click', resetToUpload);
document.getElementById('export-btn').addEventListener('click', doExport);
document.getElementById('reset-btn').addEventListener('click', doResetAll);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', confirmComplete);
document.getElementById('clear-cancel').addEventListener('click', closeClearModal);
document.getElementById('clear-confirm').addEventListener('click', confirmClear);

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
clearOverlay.addEventListener('click', e => { if (e.target === clearOverlay) closeClearModal(); });

modalOperator.addEventListener('change', () => {
  const isOther = modalOperator.value === '__other__';
  modalOperatorOtherGrp.hidden = !isOther;
  if (isOther) setTimeout(() => modalOperatorOther.focus(), 50);
});

function handleFiles(fileList, isFirstLoad) {
  const htmlFiles = Array.from(fileList).filter(f => f.name.match(/\.(html?|htm)$/i));
  if (!htmlFiles.length) {
    showUploadError('Please select HTML files (.html or .htm).');
    return;
  }

  hideUploadError();

  if (isFirstLoad) {
    fileListEl.innerHTML = '';
    fileListEl.hidden = false;
    for (const f of htmlFiles) {
      const item = document.createElement('div');
      item.className = 'file-list-item';
      item.innerHTML = `
        <svg class="file-list-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        ${escHtml(f.name)}`;
      fileListEl.appendChild(item);
    }
  }

  let loadedCount = 0;
  for (const file of htmlFiles) {
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseJobSheet(e.target.result);
      const key = simpleHash(file.name);
      if (!sheets.find(s => s.fileKey === key)) {
        sheets.push({ fileKey: key, fileName: file.name, ...parsed });
      }
      loadedCount++;
      if (loadedCount === htmlFiles.length && sheets.length) showContentScreen();
    };
    reader.readAsText(file);
  }
}

function resetToUpload() {
  sheets = [];
  sheetsContainer.innerHTML = '';
  fileListEl.innerHTML = '';
  fileListEl.hidden = true;
  contentScreen.hidden = true;
  uploadScreen.hidden  = false;
}

function showContentScreen() {
  uploadScreen.hidden  = true;
  contentScreen.hidden = false;

  const jobName = sheets[0]?.jobName || 'Job';
  headerJobName.textContent    = jobName;
  headerSheetCount.textContent = `${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`;

  renderAllSheets();
  showResumeBannerIfNeeded();
}

function showResumeBannerIfNeeded() {
  document.getElementById('resume-banner')?.remove();
  const sheetsWithRecords = sheets.filter(s => Storage.get(s.fileKey, 'sheet'));
  if (!sheetsWithRecords.length) return;

  const banner = document.createElement('div');
  banner.id = 'resume-banner';
  banner.className = 'resume-banner';
  const n = sheetsWithRecords.length;
  banner.innerHTML = `
    <span>${n} sheet${n !== 1 ? 's have' : ' has'} existing completion records from a previous session.</span>
    <button class="btn btn-sm btn-danger"  id="resume-fresh-btn">Start Fresh</button>
    <button class="btn btn-sm btn-outline" id="resume-keep-btn">Keep Records</button>`;

  document.querySelector('.content-main').prepend(banner);

  document.getElementById('resume-fresh-btn').addEventListener('click', () => {
    for (const s of sheetsWithRecords) Storage.clearAll(s.fileKey);
    banner.remove();
    renderAllSheets();
  });
  document.getElementById('resume-keep-btn').addEventListener('click', () => banner.remove());
}

function showUploadError(msg) { uploadErrorEl.textContent = msg; uploadErrorEl.hidden = false; }
function hideUploadError()    { uploadErrorEl.hidden = true; }

/* ══════════════════════════════════════════
   Render
══════════════════════════════════════════ */
function renderAllSheets() {
  sheetsContainer.innerHTML = '';

  const active   = sheets.filter(s => !Storage.get(s.fileKey, 'sheet'));
  const complete = sheets.filter(s =>  Storage.get(s.fileKey, 'sheet'));

  active.forEach((sheet, idx) => sheetsContainer.appendChild(buildSheetCard(sheet, idx)));

  if (complete.length) {
    const section = document.createElement('div');
    section.className = 'complete-section';

    const hdr = document.createElement('div');
    hdr.className = 'complete-section-header';
    hdr.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      Complete (${complete.length})`;
    section.appendChild(hdr);

    complete.forEach((sheet, idx) => section.appendChild(buildSheetCard(sheet, active.length + idx)));
    sheetsContainer.appendChild(section);
  }

  updateOverallProgress();
}

function buildSheetCard(sheet, idx) {
  const card = document.createElement('div');
  card.className = 'sheet-card';
  card.dataset.sheetKey = sheet.fileKey;

  /* ── Header ── */
  const header = document.createElement('div');
  header.className = 'sheet-header';

  const numEl = document.createElement('div');
  numEl.className = 'sheet-num';
  numEl.textContent = idx + 1;

  const textWrap = document.createElement('div');
  textWrap.className = 'sheet-header-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'sheet-title';
  titleEl.textContent = sheet.sheetTitle || sheet.fileName;

  const metaEl = document.createElement('div');
  metaEl.className = 'sheet-meta';
  if (sheet.totalTime) {
    metaEl.innerHTML = `
      <span class="sheet-time-chip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        ${escHtml(sheet.totalTime)} total
      </span>`;
  }

  const fileNameEl = document.createElement('div');
  fileNameEl.className = 'sheet-filename';
  fileNameEl.textContent = sheet.fileName.replace(/\.html?$/i, '');

  textWrap.appendChild(titleEl);
  textWrap.appendChild(fileNameEl);
  textWrap.appendChild(metaEl);

  const rightEl = document.createElement('div');
  rightEl.className = 'sheet-right';

  const badge = document.createElement('span');
  badge.className = 'sheet-badge';
  badge.dataset.badgeFor = sheet.fileKey;

  const toggleEl = document.createElement('span');
  toggleEl.className = 'sheet-toggle';
  toggleEl.textContent = '▶';

  rightEl.appendChild(badge);
  rightEl.appendChild(toggleEl);

  header.appendChild(numEl);
  header.appendChild(textWrap);
  header.appendChild(rightEl);

  /* ── Body ── */
  const body = document.createElement('div');
  body.className = 'sheet-body';

  // Material info strip
  if (sheet.materialInfo?.length) {
    const strip = document.createElement('div');
    strip.className = 'material-strip';
    for (const { label, value } of sheet.materialInfo) {
      const chip = document.createElement('div');
      chip.className = 'material-chip';
      chip.innerHTML = `
        <span class="material-chip-label">${escHtml(label)}</span>
        <span class="material-chip-value">${escHtml(value || '—')}</span>`;
      strip.appendChild(chip);
    }
    body.appendChild(strip);
  }

  // Material Border SVG
  if (sheet.layoutSvg) {
    try {
      const svgWrap = document.createElement('div');
      svgWrap.className = 'layout-svg-wrap';
      const label = document.createElement('div');
      label.className = 'layout-svg-label';
      label.textContent = 'Material Border';
      svgWrap.appendChild(label);
      const scrollEl = document.createElement('div');
      scrollEl.className = 'layout-svg-scroll';
      scrollEl.innerHTML = sheet.layoutSvg;
      svgWrap.appendChild(scrollEl);
      body.appendChild(svgWrap);
    } catch (err) {
      console.error('SVG render failed:', err);
    }
  }

  // Toolpath rows (read-only)
  if (sheet.toolpaths?.length) {
    const list = document.createElement('div');
    list.className = 'toolpaths-list';
    sheet.toolpaths.forEach(item => list.appendChild(buildItemRow(item)));
    body.appendChild(list);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No toolpaths found in this sheet.';
    body.appendChild(empty);
  }

  // Sheet-level completion footer
  const footer = document.createElement('div');
  footer.className = 'sheet-complete-footer';

  const statusEl = document.createElement('div');
  statusEl.className = 'sheet-status-area';

  const completeBtn = document.createElement('button');
  completeBtn.type = 'button';

  completeBtn.addEventListener('click', () => {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (rec) openClearModal(sheet, completeBtn, statusEl);
    else     openCompleteModal(sheet, completeBtn, statusEl);
  });

  footer.appendChild(statusEl);
  footer.appendChild(completeBtn);
  body.appendChild(footer);

  /* ── Toggle ── */
  header.addEventListener('click', () => {
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    header.classList.toggle('open', !isOpen);
  });

  card.appendChild(header);
  card.appendChild(body);

  applySheetCompletion(sheet, card, completeBtn, statusEl);

  return card;
}

function buildItemRow(item) {
  const row = document.createElement('div');
  row.className = 'item-row';

  const infoEl = document.createElement('div');
  infoEl.className = 'item-info';

  const nameEl = document.createElement('div');
  nameEl.className = 'item-name';
  nameEl.textContent = item.name;

  const chipsEl = document.createElement('div');
  chipsEl.className = 'item-chips';

  if (item.tool) {
    const toolChip = document.createElement('span');
    toolChip.className = 'chip chip-tool';
    toolChip.textContent = item.tool;
    chipsEl.appendChild(toolChip);
  }

  if (item.timeEstimate) {
    const timeChip = document.createElement('span');
    timeChip.className = 'chip chip-time';
    timeChip.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      ${escHtml(item.timeEstimate)}`;
    chipsEl.appendChild(timeChip);
  }

  infoEl.appendChild(nameEl);
  infoEl.appendChild(chipsEl);

  const detailFields = [
    { key: 'feedRate',     label: 'Feed Rate' },
    { key: 'plungeRate',   label: 'Plunge Rate' },
    { key: 'spindleSpeed', label: 'Spindle' },
    { key: 'toolType',     label: 'Tool Type' },
    { key: 'maxCutDepth',  label: 'Max Cut' },
    { key: 'passDepth',    label: 'Pass Depth' },
    { key: 'stepover',     label: 'Stepover' },
  ];
  const hasDetails = detailFields.some(f => item[f.key]);
  if (hasDetails) {
    const grid = document.createElement('div');
    grid.className = 'item-detail-grid';
    for (const { key, label } of detailFields) {
      if (!item[key]) continue;
      const entry = document.createElement('div');
      entry.className = 'item-detail-entry';
      entry.innerHTML = `<span class="item-detail-label">${escHtml(label)}</span><span class="item-detail-value">${escHtml(item[key])}</span>`;
      grid.appendChild(entry);
    }
    infoEl.appendChild(grid);
  }

  row.appendChild(infoEl);
  return row;
}

function applySheetCompletion(sheet, card, completeBtn, statusEl) {
  const rec = Storage.get(sheet.fileKey, 'sheet');
  card.classList.toggle('completed', !!rec);
  statusEl.innerHTML = '';

  if (rec) {
    const dt = new Date(rec.completedAt);
    statusEl.innerHTML = `
      <span class="status-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Complete
      </span>
      <span class="status-date">${formatDT(dt)}</span>
      ${rec.operator ? `<span class="status-op">· ${escHtml(rec.operator)}</span>` : ''}`;
    completeBtn.textContent = 'Clear Record';
    completeBtn.className = 'btn btn-muted btn-sm';
  } else {
    completeBtn.textContent = 'Mark Complete';
    completeBtn.className = 'btn btn-primary btn-sm';
  }
}

/* ══════════════════════════════════════════
   Modals
══════════════════════════════════════════ */
function openCompleteModal(sheet, completeBtn, statusEl) {
  modalCtx = { sheet, completeBtn, statusEl };
  modalSubtitle.textContent = sheet.sheetTitle || sheet.fileName;
  modalDatetime.value = localIso(new Date());
  modalOperator.value = 'Collin';
  modalOperatorOtherGrp.hidden = true;
  modalOperatorOther.value = '';
  modalNotes.value = '';
  modalOverlay.classList.remove('hidden');
  setTimeout(() => modalDatetime.focus(), 50);
}

function openClearModal(sheet, completeBtn, statusEl) {
  clearCtx = { sheet, completeBtn, statusEl };
  clearSubtitle.textContent = sheet.sheetTitle || sheet.fileName;
  clearOverlay.classList.remove('hidden');
}

function closeModal()      { modalOverlay.classList.add('hidden'); modalCtx = null; }
function closeClearModal() { clearOverlay.classList.add('hidden'); clearCtx = null; }

function confirmComplete() {
  if (!modalCtx) return;
  const { sheet } = modalCtx;
  const dtValue  = modalDatetime.value;
  const operator = modalOperator.value === '__other__'
    ? modalOperatorOther.value.trim()
    : modalOperator.value;
  Storage.set(sheet.fileKey, 'sheet', {
    completedAt: dtValue ? new Date(dtValue).toISOString() : new Date().toISOString(),
    operator,
    notes: modalNotes.value.trim(),
  });
  closeModal();
  renderAllSheets();
}

function confirmClear() {
  if (!clearCtx) return;
  const { sheet } = clearCtx;
  Storage.clear(sheet.fileKey, 'sheet');
  closeClearModal();
  renderAllSheets();
}

/* ══════════════════════════════════════════
   Progress
══════════════════════════════════════════ */
function updateSheetBadge(sheet) {
  const badge = document.querySelector(`[data-badge-for="${sheet.fileKey}"]`);
  if (!badge) return;
  const rec = Storage.get(sheet.fileKey, 'sheet');
  if (rec) {
    badge.textContent = '✓ Complete';
    badge.classList.add('done');
  } else {
    badge.textContent = '';
    badge.classList.remove('done');
  }
}

function updateOverallProgress() {
  const total = sheets.length;
  const done  = sheets.filter(s => Storage.get(s.fileKey, 'sheet')).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressLabel.textContent = `${done} of ${total} sheet${total !== 1 ? 's' : ''} complete (${pct}%)`;
}

/* ══════════════════════════════════════════
   Export / Reset
══════════════════════════════════════════ */
function doExport() {
  const rows = [['Sheet', 'Job', 'Total Time', 'Completed At', 'Operator', 'Notes']];
  for (const sheet of sheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    rows.push([
      sheet.sheetTitle || sheet.fileName,
      sheet.jobName || '',
      sheet.totalTime || '',
      rec ? formatDT(new Date(rec.completedAt)) : '',
      rec?.operator || '',
      rec?.notes || '',
    ]);
  }
  const out  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob = new Blob([out], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `cnc-job-${Date.now()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

function doResetAll() {
  if (!confirm('Reset ALL completion records for this entire job? This cannot be undone.')) return;
  for (const sheet of sheets) Storage.clearAll(sheet.fileKey);
  renderAllSheets();
}

/* ══════════════════════════════════════════
   Helpers
══════════════════════════════════════════ */
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDT(date) {
  return date.toLocaleString(undefined, {
    month:'short', day:'numeric', year:'numeric',
    hour:'numeric', minute:'2-digit',
  });
}

function localIso(date) {
  const p = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
