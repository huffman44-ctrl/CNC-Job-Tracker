/* ══════════════════════════════════════════
   Dark Mode
══════════════════════════════════════════ */
const moonSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const sunSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;

function updateDarkBtns() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const icon = isDark ? sunSvg : moonSvg;
  document.getElementById('dark-mode-btn').innerHTML     = icon;
  document.getElementById('upload-dark-btn').innerHTML   = icon;
  document.getElementById('projects-dark-btn').innerHTML = icon;
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cnc::darkMode', next);
  updateDarkBtns();
  if (!document.getElementById('projects-screen').hidden) renderProjects();
}

document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);
document.getElementById('upload-dark-btn').addEventListener('click', toggleDarkMode);
document.getElementById('projects-dark-btn').addEventListener('click', toggleDarkMode);
updateDarkBtns();

/* ══════════════════════════════════════════
   State
══════════════════════════════════════════ */
let sheets         = [];
let currentProject = null; // jobName string when inside a project, null on directory
let modalCtx       = null;
let clearCtx       = null;

/* ══════════════════════════════════════════
   DOM refs
══════════════════════════════════════════ */
const uploadScreen   = document.getElementById('upload-screen');
const projectsScreen = document.getElementById('projects-screen');
const contentScreen  = document.getElementById('content-screen');
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const addFileInput   = document.getElementById('add-file-input');
const fileListEl     = document.getElementById('file-list');
const uploadErrorEl  = document.getElementById('upload-error');

const headerJobName    = document.getElementById('header-job-name');
const headerSheetCount = document.getElementById('header-sheet-count');
const progressFill     = document.getElementById('progress-fill');
const progressLabel    = document.getElementById('progress-label');
const sheetsContainer  = document.getElementById('sheets-container');

const modalOverlay          = document.getElementById('modal-overlay');
const modalSubtitle         = document.getElementById('modal-subtitle');
const modalDatetime         = document.getElementById('modal-datetime');
const modalOperator         = document.getElementById('modal-operator');
const modalOperatorOther    = document.getElementById('modal-operator-other');
const modalOperatorOtherGrp = document.getElementById('modal-operator-other-group');
const modalNotes            = document.getElementById('modal-notes');

const clearOverlay  = document.getElementById('clear-overlay');
const clearSubtitle = document.getElementById('clear-subtitle');

/* ══════════════════════════════════════════
   Upload / File Handling
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

document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  if (!uploadScreen.hidden)    handleFiles(e.dataTransfer.files, true);
  else if (!contentScreen.hidden)  handleFiles(e.dataTransfer.files, false);
  else if (!projectsScreen.hidden) handleFiles(e.dataTransfer.files, true);
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
document.getElementById('back-to-projects-btn').addEventListener('click', () => {
  currentProject = null;
  showProjectsScreen();
});
document.getElementById('upload-new-btn').addEventListener('click', goToUpload);

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
clearOverlay.addEventListener('click', e => { if (e.target === clearOverlay) closeClearModal(); });

const notesOverlay = document.getElementById('notes-overlay');
notesOverlay.addEventListener('click', e => { if (e.target === notesOverlay) closeNotesModal(); });
document.getElementById('notes-modal-cancel').addEventListener('click', closeNotesModal);
document.getElementById('notes-modal-save').addEventListener('click', saveNote);

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

  let loadedCount    = 0;
  let firstNewJobName = null;
  for (const file of htmlFiles) {
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = parseJobSheet(e.target.result);
      const key    = simpleHash(file.name);
      if (!sheets.find(s => s.fileKey === key)) {
        const sheet = { fileKey: key, fileName: file.name, ...parsed };
        if (!firstNewJobName) firstNewJobName = projectKey(sheet);
        sheets.push(sheet);
        Storage.saveSheet(sheet);
      }
      loadedCount++;
      if (loadedCount === htmlFiles.length && sheets.length) {
        if (isFirstLoad) {
          showProjectsScreen();
        } else {
          renderAllSheets();
        }
      }
    };
    reader.readAsText(file);
  }
}

async function resetToUpload() {
  if (!confirm('Start a new job? This clears all loaded sheets and completion records for everyone.')) return;
  await Promise.all([Storage.clearSheets(), Storage.clearAllCompletions()]);
  sheets         = [];
  currentProject = null;
  sheetsContainer.innerHTML = '';
  fileListEl.innerHTML = '';
  fileListEl.hidden    = true;
  contentScreen.hidden  = true;
  projectsScreen.hidden = true;
  uploadScreen.hidden   = false;
}

function goToUpload() {
  fileListEl.innerHTML = '';
  fileListEl.hidden    = true;
  hideUploadError();
  contentScreen.hidden  = true;
  projectsScreen.hidden = true;
  uploadScreen.hidden   = false;
}

function showUploadError(msg) { uploadErrorEl.textContent = msg; uploadErrorEl.hidden = false; }
function hideUploadError()    { uploadErrorEl.hidden = true; }

/* ══════════════════════════════════════════
   Screen Navigation
══════════════════════════════════════════ */
function showProjectsScreen() {
  uploadScreen.hidden   = true;
  contentScreen.hidden  = true;
  projectsScreen.hidden = false;
  renderProjects();
}

function showContentScreen() {
  uploadScreen.hidden   = true;
  projectsScreen.hidden = true;
  contentScreen.hidden  = false;

  const displaySheets = getDisplaySheets();
  headerJobName.textContent    = displaySheets[0]?.jobName || currentProject || 'Job';
  headerSheetCount.textContent = `${displaySheets.length} sheet${displaySheets.length !== 1 ? 's' : ''}`;
  document.getElementById('back-to-projects-btn').hidden = false;

  renderAllSheets();
}

/* ══════════════════════════════════════════
   Projects Directory
══════════════════════════════════════════ */
function projectKey(sheet) {
  return sheet.jobName || sheet.fileName || 'Unknown Job';
}

function noteKey(jobName) {
  return 'proj_' + simpleHash(jobName);
}

function sheetNumber(fileName) {
  const m = fileName.match(/sheet\s*0*(\d+)/i);
  return m ? parseInt(m[1], 10) : Infinity;
}

function getDisplaySheets() {
  const result = currentProject
    ? sheets.filter(s => projectKey(s) === currentProject)
    : [...sheets];
  return result.sort((a, b) => sheetNumber(a.fileName) - sheetNumber(b.fileName));
}

function getProjectGroups() {
  const map = {};
  for (const sheet of sheets) {
    const key = projectKey(sheet);
    if (!map[key]) map[key] = [];
    map[key].push(sheet);
  }
  return map;
}

function renderProjects() {
  const container = document.getElementById('projects-container');
  container.innerHTML = '';

  const groups = getProjectGroups();
  const names  = Object.keys(groups);

  document.getElementById('projects-count').textContent =
    `${names.length} project${names.length !== 1 ? 's' : ''} · ${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`;

  if (!names.length) {
    container.innerHTML = '<div class="empty-state">No projects loaded.</div>';
    return;
  }

  for (const name of names) {
    container.appendChild(buildProjectCard(name, groups[name]));
  }
}

async function deleteProject(jobName) {
  const projectSheets = sheets.filter(s => projectKey(s) === jobName);
  await Promise.all(projectSheets.flatMap(s => [
    Storage.deleteSheet(s.fileKey),
    Storage.clear(s.fileKey, 'sheet'),
  ]));
  sheets = sheets.filter(s => projectKey(s) !== jobName);
  if (!sheets.length) {
    goToUpload();
  } else {
    renderProjects();
  }
}

function buildProjectCard(jobName, projectSheets) {
  const total    = projectSheets.length;
  const complete = projectSheets.filter(s => {
    const rec = Storage.get(s.fileKey, 'sheet');
    return rec && rec.status === 'complete';
  }).length;
  const inProg = projectSheets.filter(s => {
    const rec = Storage.get(s.fileKey, 'sheet');
    return rec && rec.status === 'in-progress';
  }).length;
  const incomplete = total - complete - inProg;
  const pct        = total ? Math.round((complete / total) * 100) : 0;

  const status = complete === total ? 'complete'
    : (complete > 0 || inProg > 0) ? 'in-progress'
    : 'incomplete';

  const card = document.createElement('div');
  card.className = `project-card project-card--${status}`;

  /* Header */
  const hdr = document.createElement('div');
  hdr.className = 'project-card-header';

  const hdrText = document.createElement('div');
  hdrText.innerHTML = `
    <div class="project-card-name">${escHtml(jobName)}</div>
    <div class="project-card-sheet-count">${total} sheet${total !== 1 ? 's' : ''}</div>`;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'project-delete-btn';
  deleteBtn.setAttribute('aria-label', 'Delete project');
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
  deleteBtn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(`Delete "${jobName}"? This removes all ${total} sheet${total !== 1 ? 's' : ''} and completion records for everyone.`)) return;
    await deleteProject(jobName);
  });

  hdr.appendChild(hdrText);
  hdr.appendChild(deleteBtn);

  /* Body */
  const body = document.createElement('div');
  body.className = 'project-card-body';

  /* Progress row */
  const barWrap = document.createElement('div');
  barWrap.className = 'project-progress-wrap';
  barWrap.innerHTML = `
    <div class="project-progress-track">
      <div class="project-progress-fill" style="width:${pct}%"></div>
    </div>
    <span class="project-progress-label">${complete} of ${total} complete</span>`;

  /* Stats + open button */
  const bottom = document.createElement('div');
  bottom.className = 'project-card-bottom';

  const stats = document.createElement('div');
  stats.className = 'project-stats';
  const statDefs = [
    { count: complete,   label: 'complete',    cls: 'project-stat--complete'   },
    { count: inProg,     label: 'in progress', cls: 'project-stat--progress'   },
    { count: incomplete, label: 'incomplete',  cls: 'project-stat--incomplete' },
  ];
  for (const { count, label, cls } of statDefs) {
    if (count === 0) continue;
    const chip = document.createElement('span');
    chip.className = `project-stat ${cls}`;
    chip.textContent = `${count} ${label}`;
    stats.appendChild(chip);
  }

  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'btn btn-muted btn-sm';
  noteBtn.textContent = Storage.getNote(noteKey(jobName)) ? 'Edit Note' : 'Add Note';
  noteBtn.addEventListener('click', e => {
    e.stopPropagation();
    openNotesModal(jobName);
  });

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn btn-primary btn-sm';
  openBtn.textContent = 'Open →';
  openBtn.addEventListener('click', e => {
    e.stopPropagation();
    currentProject = jobName;
    showContentScreen();
  });

  const btnGroup = document.createElement('div');
  btnGroup.className = 'project-card-btn-group';
  btnGroup.appendChild(noteBtn);
  btnGroup.appendChild(openBtn);

  body.appendChild(barWrap);

  const existingNote = Storage.getNote(noteKey(jobName));
  if (existingNote) {
    const notePreview = document.createElement('div');
    notePreview.className = 'project-note-preview';
    notePreview.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><span class="project-note-text">${escHtml(existingNote)}</span>`;
    body.appendChild(notePreview);
  }

  bottom.appendChild(stats);
  bottom.appendChild(btnGroup);
  body.appendChild(bottom);
  card.appendChild(hdr);
  card.appendChild(body);

  card.addEventListener('click', () => {
    currentProject = jobName;
    showContentScreen();
  });

  return card;
}

/* ══════════════════════════════════════════
   Render Sheets
══════════════════════════════════════════ */
function isCompleted(sheet) {
  const rec = Storage.get(sheet.fileKey, 'sheet');
  return !!rec && rec.status !== 'in-progress';
}

function renderAllSheets() {
  const displaySheets = getDisplaySheets();
  sheetsContainer.innerHTML = '';

  const active   = displaySheets.filter(s => !isCompleted(s));
  const complete = displaySheets.filter(s =>  isCompleted(s));

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

  updateOverallProgress(displaySheets);
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

  /* ── Footer ── */
  const footer = document.createElement('div');
  footer.className = 'sheet-complete-footer';

  const statusEl  = document.createElement('div');
  statusEl.className = 'sheet-status-area';

  const actionBtn = document.createElement('button');
  actionBtn.type  = 'button';

  const clearBtn  = document.createElement('button');
  clearBtn.type   = 'button';

  actionBtn.addEventListener('click', () => {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (!rec) {
      Storage.set(sheet.fileKey, 'sheet', { status: 'in-progress' });
      renderAllSheets();
    } else if (rec.status === 'in-progress') {
      openCompleteModal(sheet, actionBtn, statusEl);
    }
  });

  clearBtn.addEventListener('click', () => {
    openClearModal(sheet, actionBtn, statusEl);
  });

  footer.appendChild(statusEl);
  footer.appendChild(clearBtn);
  footer.appendChild(actionBtn);
  body.appendChild(footer);

  /* ── Toggle ── */
  header.addEventListener('click', () => {
    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    header.classList.toggle('open', !isOpen);
  });

  card.appendChild(header);
  card.appendChild(body);

  applySheetCompletion(sheet, card, actionBtn, clearBtn, statusEl);

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

function applySheetCompletion(sheet, card, actionBtn, clearBtn, statusEl) {
  const rec    = Storage.get(sheet.fileKey, 'sheet');
  const inProg = !!rec && rec.status === 'in-progress';
  const done   = !!rec && rec.status !== 'in-progress';

  card.classList.toggle('completed',   done);
  card.classList.toggle('in-progress', inProg);
  statusEl.innerHTML = '';

  if (done) {
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
    actionBtn.hidden      = true;
    clearBtn.textContent  = 'Clear Record';
    clearBtn.className    = 'btn btn-muted btn-sm';
    clearBtn.hidden       = false;
  } else if (inProg) {
    statusEl.innerHTML = `
      <span class="status-badge status-badge--progress">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        In Progress
      </span>`;
    actionBtn.hidden      = false;
    actionBtn.textContent = 'Mark Complete';
    actionBtn.className   = 'btn btn-primary btn-sm';
    clearBtn.textContent  = 'Clear';
    clearBtn.className    = 'btn btn-muted btn-sm';
    clearBtn.hidden       = false;
  } else {
    actionBtn.hidden      = false;
    actionBtn.textContent = 'Mark In Progress';
    actionBtn.className   = 'btn btn-amber btn-sm';
    clearBtn.hidden       = true;
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

let notesCtx = null;

function openNotesModal(jobName) {
  notesCtx = { jobName };
  document.getElementById('notes-modal-subtitle').textContent = jobName;
  document.getElementById('notes-modal-text').value = Storage.getNote(noteKey(jobName)) || '';
  notesOverlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('notes-modal-text').focus(), 50);
}

function closeNotesModal() {
  notesOverlay.classList.add('hidden');
  notesCtx = null;
}

async function saveNote() {
  if (!notesCtx) return;
  const text = document.getElementById('notes-modal-text').value;
  await Storage.setNote(noteKey(notesCtx.jobName), text);
  closeNotesModal();
  renderProjects();
}

function confirmComplete() {
  if (!modalCtx) return;
  const { sheet } = modalCtx;
  const dtValue   = modalDatetime.value;
  const operator  = modalOperator.value === '__other__'
    ? modalOperatorOther.value.trim()
    : modalOperator.value;
  Storage.set(sheet.fileKey, 'sheet', {
    status:      'complete',
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
function updateOverallProgress(displaySheets) {
  const total = displaySheets.length;
  const done  = displaySheets.filter(s => isCompleted(s)).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  progressFill.style.width = pct + '%';
  progressLabel.textContent = `${done} of ${total} sheet${total !== 1 ? 's' : ''} complete (${pct}%)`;
}

/* ══════════════════════════════════════════
   Export / Reset
══════════════════════════════════════════ */
function doExport() {
  const displaySheets = getDisplaySheets();
  if (!displaySheets.length) { alert('No sheets loaded to export.'); return; }
  const rows = [['Sheet', 'Job', 'Total Time', 'Completed At', 'Operator', 'Notes']];
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    rows.push([
      sheet.sheetTitle || sheet.fileName,
      sheet.jobName    || '',
      sheet.totalTime  || '',
      rec?.completedAt ? formatDT(new Date(rec.completedAt)) : '',
      rec?.operator || '',
      rec?.notes    || '',
    ]);
  }
  const escape = c => String(c).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
  const out  = rows.map(r => r.map(c => `"${escape(c)}"`).join(',')).join('\r\n');
  const blob = new Blob([out], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const baseName = (displaySheets[0]?.fileName || 'cnc-job')
    .replace(/\.html?$/i, '')
    .replace(/_summary.*/i, '');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

async function doResetAll() {
  if (!confirm('Reset ALL completion records for this job? This cannot be undone.')) return;
  const displaySheets = getDisplaySheets();
  await Promise.all(displaySheets.map(s => Storage.clear(s.fileKey, 'sheet')));
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

/* ══════════════════════════════════════════
   Firebase Init
══════════════════════════════════════════ */
async function initApp() {
  const loadingScreen = document.getElementById('loading-screen');
  try {
    const configured = typeof FIREBASE_CONFIG !== 'undefined'
      && FIREBASE_CONFIG.projectId
      && !FIREBASE_CONFIG.projectId.startsWith('PASTE');

    if (!configured) throw new Error('Firebase config not set');

    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();
    Storage.init(db);

    const [storedSheets] = await Promise.all([
      Storage.loadSheets(),
      Storage.loadCompletions(),
      Storage.loadNotes(),
    ]);

    if (storedSheets.length > 0) {
      sheets = storedSheets;
      showProjectsScreen();
    }

    Storage.onCompletionChange(() => {
      if (!projectsScreen.hidden) renderProjects();
      if (!contentScreen.hidden)  renderAllSheets();
    });

    Storage.onNoteChange(() => {
      if (!projectsScreen.hidden) renderProjects();
    });

  } catch (err) {
    console.warn('Running without Firebase:', err.message);
  }

  loadingScreen.classList.add('hidden');
}

initApp();
