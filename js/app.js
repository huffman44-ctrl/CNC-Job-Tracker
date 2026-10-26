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
let finishedSheets  = [];     // owners' "Show finished jobs" view (one-shot load, not a listener)
let showFinished    = false;  // the Projects checkbox
let viewingFinished = false;  // the open job came from the finished list
let cardReturn      = null;   // 'billing' while the open job card was reached from Billing (Back returns there)
function visibleSheets() { return (showFinished || viewingFinished) ? finishedSheets : sheets; }
let modalCtx       = null;
let clearCtx       = null;
let selectedSheetKey = null;
// fileKey of the sheet whose detail panel is currently painted into
// sheetDetailEl (as of the last renderAllSheets() call). Used to tell a
// same-sheet redraw (e.g. triggered by this tab's own annotation write)
// apart from a switch to a different sheet or a deletion of the selected
// one — only the former should preserve the layout diagram's scroll
// position; the other two should render fresh at the top like they always
// have.
let lastRenderedSheetKey = null;
// fileKey -> decompressed SVG string. Decompressing a large drawing costs
// ~100ms, and re-selecting a sheet is common, so keep the result.
const svgCache = new Map();

/* ══════════════════════════════════════════
   DOM refs
══════════════════════════════════════════ */
const loadingScreen       = document.getElementById('loading-screen');
const loginScreen         = document.getElementById('login-screen');
const uploadScreen        = document.getElementById('upload-screen');
const projectsScreen      = document.getElementById('projects-screen');
const contentScreen       = document.getElementById('content-screen');
const ticketHistoryScreen = document.getElementById('ticket-history-screen');
const customersScreen     = document.getElementById('customers-screen');
const settingsScreen      = document.getElementById('settings-screen');

const loginForm     = document.getElementById('login-form');
const loginEmail    = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError    = document.getElementById('login-error');
const loginSubmit   = document.getElementById('login-submit');

const authBar         = document.getElementById('auth-bar');
const authBarEmail    = document.getElementById('auth-bar-email');
const authBarSignout  = document.getElementById('auth-bar-signout');
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const addFileInput   = document.getElementById('add-file-input');
const fileListEl     = document.getElementById('file-list');
const uploadErrorEl  = document.getElementById('upload-error');

const headerJobName    = document.getElementById('header-job-name');
const headerSheetCount = document.getElementById('header-sheet-count');
const progressFill     = document.getElementById('progress-fill');
const progressLabel    = document.getElementById('progress-label');
const sheetNavEl       = document.getElementById('sheet-nav');
const sheetDetailEl    = document.getElementById('sheet-detail');

const modalOverlay          = document.getElementById('modal-overlay');
const modalSubtitle         = document.getElementById('modal-subtitle');
const modalDatetime         = document.getElementById('modal-datetime');
const modalOperator         = document.getElementById('modal-operator');
const modalOperatorOther    = document.getElementById('modal-operator-other');
const modalOperatorOtherGrp = document.getElementById('modal-operator-other-group');
const modalNotes            = document.getElementById('modal-notes');

const sheetNoteOverlay      = document.getElementById('sheet-note-overlay');
const sheetNoteSubtitle     = document.getElementById('sheet-note-modal-subtitle');
const sheetNoteText         = document.getElementById('sheet-note-modal-text');

const customerPickerOverlay  = document.getElementById('customer-picker-overlay');
const customerPickerSubtitle = document.getElementById('customer-picker-subtitle');
const customerPickerSelect   = document.getElementById('customer-picker-select');
const customerPickerOther    = document.getElementById('customer-picker-other');
const customerPickerOtherGrp = document.getElementById('customer-picker-other-group');
const customerPickerConfirm  = document.getElementById('customer-picker-confirm');

const clearOverlay  = document.getElementById('clear-overlay');
const clearSubtitle = document.getElementById('clear-subtitle');

const noticeOverlay = document.getElementById('notice-overlay');
const noticeTextEl  = document.getElementById('notice-modal-text');

/* ══════════════════════════════════════════
   Upload / File Handling
══════════════════════════════════════════ */
dropZone.addEventListener('click', e => {
  // The "Browse Files" label opens the picker natively. Without this guard the
  // same click also bubbles up here and calls fileInput.click() a second time;
  // Chrome blocks that second open ("File chooser dialog can only be shown with
  // a user activation") and the dialog never appears. Skip when the click came
  // from the label or the input itself so only a single open happens.
  if (e.target.closest('label[for="file-input"], #file-input')) return;
  fileInput.click();
});
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

document.getElementById('print-ticket-btn').addEventListener('click', () => printJobTicket(currentProject, getDisplaySheets()));
document.getElementById('export-btn').addEventListener('click', doExport);
document.getElementById('reset-btn').addEventListener('click', doResetAll);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-confirm').addEventListener('click', confirmComplete);
document.getElementById('clear-cancel').addEventListener('click', closeClearModal);
document.getElementById('clear-confirm').addEventListener('click', confirmClear);
document.getElementById('back-to-projects-btn').addEventListener('click', () => {
  viewingFinished = false;
  currentProject = null;
  vanlabForgetJob();   // the next open of any job (from the board or Billing) gets a fresh bar and lookup
  if (cardReturn === 'billing') { cardReturn = null; setCardBackLabel(); BillingScreen.show({ resume: true }); return; }
  showProjectsScreen();
});
document.getElementById('upload-new-btn').addEventListener('click', goToUpload);
document.getElementById('ticket-history-btn').addEventListener('click', showTicketHistoryScreen);
document.getElementById('ticket-history-back-btn').addEventListener('click', showProjectsScreen);
document.getElementById('ticket-history-search').addEventListener('input', renderTicketHistoryList);
document.getElementById('manage-customers-btn').addEventListener('click', showManageCustomersScreen);
document.getElementById('customers-back-btn').addEventListener('click', showProjectsScreen);

const projectSearchEl = document.getElementById('project-search');
const projectSortEl   = document.getElementById('project-sort');
projectSearchEl.addEventListener('input', renderProjects);
projectSortEl.addEventListener('change', renderProjects);

modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
clearOverlay.addEventListener('click', e => { if (e.target === clearOverlay) closeClearModal(); });

document.getElementById('notice-ok').addEventListener('click', closeNotice);
noticeOverlay.addEventListener('click', e => { if (e.target === noticeOverlay) closeNotice(); });

const notesOverlay = document.getElementById('notes-overlay');
notesOverlay.addEventListener('click', e => { if (e.target === notesOverlay) closeNotesModal(); });
document.getElementById('notes-modal-cancel').addEventListener('click', closeNotesModal);
document.getElementById('notes-modal-save').addEventListener('click', saveNote);

sheetNoteOverlay.addEventListener('click', e => { if (e.target === sheetNoteOverlay) closeSheetNoteModal(); });
document.getElementById('sheet-note-modal-cancel').addEventListener('click', closeSheetNoteModal);
document.getElementById('sheet-note-modal-save').addEventListener('click', saveSheetNote);

modalOperator.addEventListener('change', () => {
  const isOther = modalOperator.value === '__other__';
  modalOperatorOtherGrp.hidden = !isOther;
  if (isOther) setTimeout(() => modalOperatorOther.focus(), 50);
});

// FileReader as a promise: a read error rejects, so one unreadable file can't stall the drop.
function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsText(file);
  });
}

async function handleFiles(fileList, isFirstLoad) {
  const htmlFiles = Array.from(fileList).filter(f => f.name.match(/\.(html?|htm)$/i));
  if (!htmlFiles.length) {
    showUploadError('Please select HTML files (.html or .htm).');
    return;
  }

  hideUploadError();
  hideSaveBanner();

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

  // What happens to each file (the re-upload guard included) is decided in UploadBatch
  // (spec .scratch/upload-guard); this function does the screen work around it.
  const result = await UploadBatch.run(htmlFiles.map(f => ({ name: f.name, read: () => readText(f) })), {
    parse: parseJobSheet,
    onBoard: k => sheets.some(s => s.fileKey === k),
    addToBoard: s => { sheets.push(s); },
    removeFromBoard: k => { sheets = sheets.filter(s => s.fileKey !== k); },
    getSheetDoc: k => Storage.getSheetDoc(k),
    saveSheet: s => { uploadedHere.add(s.fileKey); return Storage.saveSheet(s); },
    archive: (name, jobName, text) => Endpoint.archiveSheet(name, jobName, text),
    setArchiveUrl: (k, url) => Storage.setArchiveUrl(k, url),
  });
  // One banner line, last message wins: oversize first so a save failure is never hidden behind it.
  for (const s of result.saved) {
    if (s.mode === 'oversize') showSaveBanner(`"${s.sheet.fileName}" was saved, but its layout drawing is too large to store. Everything else tracks normally — use the archive link to view the drawing.`);
  }
  // The sheets listener drops a sheet that failed to save on its next snapshot — say why.
  for (const f of result.saveFailed) showSaveBanner(`Couldn't save "${f.name}" — ${f.message}. The file was still archived to Drive.`);
  try { await finishUploadBatch(isFirstLoad, result); }
  catch (err) { console.warn('finishUploadBatch failed:', err); }
}

async function finishUploadBatch(isFirstLoad, result) {
  if (sheets.length) {
    if (isFirstLoad) showProjectsScreen(); else renderAllSheets();
  }
  const notice = UploadBatch.notice(result, formatDT);
  if (notice) showNotice(notice);
  const savedByJob = result.savedByJob;

  // Every new job gets its jobs/ doc (createdAt/createdBy only if missing) whatever the owner
  // switches say — operator-writable, spec §5.3.
  const jobNames = [...savedByJob.keys()];
  for (const jobName of jobNames) await Storage.upsertJobForUpload(Keys.job(jobName), jobName, currentUserEmail());

  // Owners with the switch on: job details for every NEW job in this drop, one form at a time.
  // Jobs that already have details (adding more sheets) get no step (spec §7.1).
  // Skipped when jobBilling was not read successfully: the step would otherwise re-appear for a job
  // that already has details and confirming would overwrite its labor lines / ready state.
  if (jobNames.length && Features.on('jobDetails') && OwnerStore.loaded('jobBilling')) {
    await JobDetails.promptForNewJobs(
      jobNames,
      jobName => sheets.filter(s => Keys.jobOf(s) === jobName).sort(compareSheets),
      jobName => cancelDroppedJob(jobName, savedByJob.get(jobName) || []));
    if (!projectsScreen.hidden) renderProjects();
  }
}

// Job-details Cancel: remove ONLY the sheets this drop saved for the job, whole record each (they
// are unfinished and unbilled, so the rules allow it). Pre-existing sheets of the job are never touched.
async function cancelDroppedJob(jobName, fileKeys) {
  await deleteSheetsAndReport(fileKeys);
  if (!sheets.length) showProjectsScreen();
  else if (!projectsScreen.hidden) renderProjects();
  else if (!contentScreen.hidden) renderAllSheets();
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

const saveBannerEl     = document.getElementById('save-banner');
const saveBannerTextEl = document.getElementById('save-banner-text');
document.getElementById('save-banner-close').addEventListener('click', hideSaveBanner);

function showSaveBanner(msg) { saveBannerTextEl.textContent = msg; saveBannerEl.hidden = false; }
function hideSaveBanner()    { saveBannerEl.hidden = true; }

/* ══════════════════════════════════════════
   New-job alert — a job (or sheets) uploaded on ANOTHER computer: banner on every screen until
   Open it / ×, flashing tab title, a chime, NEW tag on the project card until the job is opened.
   What counts as an arrival lives in NewJobAlert (js/new-job-alert.js).
══════════════════════════════════════════ */
const uploadedHere = new Set();   // fileKeys this tab saved — never alert for our own uploads
// 10 minutes of slack for clocks that disagree; older sheets coming back (Put back) never alert.
const newJobs = NewJobAlert.create({ sinceMs: Date.now() - 10 * 60 * 1000 });
const newJobBannerEl   = document.getElementById('new-job-banner');
const newJobBannerList = document.getElementById('new-job-banner-list');
const pageTitle = document.title;
let titleFlashTimer = null;
let lastChimeAt = 0;

document.getElementById('new-job-banner-close').addEventListener('click', () => {
  newJobs.dismiss();
  renderNewJobBanner();
});

function renderNewJobBanner() {
  const alerts = newJobs.alerts();
  newJobBannerList.innerHTML = '';
  for (const a of alerts) {
    const row = document.createElement('div');
    row.className = 'new-job-banner-row';
    const text = document.createElement('span');
    text.textContent = NewJobAlert.message(a);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'new-job-banner-open';
    open.textContent = 'Open it';
    open.addEventListener('click', () => openNewJob(a.jobName));
    row.append(text, open);
    newJobBannerList.appendChild(row);
  }
  newJobBannerEl.hidden = !alerts.length;
  if (alerts.length && !titleFlashTimer) {
    titleFlashTimer = setInterval(() => {
      document.title = document.title === pageTitle ? '● New job' : pageTitle;
    }, 1000);
  } else if (!alerts.length && titleFlashTimer) {
    clearInterval(titleFlashTimer);
    titleFlashTimer = null;
    document.title = pageTitle;
  }
}

function openNewJob(jobName) {
  newJobs.opened(jobName);
  renderNewJobBanner();
  if (!sheets.some(s => Keys.jobOf(s) === jobName)) return;
  hideAllScreens();
  cardReturn = null; setCardBackLabel();
  resetFinishedView();
  currentProject = jobName;
  vanlabForgetJob();
  showContentScreen();
}

// Two short rising beeps. A browser that hasn't been clicked yet blocks sound — then it stays quiet
// (the banner and the tab still show). At most one chime per 10 s: a big drop saves sheet by sheet.
let chimeCtx = null;
function playNewJobChime() {
  if (Date.now() - lastChimeAt < 10000) return;
  lastChimeAt = Date.now();
  try {
    chimeCtx = chimeCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (chimeCtx.state === 'suspended') chimeCtx.resume().catch(() => {});
    [[880, 0], [1320, 0.18]].forEach(([freq, delay]) => {
      const osc = chimeCtx.createOscillator();
      const gain = chimeCtx.createGain();
      const t = chimeCtx.currentTime + delay;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(chimeCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch (e) { console.warn('New-job chime failed:', e); }
}

/* ══════════════════════════════════════════
   Screen Navigation
══════════════════════════════════════════ */
// Billing, the invoice screen and the done screen (owners only; each lives in its own file).
function billingScreens() {
  return ['billing-screen', 'invoice-screen', 'billing-done-screen'].map(id => document.getElementById(id)).filter(Boolean);
}
function hideAllScreens() {
  uploadScreen.hidden        = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = true;
  settingsScreen.hidden      = true;
  projectsScreen.hidden      = true;
  billingScreens().forEach(el => { el.hidden = true; });
  jobStickersPanel.hidden    = true;   // leaving the job screen (Projects, Billing, Settings) closes it
}

// The finished view never survives a trip back to the Projects screen (P6): whatever sent us
// here (Back, put back, the sheets listener, another screen), the board starts on active jobs.
function resetFinishedView() {
  showFinished = false;
  viewingFinished = false;
  const box = document.getElementById('projects-show-finished');
  if (box) box.checked = false;
}

// The job card's Back button says where it goes (Projects, or Billing when the card was opened there).
function setCardBackLabel() {
  document.getElementById('back-to-projects-btn').textContent = cardReturn === 'billing' ? '← Billing' : '← Projects';
}

function showProjectsScreen() {
  cardReturn = null; setCardBackLabel();
  resetFinishedView();
  vanlabForgetJob();   // every way off the job screen (export, put back, sign-out…) drops its job listener
  hideAllScreens();
  projectsScreen.hidden      = false;
  renderProjects();
  renderPrintQueue();
}

function showLoginScreen() {
  loadingScreen.classList.add('hidden');
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = true;
  settingsScreen.hidden      = true;
  billingScreens().forEach(el => { el.hidden = true; });
  authBar.hidden              = true;
  loginError.hidden           = true;
  loginForm.reset();
  loginScreen.hidden          = false;
  loginEmail.focus();
}

function showContentScreen() {
  uploadScreen.hidden   = true;
  projectsScreen.hidden = true;
  contentScreen.hidden  = false;

  const displaySheets = getDisplaySheets();
  headerJobName.textContent    = displaySheets[0]?.jobName || currentProject || 'Job';
  headerSheetCount.textContent = `${displaySheets.length} sheet${displaySheets.length !== 1 ? 's' : ''}`;
  document.getElementById('back-to-projects-btn').hidden = false;

  // The Stickers panel belongs to the job it was opened on; a rerender of the same job keeps it open.
  if (jsPanelJob !== currentProject) jobStickersPanel.hidden = true;
  renderJobStickers();
  vanlabSyncJob(displaySheets);

  updateJobNoteBanner();
  contentScreen.classList.toggle('content-screen--finished', viewingFinished);
  renderAllSheets();
}

// Owner panel on the job card; redrawn from renderAllSheets so completion changes keep it fresh.
function drawOwnerPanel(displaySheets) {
  const ownerPanelEl = document.getElementById('owner-panel');
  if (Features.on('jobCard') && currentProject) {
    ownerPanelEl.hidden = false;
    JobCard.renderOwnerPanel(ownerPanelEl, currentProject, displaySheets);
  } else {
    ownerPanelEl.hidden = true;
    ownerPanelEl.innerHTML = '';
  }
}

function updateJobNoteBanner() {
  const banner = document.getElementById('job-note-banner');
  const note   = currentProject ? Storage.getNote(Keys.job(currentProject)) : null;
  banner.hidden = !note;
  if (note) document.getElementById('job-note-banner-text').textContent = note;
}

/* ══════════════════════════════════════════
   Ticket History
══════════════════════════════════════════ */
let ticketHistoryRecords    = [];
let ticketHistoryLoadFailed = false;

async function showTicketHistoryScreen() {
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = false;
  settingsScreen.hidden      = true;
  document.getElementById('ticket-history-search').value = '';
  const loaded = await Storage.loadTicketHistory();
  ticketHistoryLoadFailed = loaded === null;
  ticketHistoryRecords    = loaded || [];
  renderTicketHistoryList();
}

function renderTicketHistoryList() {
  const container = document.getElementById('ticket-history-list');

  if (ticketHistoryLoadFailed) {
    document.getElementById('ticket-history-count').textContent = '';
    container.innerHTML = '<p class="ticket-history-empty">Couldn’t load ticket history.</p>';
    return;
  }

  const query = document.getElementById('ticket-history-search').value.trim().toLowerCase();
  const filtered = query
    ? ticketHistoryRecords.filter(r => (r.jobName || '').toLowerCase().includes(query))
    : ticketHistoryRecords;

  document.getElementById('ticket-history-count').textContent =
    `${filtered.length} ticket${filtered.length !== 1 ? 's' : ''}`;

  if (!filtered.length) {
    container.innerHTML = '<p class="ticket-history-empty">No ticket history yet.</p>';
    return;
  }

  container.innerHTML = filtered.map((r, i) => `
    <div class="ticket-history-row">
      <div class="ticket-history-row-info">
        <span class="ticket-history-row-name">${escHtml(r.jobName)}</span>
        <span class="ticket-history-row-meta">${r.sheetCount} sheet${r.sheetCount !== 1 ? 's' : ''} — completed ${escHtml(r.completedDate)}</span>
      </div>
      <button class="btn btn-ghost btn-sm ticket-history-print-btn" data-index="${i}">Print</button>
    </div>
  `).join('');

  container.querySelectorAll('.ticket-history-print-btn').forEach(btn => {
    btn.addEventListener('click', () => reprintTicket(filtered[Number(btn.dataset.index)]));
  });
}

function reprintTicket(record) {
  showTicketAndPrint(record);
}

/* ══════════════════════════════════════════
   Manage Customers
══════════════════════════════════════════ */
function showManageCustomersScreen() {
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = false;
  settingsScreen.hidden      = true;
  document.getElementById('customers-add-input').value = '';
  renderCustomersList();
}

function renderCustomersList() {
  const container = document.getElementById('customers-list');
  const entries = Storage.getCustomers();

  document.getElementById('customers-count').textContent =
    `${entries.length} customer${entries.length !== 1 ? 's' : ''}`;

  if (!entries.length) {
    container.innerHTML = '<p class="ticket-history-empty">No customers yet — add one above.</p>';
    return;
  }

  container.innerHTML = entries.map(c => `
    <div class="ticket-history-row" data-key="${escHtml(c.key)}">
      <div class="ticket-history-row-info">
        <input type="text" class="form-input customers-rename-input" value="${escHtml(c.name)}">
      </div>
      <button class="btn btn-ghost btn-sm customers-rename-btn">Rename</button>
      <button class="btn btn-danger btn-sm customers-delete-btn">Delete</button>
    </div>
  `).join('');

  container.querySelectorAll('.customers-rename-btn').forEach(btn => {
    const row = btn.closest('.ticket-history-row');
    btn.addEventListener('click', () => {
      const oldKey = row.dataset.key;
      const newName = row.querySelector('.customers-rename-input').value.trim();
      if (!newName) return;
      Storage.renameCustomer(oldKey, Keys.customer(newName), newName);
      renderCustomersList();
    });
  });

  container.querySelectorAll('.customers-delete-btn').forEach(btn => {
    const row = btn.closest('.ticket-history-row');
    btn.addEventListener('click', () => {
      const entry = entries.find(c => c.key === row.dataset.key);
      if (!confirm(`Remove "${entry.name}" from the customer list? This does not affect any job already tagged with this name.`)) return;
      Storage.removeCustomer(row.dataset.key);
      renderCustomersList();
    });
  });
}

document.getElementById('customers-add-btn').addEventListener('click', () => {
  const input = document.getElementById('customers-add-input');
  const name = input.value.trim();
  if (!name) return;
  Storage.addCustomer(Keys.customer(name), name);
  input.value = '';
  renderCustomersList();
});

/* ══════════════════════════════════════════
   Projects Directory
══════════════════════════════════════════ */
function sheetNumber(fileName) {
  const m = fileName.match(/sheet\s*0*(\d+)/i) || fileName.match(/\[\s*0*(\d+)\s*\]/);
  if (m) return parseInt(m[1], 10);
  // Trailing number with no brackets, e.g. "Job Layout 0.25_MDF 6.html" -> 6.
  const trailing = fileName.replace(/\.\w+$/, '').match(/(\d+)\s*$/);
  return trailing ? parseInt(trailing[1], 10) : Infinity;
}

// Material label preceding a sheet number, e.g. "0.25 MDF" in "0.25 MDF [1].html" or
// "Job Layout 0.25_MDF" in "Job Layout 0.25_MDF 6.html". Empty string for filenames
// without either pattern (old "SheetN" naming), so those sheets still sort purely by
// sheetNumber below, unaffected by material grouping.
function sheetMaterial(fileName) {
  const bracket = fileName.match(/^(.*?)\s*\[\s*\d+\s*\]/);
  if (bracket) return bracket[1].trim().toLowerCase();
  const trailing = fileName.replace(/\.\w+$/, '').match(/^(.*?)\s+\d+\s*$/);
  return trailing ? trailing[1].trim().toLowerCase() : '';
}

function compareSheets(a, b) {
  const matA = sheetMaterial(a.fileName);
  const matB = sheetMaterial(b.fileName);
  if (matA !== matB) return matA.localeCompare(matB);
  return sheetNumber(a.fileName) - sheetNumber(b.fileName);
}

// Board order: thickest material first, then compareSheets inside each thickness. The CSV
// export, billing and the notes window keep plain compareSheets order (doExport re-sorts).
function getDisplaySheets() {
  const result = currentProject
    ? visibleSheets().filter(s => Keys.jobOf(s) === currentProject)
    : [...visibleSheets()];
  return SheetThickness.order(result.sort(compareSheets));
}

function getProjectGroups() {
  const map = {};
  for (const sheet of visibleSheets()) {
    const key = Keys.jobOf(sheet);
    if (!map[key]) map[key] = [];
    map[key].push(sheet);
  }
  return map;
}

function projectProgressPct(projectSheets) {
  const total = projectSheets.length;
  if (!total) return 0;
  const complete = projectSheets.filter(s => {
    const rec = Storage.get(s.fileKey, 'sheet');
    return rec && rec.status === 'complete';
  }).length;
  return complete / total;
}

// The empty board's line under "No jobs loaded." One per calendar day, not per render: the
// board redraws on every live update, and a random pick would change under Collin's eyes.
const EMPTY_BOARD_LINES = [
  'I guess you get to go home. NOT!!!',
  'Measure twice, cut once, nap never.',
  'The spindle is resting. You are not.',
  'Sweep like someone\'s watching. Someone is.',
  'Today\'s forecast: 100% chance of sawdust.',
  'Great shops aren\'t built on empty queues. Go find something to sharpen.',
  'A clean shop is a fast shop.',
  'Somewhere, a dull bit is waiting for you to notice it.',
  'The CNC doesn\'t take breaks. Neither do brooms.',
  'Every master was once a beginner who cleaned up after himself.',
  'No jobs? Perfect time to organize the tool rack you keep saying you\'ll organize.',
  'Why did the router bit break up with the MDF? Too much baggage. Dust everywhere.',
  'Patience is a virtue. So is vacuuming the spoilboard.',
  'Quality is what happens when nobody\'s checking.',
  'You miss 100% of the cuts you don\'t zero.',
  'Rome wasn\'t built in a day, but it probably had a CNC queue.',
  'Idle hands make great broom handlers.',
  'Take a deep breath. Now go check the collets.',
  'The best time to clean the dust collector was yesterday. The second best time is now.',
  'Hard work beats talent when talent doesn\'t sweep.',
  'Fun fact: the floor does not sweep itself. We checked.',
  'Sharp tools, sharp mind.',
  'Today is a great day to restock the screws.',
  'Be the reason the next job runs smooth.',
  'Knock knock. Who\'s there? Not a job. Grab the broom.',
  'Small progress is still progress. So is wiping down the machine.',
  'If you can read this, the shop vac is lonely.',
  'Do it right, or do it twice.',
  'Champions are made when the queue is empty.',
  'Stay sharp. Stay dusty. Stay awesome.',
];

function emptyBoardLine(date = new Date()) {
  const day = Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86400000);
  return EMPTY_BOARD_LINES[((day % EMPTY_BOARD_LINES.length) + EMPTY_BOARD_LINES.length) % EMPTY_BOARD_LINES.length];
}

function emptyBoardMessage() {
  const box = document.createElement('div');
  box.className = 'empty-state empty-board';
  const title = document.createElement('div');
  title.className = 'empty-board-title';
  title.textContent = 'No jobs loaded.';
  const line = document.createElement('div');
  line.className = 'empty-board-line';
  line.textContent = emptyBoardLine();
  box.append(title, line);
  return box;
}

function renderProjects() {
  const container = document.getElementById('projects-container');
  container.innerHTML = '';

  const groups = getProjectGroups();
  let names  = Object.keys(groups);

  document.getElementById('projects-count').textContent =
    `${names.length} project${names.length !== 1 ? 's' : ''} · ${visibleSheets().length} sheet${visibleSheets().length !== 1 ? 's' : ''}`;

  const inProgCount = visibleSheets().filter(s => {
    const rec = Storage.get(s.fileKey, 'sheet');
    return rec && rec.status === 'in-progress';
  }).length;
  const completeCount = visibleSheets().filter(s => {
    const rec = Storage.get(s.fileKey, 'sheet');
    return rec && rec.status === 'complete';
  }).length;
  const statsBarEl = document.getElementById('stats-bar');
  statsBarEl.innerHTML = `
    <div class="stat-tile"><div class="stat-tile-value">${names.length}</div><div class="stat-tile-label">Project${names.length !== 1 ? 's' : ''}</div></div>
    <div class="stat-tile"><div class="stat-tile-value">${visibleSheets().length}</div><div class="stat-tile-label">Sheet${sheets.length !== 1 ? 's' : ''}</div></div>
    <div class="stat-tile stat-tile--gold"><div class="stat-tile-value">${inProgCount}</div><div class="stat-tile-label">In Progress</div></div>
    <div class="stat-tile stat-tile--green"><div class="stat-tile-value">${completeCount}</div><div class="stat-tile-label">Complete</div></div>`;

  if (!names.length) {
    if (showFinished) container.innerHTML = '<div class="empty-state">No finished jobs found. If you expected some and none show, reload the page.</div>';
    else container.appendChild(emptyBoardMessage());
    return;
  }

  const query = (projectSearchEl?.value || '').trim().toLowerCase();
  if (query) names = names.filter(n => n.toLowerCase().includes(query));

  const sortMode = projectSortEl?.value || 'recent';
  if (sortMode === 'name') {
    names.sort((a, b) => a.localeCompare(b));
  } else if (sortMode === 'progress') {
    names.sort((a, b) => projectProgressPct(groups[b]) - projectProgressPct(groups[a]));
  }
  // 'recent' keeps natural (upload) order

  if (!names.length) {
    container.innerHTML = '<div class="empty-state">No projects match your search.</div>';
    return;
  }

  for (const name of names) {
    container.appendChild(buildProjectCard(name, groups[name]));
  }
}

const deletesInFlight = new Map();   // fileKey -> sheet, while deleteSheetsAndReport waits on the database

// The live sheets listener. A sheet whose delete is still waiting on the database stays on the
// board: Firestore's local write drops it from the snapshot at once, and a refused delete would
// otherwise vanish, move the screen, then come back.
function applySheetsSnapshot(newSheets) {
  if (newJobs.observe(newSheets, uploadedHere)) playNewJobChime();
  renderNewJobBanner();
  const have = new Set(newSheets.map(s => s.fileKey));
  sheets = newSheets.concat([...deletesInFlight.values()].filter(s => !have.has(s.fileKey)));
  if (!projectsScreen.hidden) renderProjects();
  BillingScreen.boardChanged();   // owners' Billing: reload the finished list if a job just left the board
  if (!contentScreen.hidden) {
    const remaining = currentProject
      ? visibleSheets().filter(s => Keys.jobOf(s) === currentProject)
      : visibleSheets();
    if (!remaining.length) {
      showProjectsScreen();
      return;
    }
    if (selectedSheetKey && !remaining.some(s => s.fileKey === selectedSheetKey)) {
      selectedSheetKey = null;
    }
    showContentScreen();
  }
}

// The one delete action behind the trash icon, Delete Sheet and job-details Cancel (spec
// .scratch/complete-sheet-delete). Waits for Storage.deleteSheets, takes ONLY the sheets it reports
// deleted off the board, and shows one notice for any it couldn't delete. Callers navigate.
async function deleteSheetsAndReport(fileKeys) {
  // Labels first: the live sheets listener may redraw `sheets` while the deletes are in flight.
  const keys = new Set(fileKeys);
  const targets = sheets.filter(s => keys.has(s.fileKey));
  const labels = new Map(targets.map(s => [s.fileKey, s.sheetTitle || s.fileName]));
  targets.forEach(s => deletesInFlight.set(s.fileKey, s));
  let result;
  try { result = await Storage.deleteSheets(fileKeys); }
  finally { fileKeys.forEach(k => deletesInFlight.delete(k)); }
  const gone = new Set(result.deleted);
  sheets = sheets.filter(s => !gone.has(s.fileKey));
  const notices = [];
  const nBlocked = result.blocked.length;
  if (nBlocked) {
    notices.push(nBlocked === 1
      ? "1 sheet wasn't deleted because it's on an invoice. Ask Travis or Eva."
      : `${nBlocked} sheets weren't deleted because they're on an invoice. Ask Travis or Eva.`);
  }
  if (result.failed.length) {
    const names = result.failed.map(f => `"${labels.get(f.fileKey) || f.fileKey}"`).join(', ');
    notices.push(`Couldn't delete ${names}. Check your connection and try again.`);
  }
  if (notices.length) showNotice(notices.join('\n\n'));
  return gone;
}

async function deleteProject(jobName) {
  await deleteSheetsAndReport(sheets.filter(s => Keys.jobOf(s) === jobName).map(s => s.fileKey));
  if (!sheets.length) {
    showProjectsScreen();
  } else {
    renderProjects();
  }
}

async function deleteSheetFromProject(sheet) {
  const label = sheet.sheetTitle || sheet.fileName;
  if (!confirm(`Delete "${label}"? This removes its completion record and note for everyone.`)) return;

  const gone = await deleteSheetsAndReport([sheet.fileKey]);

  const remaining = currentProject ? sheets.filter(s => Keys.jobOf(s) === currentProject) : sheets;
  if (!remaining.length) {
    showProjectsScreen();
    return;
  }

  if (gone.has(selectedSheetKey)) selectedSheetKey = null;
  renderAllSheets();
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
  hdrText.className = 'project-card-header-text';
  hdrText.innerHTML = `
    <div class="project-card-name">${escHtml(jobName)}</div>
    <div class="project-card-sheet-count">${total} sheet${total !== 1 ? 's' : ''}</div>`;
  const thicknessLine = SheetThickness.summary(projectSheets);
  if (thicknessLine) {
    const tEl = document.createElement('div');
    tEl.className = 'project-card-sheet-count';
    tEl.textContent = thicknessLine;
    hdrText.appendChild(tEl);
  }

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

  /* Progress row (ring) */
  const barWrap = document.createElement('div');
  barWrap.className = 'project-progress-wrap';
  const circumference = 2 * Math.PI * 24;
  const offset = circumference * (1 - pct / 100);
  barWrap.innerHTML = `
    <div class="project-ring-wrap">
      <div class="project-ring">
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle class="project-ring-track" cx="28" cy="28" r="24" fill="none" stroke-width="5"/>
          <circle class="project-ring-fill" cx="28" cy="28" r="24" fill="none" stroke-width="5"
            stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
        </svg>
        <div class="project-ring-label">${pct}%</div>
      </div>
      <span class="project-ring-caption">${complete} of ${total} complete</span>
    </div>`;

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
  noteBtn.textContent = Storage.getNote(Keys.job(jobName)) ? 'Edit Note' : 'Add Note';
  noteBtn.addEventListener('click', e => {
    e.stopPropagation();
    openNotesModal(jobName);
  });

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn btn-primary btn-sm';
  exportBtn.textContent = 'Export CSV';
  exportBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const jobSheets = [...projectSheets].sort(compareSheets);
    const customerName = await customerForExport(jobName);
    if (!customerName) return;
    await exportJob(jobName, jobSheets, customerName);
  });

  const btnGroup = document.createElement('div');
  btnGroup.className = 'project-card-btn-group';
  btnGroup.appendChild(noteBtn);
  btnGroup.appendChild(exportBtn);

  body.appendChild(barWrap);

  const existingNote = Storage.getNote(Keys.job(jobName));
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

  if (Features.on('jobCard')) hdrText.appendChild(JobCard.cardChip(jobName, projectSheets));
  if (showFinished) {
    // Finished jobs: history. No delete, no export; open for the owner panel only.
    deleteBtn.hidden = true;
    exportBtn.hidden = true;
    const fin = document.createElement('span');
    fin.className = 'jc-chip';
    const at = projectSheets.map(s => s.finishedAt || 0).reduce((a, b) => Math.max(a, b), 0);
    fin.textContent = at ? `Finished ${new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'Finished';
    hdrText.appendChild(fin);
  }

  const newTag = showFinished ? null : NewJobAlert.tag(newJobs.fresh(jobName));
  if (newTag) {
    const t = document.createElement('span');
    t.className = 'new-job-tag';
    t.textContent = newTag;
    hdrText.prepend(t);
  }

  card.addEventListener('click', () => {
    if (!showFinished) { newJobs.opened(jobName); renderNewJobBanner(); }
    currentProject = jobName;
    viewingFinished = showFinished;
    vanlabForgetJob();
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

function sheetStatusClass(sheet) {
  const rec = Storage.get(sheet.fileKey, 'sheet');
  if (rec && rec.status === 'complete') return 'is-complete';
  if (rec && rec.status === 'in-progress') return 'is-progress';
  return 'is-pending';
}

function renderAllSheets() {
  const displaySheets = getDisplaySheets();
  drawOwnerPanel(displaySheets);
  headerSheetCount.textContent = `${displaySheets.length} sheet${displaySheets.length !== 1 ? 's' : ''}`;

  if (!displaySheets.length) {
    sheetNavEl.innerHTML = '';
    sheetDetailEl.innerHTML = '<div class="detail-empty">No sheets loaded.</div>';
    lastRenderedSheetKey = null;
    updateOverallProgress(displaySheets);
    return;
  }

  if (!selectedSheetKey || !displaySheets.find(s => s.fileKey === selectedSheetKey)) {
    const firstActive = displaySheets.find(s => !isCompleted(s));
    selectedSheetKey = (firstActive || displaySheets[0]).fileKey;
  }

  const active   = displaySheets.filter(s => !isCompleted(s));
  const complete = displaySheets.filter(s =>  isCompleted(s));

  const tagGroups = Features.on('jobCard') ? Pricing.repeatGroups(displaySheets) : null;
  sheetNavEl.innerHTML = '';
  // A heading each time the thickness changes ("3/4 in — 7 sheets"); none for old files with no thickness.
  const showThickness = SheetThickness.known(active);
  let lastThickness;
  active.forEach((sheet, i) => {
    const idx = displaySheets.indexOf(sheet);
    const t = SheetThickness.of(sheet);
    if (showThickness && (i === 0 || t !== lastThickness)) {
      const n = active.filter(s => SheetThickness.of(s) === t).length;
      const label = document.createElement('div');
      label.className = 'sheet-nav-section-label';
      label.textContent = `${SheetThickness.label(t)} — ${n} sheet${n !== 1 ? 's' : ''}`;
      sheetNavEl.appendChild(label);
    }
    lastThickness = t;
    sheetNavEl.appendChild(buildSheetNavRow(sheet, idx, tagGroups));
  });
  if (complete.length) {
    const label = document.createElement('div');
    label.className = 'sheet-nav-section-label';
    label.textContent = `Complete (${complete.length})`;
    sheetNavEl.appendChild(label);
    complete.forEach((sheet) => {
      const idx = displaySheets.indexOf(sheet);
      sheetNavEl.appendChild(buildSheetNavRow(sheet, idx, tagGroups));
    });
  }

  const selectedSheet = displaySheets.find(s => s.fileKey === selectedSheetKey);
  const selectedIdx   = displaySheets.indexOf(selectedSheet);
  // Only carry the scroll position over when this render is repainting the
  // SAME sheet that was already on screen (e.g. a redraw triggered by this
  // tab's own annotation write echoing back through Firestore). A nav click
  // to a different sheet, or the selected sheet being deleted out from
  // under us, both land on a different fileKey than what was last
  // rendered — those should start the new diagram fresh at the top.
  const sameSheet  = !!selectedSheet && selectedSheet.fileKey === lastRenderedSheetKey;
  const prevScroll = sameSheet ? (sheetDetailEl.querySelector('.layout-svg-scroll')?.scrollTop || 0) : 0;
  sheetDetailEl.innerHTML = '';
  sheetDetailEl.className = `sheet-detail ${sheetStatusClass(selectedSheet)}`;
  sheetDetailEl.appendChild(buildSheetDetail(selectedSheet, selectedIdx));
  if (sameSheet) {
    const newScrollEl = sheetDetailEl.querySelector('.layout-svg-scroll');
    if (newScrollEl) newScrollEl.scrollTop = prevScroll;
  }
  lastRenderedSheetKey = selectedSheet ? selectedSheet.fileKey : null;

  updateOverallProgress(displaySheets);
}

function buildSheetNavRow(sheet, idx, tagGroups) {
  const row = document.createElement('div');
  row.className = `sheet-nav-row ${sheetStatusClass(sheet)}${sheet.fileKey === selectedSheetKey ? ' selected' : ''}`;
  row.dataset.sheetKey = sheet.fileKey;

  const numEl = document.createElement('div');
  numEl.className = 'nav-row-num';
  numEl.textContent = idx + 1;

  const textWrap = document.createElement('div');
  textWrap.className = 'nav-row-text';
  const titleEl = document.createElement('div');
  titleEl.className = 'nav-row-title';
  titleEl.textContent = sheet.sheetTitle || sheet.fileName;
  const subEl = document.createElement('div');
  subEl.className = 'nav-row-sub';
  subEl.textContent = sheet.totalTime ? `${sheet.totalTime} total` : sheet.fileName.replace(/\.html?$/i, '');
  textWrap.appendChild(titleEl);
  textWrap.appendChild(subEl);
  if (tagGroups) textWrap.appendChild(JobCard.navRowExtras(sheet, tagGroups));

  const dotEl = document.createElement('span');
  dotEl.className = 'nav-row-dot';

  row.appendChild(numEl);
  row.appendChild(textWrap);
  if (Storage.getSheetNote(sheet.fileKey)) {
    const noteIcon = document.createElement('span');
    noteIcon.className = 'nav-row-note';
    noteIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    row.appendChild(noteIcon);
  }
  row.appendChild(dotEl);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'nav-row-delete';
  deleteBtn.setAttribute('aria-label', 'Delete sheet');
  deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteSheetFromProject(sheet);
  });
  row.appendChild(deleteBtn);

  row.addEventListener('click', () => {
    selectedSheetKey = sheet.fileKey;
    renderAllSheets();
  });

  return row;
}

function buildSheetDetail(sheet, idx) {
  const wrap = document.createElement('div');

  /* ── Hero header ── */
  const hero = document.createElement('div');
  hero.className = `detail-hero ${sheetStatusClass(sheet)}`;

  const heroTop = document.createElement('div');
  heroTop.className = 'detail-hero-top';

  const numEl = document.createElement('div');
  numEl.className = 'detail-num';
  numEl.textContent = idx + 1;

  const titlesEl = document.createElement('div');
  titlesEl.className = 'detail-titles';
  const titleEl = document.createElement('div');
  titleEl.className = 'detail-title';
  titleEl.textContent = sheet.sheetTitle || sheet.fileName;
  const fileEl = document.createElement('div');
  fileEl.className = 'detail-filename';
  fileEl.textContent = sheet.fileName.replace(/\.html?$/i, '');
  titlesEl.appendChild(titleEl);
  titlesEl.appendChild(fileEl);

  heroTop.appendChild(numEl);
  heroTop.appendChild(titlesEl);

  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'btn btn-ghost btn-sm';
  noteBtn.textContent = Storage.getSheetNote(sheet.fileKey) ? 'Edit Note' : 'Add Note';
  noteBtn.addEventListener('click', e => {
    e.stopPropagation();
    openSheetNoteModal(sheet);
  });
  heroTop.appendChild(noteBtn);

  const deleteSheetBtn = document.createElement('button');
  deleteSheetBtn.type = 'button';
  deleteSheetBtn.className = 'btn btn-ghost btn-sm detail-delete-btn';
  deleteSheetBtn.textContent = 'Delete Sheet';
  deleteSheetBtn.addEventListener('click', e => {
    e.stopPropagation();
    deleteSheetFromProject(sheet);
  });
  heroTop.appendChild(deleteSheetBtn);

  hero.appendChild(heroTop);

  const metaEl = document.createElement('div');
  metaEl.className = 'detail-hero-meta';
  if (sheet.totalTime) {
    const pill = document.createElement('span');
    pill.className = 'detail-status-pill';
    pill.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      ${escHtml(sheet.totalTime)} total`;
    metaEl.appendChild(pill);
  }
  hero.appendChild(metaEl);
  wrap.appendChild(hero);

  /* ── Instruction note (read-only here; edited from the project card modal or the Add/Edit Note button above) ── */
  const noteText = Storage.getSheetNote(sheet.fileKey);
  if (noteText) {
    const callout = document.createElement('div');
    callout.className = 'sheet-note-callout';
    callout.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <div class="sheet-note-callout-body">
        <div class="sheet-note-callout-label">Note</div>
        <div class="sheet-note-callout-text"></div>
      </div>`;
    callout.querySelector('.sheet-note-callout-text').textContent = noteText;
    wrap.appendChild(callout);
  }

  /* ── Body ── */
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
    wrap.appendChild(strip);
  }

  if (sheet.layoutOversize) {
    const notice = document.createElement('div');
    notice.className = 'layout-svg-oversize';
    notice.textContent = 'Layout preview is too large to store. ';
    if (sheet.archiveUrl) {
      const link = document.createElement('a');
      link.href = sheet.archiveUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open the original sheet';
      notice.appendChild(link);
    }
    wrap.appendChild(notice);
  } else if (!sheet.layoutSvg && !sheet.layoutSvgGz && sheet.archiveUrl && sheet.finishedAt) {
    // Finishing drops the stored drawing (the archive is the drawing of record); a sheet put
    // back on the board keeps that, so say so instead of showing nothing.
    const notice = document.createElement('div');
    notice.className = 'layout-svg-oversize';
    notice.textContent = 'Layout preview is not stored here. ';
    const link = document.createElement('a');
    link.href = sheet.archiveUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Open the original sheet';
    notice.appendChild(link);
    wrap.appendChild(notice);
  } else if (sheet.layoutSvg || sheet.layoutSvgGz) {
    try {
      const svgWrap = document.createElement('div');
      svgWrap.className = 'layout-svg-wrap';
      const label = document.createElement('div');
      label.className = 'layout-svg-label';
      label.textContent = 'Material Border';
      svgWrap.appendChild(label);
      const scrollEl = document.createElement('div');
      scrollEl.className = 'layout-svg-scroll';
      svgWrap.appendChild(scrollEl);
      wrap.appendChild(svgWrap);

      if (sheet.layoutSvg) {
        scrollEl.innerHTML = sheet.layoutSvg;
        Markup.mount(svgWrap, scrollEl, sheet);
      } else if (svgCache.has(sheet.fileKey)) {
        scrollEl.innerHTML = svgCache.get(sheet.fileKey);
        Markup.mount(svgWrap, scrollEl, sheet);
      } else {
        // Async: the panel is already in the DOM, fill the drawing in when
        // it decodes. Guard against the operator selecting another sheet
        // mid-decompress.
        const renderingKey = sheet.fileKey;
        scrollEl.textContent = 'Loading layout…';
        SvgCodec.decompressSvg(sheet.layoutSvgGz)
          .then(svg => {
            svgCache.set(renderingKey, svg);
            if (selectedSheetKey !== renderingKey) return;
            if (!scrollEl.isConnected) return;
            scrollEl.innerHTML = svg;
            Markup.mount(svgWrap, scrollEl, sheet);
          })
          .catch(err => {
            console.error('SVG decompress failed:', err);
            scrollEl.textContent = 'Layout preview could not be loaded.';
          });
      }
    } catch (err) {
      console.error('SVG render failed:', err);
    }
  }

  if (sheet.toolpaths?.length) {
    const list = document.createElement('div');
    list.className = 'toolpaths-list';
    sheet.toolpaths.forEach(item => list.appendChild(buildItemRow(item)));
    wrap.appendChild(list);
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No toolpaths found in this sheet.';
    wrap.appendChild(empty);
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
  wrap.appendChild(footer);

  applySheetCompletion(sheet, wrap, actionBtn, clearBtn, statusEl);

  return wrap;
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

// Blocking pop-up (must be dismissed) for "this sheet is already loaded".
function showNotice(msg) { noticeTextEl.textContent = msg; noticeOverlay.classList.remove('hidden'); }
function closeNotice()   { noticeOverlay.classList.add('hidden'); }

let notesCtx = null;

function openNotesModal(jobName) {
  notesCtx = { jobName };
  document.getElementById('notes-modal-subtitle').textContent = jobName;
  document.getElementById('notes-modal-text').value = Storage.getNote(Keys.job(jobName)) || '';

  const sheetsWrap = document.getElementById('notes-modal-sheets');
  sheetsWrap.innerHTML = '';
  const projectSheets = sheets
    .filter(s => Keys.jobOf(s) === jobName)
    .sort(compareSheets);
  if (projectSheets.length) {
    const heading = document.createElement('div');
    heading.className = 'notes-modal-section-label';
    heading.textContent = 'Sheet Notes';
    sheetsWrap.appendChild(heading);
  }
  for (const sheet of projectSheets) {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = sheet.sheetTitle || sheet.fileName;
    const ta = document.createElement('textarea');
    ta.className = 'form-input form-textarea';
    ta.placeholder = 'Add a note for this sheet…';
    ta.dataset.fileKey = sheet.fileKey;
    ta.value = Storage.getSheetNote(sheet.fileKey) || '';
    group.appendChild(label);
    group.appendChild(ta);
    sheetsWrap.appendChild(group);
  }

  notesOverlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('notes-modal-text').focus(), 50);
}

function closeNotesModal() {
  notesOverlay.classList.add('hidden');
  notesCtx = null;
}

let sheetNoteCtx = null;

function openSheetNoteModal(sheet) {
  sheetNoteCtx = { sheet };
  sheetNoteSubtitle.textContent = sheet.sheetTitle || sheet.fileName;
  sheetNoteText.value = Storage.getSheetNote(sheet.fileKey) || '';
  sheetNoteOverlay.classList.remove('hidden');
  setTimeout(() => sheetNoteText.focus(), 50);
}

function closeSheetNoteModal() {
  sheetNoteOverlay.classList.add('hidden');
  sheetNoteCtx = null;
}

async function saveSheetNote() {
  if (!sheetNoteCtx) return;
  const { sheet } = sheetNoteCtx;
  await Storage.setSheetNote(sheet.fileKey, sheetNoteText.value);
  closeSheetNoteModal();
  renderAllSheets();
}

/* ══════════════════════════════════════════
   Customer Picker (prompted at export)
══════════════════════════════════════════ */
let customerPickerCtx = null; // { jobName, resolve }

// Fills a customer <select> (known customers + "+ New customer…") and pre-selects the job's prior
// customer. Shared by the export picker and the owner job-details form. Returns the prior name when
// it is no longer in the directory (kept visible as free text), else null.
function fillCustomerSelect(selectEl, otherGrpEl, otherEl, jobKey, priorOverride) {
  otherGrpEl.hidden = true;
  otherEl.value = '';
  const known = Storage.getCustomers();
  selectEl.innerHTML = '<option value="" disabled>Select customer…</option>' +
    known.map(c => `<option value="${escHtml(c.key)}">${escHtml(c.name)}</option>`).join('') +
    '<option value="__other__">+ New customer…</option>';
  const priorName = priorOverride || Storage.getProjectCustomer(jobKey);
  const priorMatch = priorName && known.find(c => c.name === priorName);
  if (priorMatch) {
    selectEl.value = priorMatch.key;
    return null;
  }
  if (priorName) {
    // Tagged before, but that exact name isn't in the directory anymore
    // (renamed/deleted since) — keep it visible as free text rather than
    // silently losing the tag.
    selectEl.value = '__other__';
    otherGrpEl.hidden = false;
    otherEl.value = priorName;
    return priorName;
  }
  selectEl.value = '';
  return null;
}


function openCustomerPicker(jobName) {
  return new Promise(resolve => {
    customerPickerCtx = { jobName, resolve };
    customerPickerSubtitle.textContent = jobName;
    customerPickerCtx.staleName = fillCustomerSelect(customerPickerSelect, customerPickerOtherGrp, customerPickerOther, Keys.job(jobName));

    updateCustomerPickerConfirmState();
    customerPickerOverlay.classList.remove('hidden');
  });
}

function updateCustomerPickerConfirmState() {
  const valid = customerPickerSelect.value === '__other__'
    ? customerPickerOther.value.trim().length > 0
    : customerPickerSelect.value !== '';
  customerPickerConfirm.disabled = !valid;
}

customerPickerSelect.addEventListener('change', () => {
  customerPickerOtherGrp.hidden = customerPickerSelect.value !== '__other__';
  updateCustomerPickerConfirmState();
});
customerPickerOther.addEventListener('input', updateCustomerPickerConfirmState);

function closeCustomerPicker(result) {
  customerPickerOverlay.classList.add('hidden');
  const ctx = customerPickerCtx;
  customerPickerCtx = null;
  if (ctx) ctx.resolve(result);
}

document.getElementById('customer-picker-cancel').addEventListener('click', () => closeCustomerPicker(null));
customerPickerOverlay.addEventListener('click', e => { if (e.target === customerPickerOverlay) closeCustomerPicker(null); });

customerPickerConfirm.addEventListener('click', () => {
  const ctx = customerPickerCtx;
  if (!ctx) return;
  let name;
  if (customerPickerSelect.value === '__other__') {
    name = customerPickerOther.value.trim();
    if (!name) return;
    if (name !== ctx.staleName) {
      Storage.addCustomer(Keys.customer(name), name);
    }
  } else {
    const match = Storage.getCustomers().find(c => c.key === customerPickerSelect.value);
    if (!match) return;
    name = match.name;
  }
  Storage.setProjectCustomer(Keys.job(ctx.jobName), name);
  closeCustomerPicker(name);
});

async function saveNote() {
  if (!notesCtx) return;
  const text = document.getElementById('notes-modal-text').value;
  const writes = [Storage.setNote(Keys.job(notesCtx.jobName), text)];
  document.querySelectorAll('#notes-modal-sheets textarea').forEach(ta => {
    const existing = Storage.getSheetNote(ta.dataset.fileKey) || '';
    if (ta.value.trim() !== existing) {
      writes.push(Storage.setSheetNote(ta.dataset.fileKey, ta.value));
    }
  });
  await Promise.all(writes);
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
  Storage.setAnnotations(sheet.fileKey, []);
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
function ticketMeta(jobName, displaySheets) {
  const name = jobName
    || displaySheets[0]?.jobName
    || (displaySheets[0]?.fileName || 'CNC Job').replace(/\.html?$/i, '');
  let latest = null;
  for (const sheet of displaySheets) {
    const rec = Storage.get(sheet.fileKey, 'sheet');
    if (rec?.completedAt) {
      const d = new Date(rec.completedAt);
      if (!latest || d > latest) latest = d;
    }
  }
  const completedDate = (latest || new Date()).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  return { jobName: name, sheetCount: displaySheets.length, completedDate };
}

function showTicketAndPrint(meta) {
  const ticket = document.getElementById('job-ticket');
  if (!ticket) return;
  document.getElementById('job-ticket-name').textContent = meta.jobName;
  document.getElementById('job-ticket-meta').textContent =
    `${meta.sheetCount} sheet${meta.sheetCount !== 1 ? 's' : ''} — completed ${meta.completedDate}`;
  ticket.hidden = false;
  document.body.classList.add('printing-ticket');
  try {
    window.print();
  } finally {
    document.body.classList.remove('printing-ticket');
    ticket.hidden = true;
  }
}

function printJobTicket(jobName, displaySheets) {
  if (!displaySheets.length) return;
  showTicketAndPrint(ticketMeta(jobName, displaySheets));
}

// Known from upload/job details or an earlier export -> no question. Missing (legacy job) ->
// today's picker, which saves its answer to projectCustomer itself.
function customerForExport(jobName) {
  const known = jobName ? Storage.getProjectCustomer(Keys.job(jobName)) : null;
  return known ? Promise.resolve(known) : openCustomerPicker(jobName);
}

// True when running against a real Firestore project (not the PASTE in-memory test mode);
// same test initApp uses.
function hasDatabase() {
  return typeof FIREBASE_CONFIG !== 'undefined' && !!FIREBASE_CONFIG.projectId
    && !FIREBASE_CONFIG.projectId.startsWith('PASTE');
}

async function exportJob(jobName, jobSheets, customerName) {
  if (!jobSheets.length) { alert('No sheets loaded to export.'); return; }
  const completionOf = fileKey => Storage.get(fileKey, 'sheet');

  const file = ExportFinish.csvFile(jobSheets, completionOf, customerName);
  const blob = new Blob([file.text], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);

  // Print (and save to reprintable history) BEFORE the network await below —
  // window.print() must run within the click's "fresh" window or Chrome
  // silently drops it once enough time has passed since the triggering click.
  const meta = ticketMeta(jobName, jobSheets);
  showTicketAndPrint(meta);
  Storage.saveTicketRecord(meta);

  // Master Job Log: ONE object per sheet, upserted by Sheet Key - exporting the same job twice
  // updates the same rows and can never append a second copy (spec 6.2 / 7.3). The job is
  // finished only if that write worked; ExportFinish holds the rules and the messages.
  const outcome = await ExportFinish.logAndFinish({ jobName, jobSheets, customerName, by: currentUserEmail() }, {
    logEnabled:    () => Endpoint.enabled(),
    getIdToken:    () => Auth.getIdToken(),
    upsertLogRows: (rows, token) => Endpoint.upsertLogRows(rows, token),
    completionOf,
    hasDatabase,
    finishJob:     (name, by) => Storage.finishJob(Keys.job(name), name, by),
    finishSheets:  (list, by) => Storage.finishSheets(list, by),
  });
  if (!outcome.finished) { alert(outcome.message); return; }

  const finishedKeys = new Set(jobSheets.map(s => s.fileKey));
  sheets = sheets.filter(s => !finishedKeys.has(s.fileKey));
  currentProject = null;
  showProjectsScreen();
}

async function doExport() {
  const customerName = await customerForExport(currentProject);
  if (!customerName) return;
  await exportJob(currentProject, getDisplaySheets().sort(compareSheets), customerName);
}

async function doResetAll() {
  if (!confirm('Reset ALL completion records for this job? This cannot be undone.')) return;
  const displaySheets = getDisplaySheets();
  await Promise.all(displaySheets.map(s => Storage.clear(s.fileKey, 'sheet')));
  renderAllSheets();
}

/* ══════════════════════════════════════════
   VanLab Printing (hardware stickers, packing lists, crate label)
══════════════════════════════════════════ */
const vanlabPanel      = document.getElementById('vanlab-panel');
const vanlabHeaderBtn  = document.getElementById('vanlab-print-btn');
const vanlabBarTitle   = document.getElementById('vanlab-bar-title');
const vanlabStatus     = document.getElementById('vanlab-status');
const vanlabVanSelect  = document.getElementById('vanlab-van-select');
const vanlabVanLabel   = document.querySelector('.vanlab-van-label');
const vanlabPrintBtn   = document.getElementById('vanlab-stickers-btn');
const vanlabSuvSelect  = document.getElementById('vanlab-suv-select');
const vanlabSuvLabel   = document.querySelector('.vanlab-suv-label');
const vanlabPackingBtn = document.getElementById('vanlab-packing-btn');
const vanlabCrateBtn      = document.getElementById('vanlab-crate-btn');
const vanlabManualFields  = document.getElementById('vanlab-manual-fields');
const vanlabManualOrder   = document.getElementById('vanlab-manual-order');
const vanlabManualCustomer = document.getElementById('vanlab-manual-customer');
const vanlabManualAssembly = document.getElementById('vanlab-manual-assembly');
let vanlabOrder = null;        // lookup result for the open job, or null
let vanlabFontBytes = null;    // cached Baloo 2 bytes
let vanlabEpoch = 0;           // bumped on every panel open/close/job-switch so a
                                // slow in-flight lookup can detect it's stale and bail
let vanlabLastBlobUrl = null;  // last sticker-PDF object URL, revoked before a new one
let vanlabPackingBlobUrl = null;  // last packing-PDF object URL, revoked before a new one
let vanlabCrateBlobUrl = null;  // last crate-label object URL, revoked before a new one

// Print tracking (ticket 02) and collapse (ticket 03): who printed what lives on jobs/{jobKey}.vanlabPrinted,
// watched live while the bar is open so the office PC sees what the shop PC printed.
const vanlabCollapsedRow = document.getElementById('vanlab-collapsed');
const vanlabBarText      = document.getElementById('vanlab-bar-text');
const vanlabActions      = document.getElementById('vanlab-actions');
const vanlabItems = {
  stickers: { btn: vanlabPrintBtn,   note: document.getElementById('vanlab-stickers-note') },
  packing:  { btn: vanlabPackingBtn, note: document.getElementById('vanlab-packing-note') },
  crate:    { btn: vanlabCrateBtn,   note: document.getElementById('vanlab-crate-note') },
};
let vanlabPrinted = {};          // the open job's records: VanlabBar.printedFrom(its jobs/ doc)
let vanlabStickerCount = 0;      // for the stickers button title
let vanlabAuto = false;          // the bar showed by itself (a VanLab job) — only that bar collapses
let vanlabExpanded = false;      // Show pressed on the folded bar; kept until the job is closed
let vanlabWatchedJob = null;     // job whose jobs/ doc is being watched
let vanlabUnwatch = null;

async function loadBalooFont() {
  if (!vanlabFontBytes) {
    const resp = await fetch('assets/fonts/Baloo2-SemiBold.ttf');
    if (!resp.ok) throw new Error('font file missing');
    vanlabFontBytes = new Uint8Array(await resp.arrayBuffer());
  }
  return vanlabFontBytes;
}

function vanlabSetStatus(text, isError) {
  vanlabStatus.textContent = text;
  vanlabStatus.classList.toggle('vanlab-status-error', !!isError);
}

function vanlabShowManualPicker() {
  // Union of sticker-mapped vans and packing-capable vans: the two features
  // don't cover the same vans (e.g. SUV01/44 have packing lists but no
  // sticker rows, van 40 has stickers but no packing list), so the picker
  // has to offer both sets and let each feature give its own honest error
  // for the vans it doesn't cover.
  const vans = Array.from(new Set([
    ...Object.keys(STICKER_MAP.vanStickers),
    ...PackingMap.knownVanKeys(),
  ])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  vanlabVanSelect.innerHTML = '<option value="">— pick van type —</option>'
    + vans.map(v => `<option value="${v}">Van ${v}</option>`).join('');
  vanlabVanSelect.hidden = false;
  vanlabVanLabel.hidden = false;
  vanlabPrintBtn.disabled = true;
  vanlabPackingBtn.disabled = true;
  vanlabCrateBtn.disabled = true;
  vanlabManualFields.hidden = false;
  vanlabVanSelect.onchange = () => {
    vanlabShowStickerCount(vanlabVanSelect.value);
    vanlabPrintBtn.disabled = !vanlabVanSelect.value;
    vanlabPackingBtn.disabled = !vanlabVanSelect.value;
    vanlabCrateBtn.disabled = !vanlabVanSelect.value;
  };
  vanlabRenderPrinted();   // a folded bar opens up again when the lookup falls back to the picker
}

// Sticker count on the stickers button for a van (the looked-up one, or the one picked by hand).
function vanlabShowStickerCount(vanKey) {
  const res = vanKey ? VanlabPrint.resolveStickers(vanKey, STICKER_MAP) : null;
  vanlabStickerCount = res && res.status === 'matched' ? VanlabBar.stickerCount(res.items) : 0;
  vanlabRenderPrinted();
}

// Button titles, check marks, "Printed by …" + Undo, and the fold to one line once the kit is printed.
function vanlabRenderPrinted() {
  const vanKey = vanlabOrder ? vanlabOrder.vanKey : vanlabVanSelect.value;
  const assembly = vanlabOrder ? vanlabOrder.assembly : vanlabManualAssembly.value.trim();
  const packingNone = !!vanKey && PackingMap.resolve(vanKey, assembly, null).status === 'none_needed';
  const opts = { now: Date.now(), stickerCount: vanlabStickerCount, packingNone };
  for (const [kind, el] of Object.entries(vanlabItems)) {
    const view = VanlabBar.itemView(kind, vanlabPrinted[kind] || null, opts);
    el.btn.textContent = view.title;
    el.btn.title = view.action === 'Reprint' ? 'Print it again' : '';
    el.btn.classList.toggle('btn-primary', !view.done);
    el.btn.classList.toggle('vanlab-btn-done', view.done);
    el.note.hidden = !view.note;
    el.note.querySelector('.vanlab-item-note-text').textContent = view.note;
    el.note.querySelector('.vanlab-undo').hidden = !view.canUndo;
  }
  // Only the bar that showed by itself folds, and never while the manual van picker is up.
  const { collapsed } = VanlabBar.barState(vanlabPrinted, { packingNone, expanded: vanlabExpanded });
  const fold = collapsed && vanlabAuto && vanlabVanSelect.hidden;
  vanlabCollapsedRow.hidden = !fold;
  vanlabBarText.hidden = fold;
  vanlabActions.hidden = fold;
}

function vanlabWatch(jobName) {
  if (jobName === vanlabWatchedJob && vanlabUnwatch) return;
  vanlabUnwatchJob();
  if (!jobName) return;
  vanlabWatchedJob = jobName;
  vanlabUnwatch = Storage.onJobDocChange(Keys.job(jobName), doc => {
    if (vanlabWatchedJob !== jobName) return;
    vanlabPrinted = VanlabBar.printedFrom(doc);
    vanlabRenderPrinted();
  });
}

function vanlabUnwatchJob() {
  if (vanlabUnwatch) vanlabUnwatch();
  vanlabUnwatch = null;
  vanlabWatchedJob = null;
  vanlabPrinted = {};
}

// A print counts once the PDF opened. jobName is the job the print started on, so a job switch
// mid-print still records on the right job. Never blocks the print; a failed save says so.
function vanlabMarkPrinted(kind, jobName) {
  if (!jobName) return;
  // A print made here keeps this bar open, so its "print on the … printer" line stays readable;
  // it folds on the next open (or on other computers right away).
  if (jobName === currentProject) vanlabExpanded = true;
  const rec = VanlabBar.record(pqDisplayName(pqCurrentEmail()), Date.now());
  Storage.setVanlabPrinted(Keys.job(jobName), jobName, kind, rec).catch(err => {
    console.warn('VanLab print record failed:', err);
    if (jobName === currentProject) vanlabSetStatus(`Printed, but couldn't save the check mark — ${err.message}`, true);
  });
}

function vanlabUndoPrinted(kind) {
  if (!currentProject) return;
  Storage.clearVanlabPrinted(Keys.job(currentProject), kind).catch(err => {
    vanlabSetStatus(`Couldn't undo — ${err.message}`, true);
  });
}

// The bar belongs to one job (and its order number): showContentScreen calls this on every paint,
// and only a different job/order — or vanlabForgetJob() on a fresh open — resets it and looks the order up again.
// A VanLab job (one order number in its sheet names) gets the bar by itself and no header button;
// any other job keeps the header "VanLab Stickers" button, which opens the bar with the manual picker.
let vanlabJobKey = null;
function vanlabForgetJob() {
  vanlabJobKey = null;
  vanlabPanel.hidden = true;
  vanlabEpoch++;
  vanlabExpanded = false;
  vanlabUnwatchJob();
}

function vanlabSyncJob(displaySheets) {
  const bar = VanlabBar.forJob(displaySheets.map(s => s.fileName));
  const key = JSON.stringify([currentProject, bar.orderNum, bar.conflict]);
  if (key === vanlabJobKey) return;
  vanlabJobKey = key;
  vanlabHeaderBtn.hidden = bar.auto;
  vanlabPanel.hidden = !bar.auto;
  vanlabEpoch++;
  vanlabAuto = bar.auto;
  vanlabExpanded = false;
  if (bar.auto) { vanlabWatch(currentProject); vanlabLoad(); }
  else vanlabUnwatchJob();
}

function vanlabOpenPanel() {
  vanlabPanel.hidden = !vanlabPanel.hidden;
  if (vanlabPanel.hidden) { vanlabEpoch++; vanlabUnwatchJob(); return; }
  vanlabWatch(currentProject);
  vanlabLoad();
}

async function vanlabLoad() {
  const ep = ++vanlabEpoch;
  vanlabOrder = null;
  vanlabBarTitle.hidden = true;
  vanlabShowStickerCount(null);
  vanlabVanSelect.hidden = true;
  vanlabVanLabel.hidden = true;
  vanlabPrintBtn.disabled = true;
  vanlabSuvSelect.hidden = true;
  vanlabSuvLabel.hidden = true;
  vanlabSuvSelect.value = '';
  vanlabPackingBtn.disabled = true;
  vanlabCrateBtn.disabled = true;
  vanlabManualFields.hidden = true;
  vanlabVanSelect.value = '';   // a van picked by hand on another job must never print for this one
  vanlabManualOrder.value = '';
  vanlabManualCustomer.value = '';
  vanlabManualAssembly.value = '';
  vanlabRenderPrinted();

  const { orderNum, conflict } = VanlabBar.forJob(getDisplaySheets().map(s => s.fileName));

  if (conflict) {
    vanlabSetStatus(`This job's sheets disagree about the order number (${conflict.join(' vs ')}) — fix the uploads, or pick the van type by hand:`, true);
    vanlabShowManualPicker();
    return;
  }
  if (!orderNum) {
    vanlabSetStatus("No order number found in this job's file names — pick the van type by hand:");
    vanlabShowManualPicker();
    return;
  }

  vanlabBarTitle.textContent = VanlabBar.heading(orderNum, null);
  vanlabBarTitle.hidden = false;
  vanlabSetStatus('Looking up the Order Log…');
  try {
    const idToken = await Auth.getIdToken();
    if (ep !== vanlabEpoch) return;
    const order = await Endpoint.lookupOrder(orderNum, idToken);
    if (ep !== vanlabEpoch) return;
    if (!order) {   // endpoint not configured (offline/test copy)
      vanlabSetStatus('Order lookup is not configured on this copy — pick the van type by hand:', true);
      vanlabShowManualPicker();
      return;
    }
    vanlabOrder = order;
    vanlabBarTitle.textContent = VanlabBar.heading(orderNum, order);
    vanlabShowStickerCount(order.vanKey);
    vanlabSetStatus(`${order.customer || 'No customer on the Order Log'} — print these now so the kit gets packed while the sheets cut.`);
    vanlabPrintBtn.disabled = false;
    vanlabPackingBtn.disabled = false;
    vanlabCrateBtn.disabled = false;
  } catch (err) {
    const why = err.endpointError ? err.message : 'the Order Log lookup is unreachable';
    vanlabSetStatus(`Couldn't look up order ${orderNum} — ${why}. Pick the van type by hand:`, true);
    vanlabShowManualPicker();
  }
}

async function vanlabPrintStickers() {
  const ep = vanlabEpoch;
  const jobName = currentProject;
  const vanKey = vanlabOrder ? vanlabOrder.vanKey : vanlabVanSelect.value;
  const res = VanlabPrint.resolveStickers(vanKey, STICKER_MAP);
  if (res.status !== 'matched') {
    vanlabSetStatus(`Can't print: ${res.reason}. The Sticker Map sheet has no rows tagged for this van.`, true);
    vanlabOrder = null;
    vanlabShowManualPicker();
    return;
  }
  vanlabPrintBtn.disabled = true;
  vanlabSetStatus('Building the sticker PDF…');
  try {
    const bytes = await StickerPdf.buildStickerPdf(res.items, STICKER_MAP.stickers, await loadBalooFont());
    if (ep !== vanlabEpoch) return;   // the job changed while the PDF was building
    if (vanlabLastBlobUrl) URL.revokeObjectURL(vanlabLastBlobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    vanlabLastBlobUrl = url;
    const opened = window.open(url, '_blank');
    if (!opened) {
      vanlabSetStatus('Popup blocked — allow popups for this site, then click Hardware stickers again.', true);
      return;
    }
    vanlabMarkPrinted('stickers', jobName);
    const count = res.items.reduce((n, [, q]) => n + q, 0);
    vanlabSetStatus(`${count} stickers ready — print the opened PDF on the STICKERS 1x3 printer at 100% scale.`);
  } catch (err) {
    if (ep === vanlabEpoch) vanlabSetStatus(`Couldn't build the sticker PDF — ${err.message}`, true);
  } finally {
    if (ep === vanlabEpoch) vanlabPrintBtn.disabled = false;
  }
}

async function vanlabPrintPacking() {
  const ep = vanlabEpoch;
  const jobName = currentProject;
  const vanKey = vanlabOrder ? vanlabOrder.vanKey : vanlabVanSelect.value;
  const order = vanlabOrder || { orderNum: '', customer: '', assembly: '' };
  const suvChoice = vanlabSuvSelect.hidden ? null : (vanlabSuvSelect.value || null);
  const res = PackingMap.resolve(vanKey, order.assembly, suvChoice);

  if (res.status === 'ambiguous') {
    vanlabSuvSelect.hidden = false;
    vanlabSuvLabel.hidden = false;
    vanlabSetStatus('This SUV order doesn\'t say which kit — pick Full/Bed/Kitchen, then click Packing list again.', true);
    return;
  }
  if (res.status === 'none_needed') {
    vanlabSetStatus(`No packing list for van ${vanKey} — ${res.reason}. Nothing to print (that's expected).`);
    return;
  }
  if (res.status === 'missing') {
    vanlabSetStatus(`NEEDS ATTENTION — can't print a packing list: ${res.reason}`, true);
    return;
  }

  vanlabPackingBtn.disabled = true;
  vanlabSetStatus(`Fetching the packing list for van ${vanKey}…`);
  // Tracks which stage we're in so the catch below can report honestly:
  // 'fetch' covers the network round-trip, 'stamp' covers decoding the
  // base64 template and running it through pdf-lib, which fails
  // differently (corrupt/protected PDF, not a network problem).
  let stage = 'fetch';
  try {
    const idToken = await Auth.getIdToken();
    if (ep !== vanlabEpoch) return;
    const b64 = await Endpoint.getPackingPdf(res.file, idToken);
    if (ep !== vanlabEpoch) return;
    if (!b64) {
      vanlabSetStatus('Packing-list fetch is not configured on this copy.', true);
      return;
    }
    stage = 'stamp';
    const template = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    vanlabSetStatus('Stamping the packing list…');
    const bytes = await PackingPdf.stampPdf(template, order);
    if (ep !== vanlabEpoch) return;
    if (vanlabPackingBlobUrl) URL.revokeObjectURL(vanlabPackingBlobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    vanlabPackingBlobUrl = url;
    if (!window.open(url)) {
      vanlabSetStatus('Popup blocked — allow popups for this site, then click Packing list again.', true);
      return;
    }
    vanlabMarkPrinted('packing', jobName);
    vanlabSetStatus(`Packing list${order.orderNum ? ' for order ' + order.orderNum : ''} ready — print the opened PDF on the shop-floor letter printer at 100% scale.`);
  } catch (err) {
    if (stage === 'fetch') {
      const why = err.endpointError ? err.message : 'network problem — is the internet up?';
      vanlabSetStatus(`Couldn't fetch the packing list — ${why}`, true);
    } else {
      vanlabSetStatus(`Couldn't stamp the packing list — the template PDF may be corrupt or protected — ${err.message}`, true);
    }
  } finally {
    if (ep === vanlabEpoch) vanlabPackingBtn.disabled = false;
  }
}

function vanlabToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + '/' + d.getFullYear();
}

async function vanlabPrintCrate() {
  const ep = vanlabEpoch;
  const jobName = currentProject;
  let order;
  if (vanlabOrder) {
    if (!vanlabOrder.vanRaw && !vanlabOrder.vanKey) {
      vanlabSetStatus(`The Order Log row for order ${vanlabOrder.orderNum} has no van type yet — fill it in on the Order Log, then reopen this job.`, true);
      return;
    }
    order = {
      orderNum: vanlabOrder.orderNum || '',
      vanName: vanlabOrder.vanRaw || ('Van ' + vanlabOrder.vanKey),
      assembly: vanlabOrder.assembly || '',
      customer: vanlabOrder.customer || '',
      datePacked: vanlabToday(),
    };
  } else {
    const orderNum = vanlabManualOrder.value.trim();
    if (!orderNum) {
      vanlabSetStatus('Type the order number first — the crate label prints it and encodes it in the QR.', true);
      return;
    }
    order = {
      orderNum,
      vanName: 'Van ' + vanlabVanSelect.value,
      assembly: vanlabManualAssembly.value.trim(),
      customer: vanlabManualCustomer.value.trim(),
      datePacked: vanlabToday(),
    };
  }
  vanlabCrateBtn.disabled = true;
  vanlabSetStatus('Building the crate label…');
  try {
    let logoBytes = null;
    try {
      logoBytes = Uint8Array.from(atob(VanlabLogo.pngBase64), (c) => c.charCodeAt(0));
    } catch {
      // buildCrateLabelPdf falls back to its placeholder box; the label
      // must never fail to print over the logo.
    }
    const bytes = await CrateLabelPdf.buildCrateLabelPdf(order, logoBytes);
    if (vanlabCrateBlobUrl) URL.revokeObjectURL(vanlabCrateBlobUrl);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    vanlabCrateBlobUrl = url;
    if (!window.open(url, '_blank')) {
      vanlabSetStatus('Popup blocked — allow popups for this site, then click Crate label again.', true);
      return;
    }
    vanlabMarkPrinted('crate', jobName);
    vanlabSetStatus(`Crate label for order ${order.orderNum} ready — print the opened PDF on the CRATE LABEL 4x6 printer at 100% scale.`);
  } catch (err) {
    vanlabSetStatus(`Couldn't build the crate label — ${err.message}`, true);
  } finally {
    if (ep === vanlabEpoch) vanlabCrateBtn.disabled = false;
  }
}

vanlabHeaderBtn.addEventListener('click', vanlabOpenPanel);
vanlabPrintBtn.addEventListener('click', vanlabPrintStickers);
vanlabPackingBtn.addEventListener('click', vanlabPrintPacking);
vanlabCrateBtn.addEventListener('click', vanlabPrintCrate);
vanlabActions.addEventListener('click', (e) => {
  const undo = e.target.closest('.vanlab-undo');
  if (undo) vanlabUndoPrinted(undo.dataset.kind);
});
document.getElementById('vanlab-show-btn').addEventListener('click', () => { vanlabExpanded = true; vanlabRenderPrinted(); });

/* ══════════════════════════════════════════
   Print Queue — the "To Print" panel (projects screen)
   Spec: docs/superpowers/specs/2026-09-10-print-queue-design.md
══════════════════════════════════════════ */
const printQueueBtn         = document.getElementById('print-queue-btn');
const printQueuePanel       = document.getElementById('print-queue-panel');
const printQueueStatus      = document.getElementById('print-queue-status');
const printQueueList        = document.getElementById('print-queue-list');
const printQueueShowPrinted = document.getElementById('print-queue-show-printed');
const printQueueUndo     = document.getElementById('print-queue-undo');
const printQueueClearOld = document.getElementById('print-queue-clear-old');
const pqMainPanel = { statusEl: printQueueStatus, undoBtn: printQueueUndo, undoId: null, render: () => renderPrintLists() };   // undoId: item the head-row Undo reverts; any other status change clears it
let pqLastBlobUrl = null;   // last queue-PDF object URL, revoked before a new one

// Page size / font ceiling / printer name per sticker size (spec § PDF rendering).
const PQ_SIZES = {
  '3x1':    { width: 3 * 72, height: 1 * 72, startSize: 60,  printer: 'STICKERS 1x3' },
  '4x6':    { width: 4 * 72, height: 6 * 72, startSize: 140, printer: 'CRATE LABEL 4x6' },
  'letter': { printer: 'letter printer' },   // documents only — never rendered by buildStickerPdf
};

// Firebase only gives us the sign-in email. Map the two operators to the
// names they go by; anything else falls back to the part before the @.
// Keyed on the LOCAL PART (before the @), not the whole address: this repo is
// public and app.js is served from Pages, so full addresses here would be
// harvestable. The local part alone isn't a deliverable address.
const PQ_DISPLAY_NAMES = {
  'huffman44': 'Travis',
  '777litch777': 'Collin',
};
function pqDisplayName(email) {
  if (!email) return 'Someone';
  const local = String(email).split('@')[0].toLowerCase();
  return PQ_DISPLAY_NAMES[local] || local;
}

// A panel is one status line + head-row Undo + a re-render; the To Print panel is
// pqMainPanel, and the print/mark helpers take the panel so another can reuse them.
function pqSetStatus(panel, text, isError) {
  panel.statusEl.textContent = text;
  panel.statusEl.classList.toggle('vanlab-status-error', !!isError);
  panel.undoId = null;
  panel.undoBtn.hidden = true;
}

function pqShowUndo(panel, id) {
  panel.undoId = id;
  panel.undoBtn.disabled = false;   // a previous Undo click leaves it disabled
  panel.undoBtn.hidden = false;
}

function pqWhat(item) {
  return item.kind === 'document' ? (item.fileName || 'document') : Sequence.rangeLabel(item.lines);
}

function pqTitle(item) {
  const label = item.lines.length === 1 ? item.lines[0] : `${item.lines[0]}-${item.lines[item.lines.length - 1]}`;
  const count = item.lines.length;
  return `${label} · ${item.size} · ${count} sticker${count !== 1 ? 's' : ''}`;
}

function renderPrintLists() { renderPrintQueue(); renderJobStickers(); }

function renderPrintQueue() {
  const open = Storage.getPrintQueue();
  printQueueBtn.textContent = open.length ? `To Print (${open.length})` : 'To Print';
  // Bright orange while anything is waiting — the badge is the whole notification system.
  printQueueBtn.classList.toggle('print-queue-btn--pending', open.length > 0);
  if (printQueuePanel.hidden) return;

  const showPrinted = printQueueShowPrinted.checked;
  printQueueClearOld.hidden = !showPrinted;
  const items = showPrinted ? Storage.getPrintedItems() : open;
  if (!items.length) {
    printQueueList.innerHTML = `<div class="print-queue-empty">${showPrinted ? `Nothing printed in the last ${Storage.PRINT_RETENTION_DAYS} days.` : 'Nothing waiting to print.'}</div>`;
    return;
  }
  printQueueList.innerHTML = pqRowsHtml(items);
}

// One row template for every sticker list (To Print and the job panel).
function pqRowsHtml(items) {
  return items.map(item => {
    const spec = PQ_SIZES[item.size];
    const isDoc = item.kind === 'document';
    const count = isDoc ? (item.pages || 0) : item.lines.length;
    const unit = isDoc ? 'page' : 'sticker';
    const countText = `${count} ${unit}${count !== 1 ? 's' : ''}`;
    const what = isDoc ? (item.fileName || 'document') : Sequence.rangeLabel(item.lines);
    const when = item.createdAt ? formatDT(new Date(item.createdAt)) : '';
    const printedNote = item.printedAt ? ` · printed ${formatDT(new Date(item.printedAt))}` : '';
    return `
      <div class="pq-row" data-id="${escHtml(item.id)}">
        <div class="pq-row-main">
          <span class="pq-row-what">${escHtml(what)}</span>
          <span class="pq-row-meta">${countText} · ${escHtml(item.size)}${item.jobName ? ' · ' + escHtml(item.jobName) : ''} · ${escHtml(pqDisplayName(item.createdBy))} · ${escHtml(when)}${printedNote}</span>
        </div>
        <div class="pq-row-actions">
          <div>
            <button class="btn btn-primary btn-sm" data-action="print">Print ${countText} → ${escHtml(spec ? spec.printer : item.size)}</button>
            <div class="pq-row-hint">100% scale · margins none</div>
          </div>
          ${item.printedAt
            ? '<button class="btn btn-ghost btn-sm" data-action="unprint">Undo printed</button><button class="btn btn-ghost btn-sm pq-row-delete" data-action="delete">Delete</button>'
            : ''}
        </div>
      </div>`;
  }).join('');
}

async function pqPrint(panel, item, button) {
  if (item.kind === 'document') return pqPrintDocument(panel, item, button);
  const spec = PQ_SIZES[item.size];
  if (!spec) { pqSetStatus(panel, `Can't print: unknown size ${item.size}.`, true); return; }
  button.disabled = true;
  pqSetStatus(panel, 'Building the sticker PDF…');
  try {
    const texts = {};
    const items = item.lines.map((line, i) => { texts[i] = line; return [i, 1]; });
    const bytes = await StickerPdf.buildStickerPdf(items, texts, await loadBalooFont(),
      { width: spec.width, height: spec.height, startSize: spec.startSize, title: pqTitle(item) });
    if (pqLastBlobUrl) URL.revokeObjectURL(pqLastBlobUrl);
    pqLastBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (!window.open(pqLastBlobUrl, '_blank')) {
      pqSetStatus(panel, 'Popup blocked — allow popups for this site, then click Print again.', true);
      return;
    }
    await pqAfterOpen(panel, item, `${item.lines.length} stickers ready — print the opened PDF on the ${spec.printer} printer at 100% scale.`);
  } catch (err) {
    pqSetStatus(panel, `Couldn't build the sticker PDF — ${err.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function pqPrintDocument(panel, item, button) {
  const spec = PQ_SIZES[item.size];
  const name = item.fileName || 'document';
  button.disabled = true;
  pqSetStatus(panel, `Fetching ${name}…`);
  try {
    if (!Endpoint.enabled()) throw new Error('endpoint not configured');
    const idToken = await Auth.getIdToken();
    const b64 = await Endpoint.getDoc(item.fileId, idToken);
    if (!b64) throw new Error('endpoint not configured');
    let bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // Wrong-printer guard: re-title so Chrome's tab and print dialog name the
    // size. Best-effort — if pdf-lib can't re-open the file, print it untitled.
    try {
      const doc = await PDFLib.PDFDocument.load(bytes);
      doc.setTitle(DocInfo.title(name, item.size, item.pages || doc.getPageCount()));
      bytes = await doc.save({ useObjectStreams: false });
    } catch (_) { /* open untitled */ }
    if (pqLastBlobUrl) URL.revokeObjectURL(pqLastBlobUrl);
    pqLastBlobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    if (!window.open(pqLastBlobUrl, '_blank')) {
      pqSetStatus(panel, 'Popup blocked — allow popups for this site, then click Print again.', true);
      return;
    }
    await pqAfterOpen(panel, item, `${name} ready — print the opened PDF on the ${spec ? spec.printer : item.size} at 100% scale.`);
  } catch (err) {
    // Row stays in the list; the real reason is the message.
    pqSetStatus(panel, `Couldn't fetch ${name} — ${err.message}. Try again.`, true);
  } finally {
    button.disabled = false;
  }
}

// After the PDF window opened: a waiting item is marked printed (Undo offered);
// an already-printed one (Print again) is left alone.
async function pqAfterOpen(panel, item, readyText) {
  // The printer hint shows now — not only once the database answers (slow shop Wi-Fi).
  pqSetStatus(panel, readyText);
  // Re-read the cache: another PC may have marked or deleted it while the PDF was built.
  if (!Storage.getPrintQueue().some(i => i.id === item.id)) return;
  try {
    await Storage.markPrinted(item.id);
  } catch (err) {
    // Row stays waiting; the PDF did open.
    pqSetStatus(panel, `Printed, but couldn't mark it printed — ${err.message}.`, true);
    return;
  }
  pqSetStatus(panel, `${readyText} Marked printed.`);
  pqShowUndo(panel, item.id);
  panel.render();
}

async function pqUnmarkPrinted(panel, id, button) {
  button.disabled = true;
  const item = [...Storage.getPrintQueue(), ...Storage.getPrintedItems()].find(i => i.id === id);
  try {
    await Storage.unmarkPrinted(id);
    pqSetStatus(panel, `${item ? pqWhat(item) : 'Item'} is back in the queue.`);
    panel.render();
  } catch (err) {
    pqSetStatus(panel, `Couldn't undo — ${err.message}. Try again.`, true);
    button.disabled = false;
  }
}

async function pqDelete(panel, item, button) {
  // Irreversible. confirm() is the repo's destructive-action pattern; if Chrome
  // has suppressed dialogs for the site it returns false and nothing happens.
  const printed = item.printedAt ? `, printed ${formatDT(new Date(item.printedAt))}` : '';
  const drive = item.kind === 'document' ? ' The PDF itself stays in the CNC Print Queue Drive folder.' : '';
  if (!confirm(`Delete "${pqWhat(item)}"${printed}? This removes it for everyone and can't be undone.${drive}`)) return;
  button.disabled = true;
  try {
    await Storage.deletePrintItem(item.id);
    pqSetStatus(panel, `${pqWhat(item)} deleted.`);
    panel.render();
  } catch (err) {
    pqSetStatus(panel, `Couldn't delete — ${err.message}. Try again.`, true);
    button.disabled = false;
  }
}

async function pqClearOld() {
  const days = Storage.PRINT_RETENTION_DAYS;
  const cutoff = Storage.printRetentionCutoff();
  printQueueClearOld.disabled = true;
  try {
    pqSetStatus(pqMainPanel, 'Counting…');
    const n = await Storage.countPrintedBefore(cutoff);
    if (!n) { pqSetStatus(pqMainPanel, `Nothing printed more than ${days} days ago.`); return; }
    if (!confirm(`Permanently delete ${n} printed item${n !== 1 ? 's' : ''} older than ${days} days? They aren't shown in this list and can't be recovered.`)) {
      pqSetStatus(pqMainPanel, '');
      return;
    }
    const deleted = await Storage.clearPrintedBefore(cutoff);
    pqSetStatus(pqMainPanel, `Deleted ${deleted} printed item${deleted !== 1 ? 's' : ''}.`);
    renderPrintLists();
  } catch (err) {
    pqSetStatus(pqMainPanel, `Couldn't clear — ${err.message}. Try again.`, true);
  } finally {
    printQueueClearOld.disabled = false;
  }
}

function pqOnRowClick(panel, e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.closest('.pq-row').dataset.id;
  const item = [...Storage.getPrintQueue(), ...Storage.getPrintedItems()].find(i => i.id === id);
  if (!item) return;
  if (btn.dataset.action === 'print') pqPrint(panel, item, btn);
  if (btn.dataset.action === 'unprint') pqUnmarkPrinted(panel, item.id, btn);
  if (btn.dataset.action === 'delete')  pqDelete(panel, item, btn);
}
printQueueList.addEventListener('click', e => pqOnRowClick(pqMainPanel, e));

printQueueBtn.addEventListener('click', () => {
  printQueuePanel.hidden = !printQueuePanel.hidden;
  pqSetStatus(pqMainPanel, '');
  renderPrintQueue();
});

printQueueShowPrinted.addEventListener('change', renderPrintQueue);
printQueueUndo.addEventListener('click', () => { if (pqMainPanel.undoId) pqUnmarkPrinted(pqMainPanel, pqMainPanel.undoId, printQueueUndo); });
printQueueClearOld.addEventListener('click', pqClearOld);

/* ── Builder: + New batch ── */
const pqBuilder = document.getElementById('pq-builder');
const pqLines   = document.getElementById('pq-lines');
const pqPrefix  = document.getElementById('pq-prefix');
const pqStart   = document.getElementById('pq-start');
const pqEnd     = document.getElementById('pq-end');
const pqError   = document.getElementById('pq-error');
const pqFillBtn = document.getElementById('pq-fill-btn');
const pqSendBtn = document.getElementById('pq-send-btn');

function pqShowError(msg) {
  pqError.textContent = msg;
  pqError.hidden = !msg;
}

// Shared by To Print and the job panel: append a generated range to a textarea.
function pqFillInto(textarea, prefixEl, startEl, endEl, showError) {
  try {
    const lines = Sequence.generateSequence(prefixEl.value, startEl.value, endEl.value);
    const existing = textarea.value.replace(/\s+$/, '');
    textarea.value = (existing ? existing + '\n' : '') + lines.join('\n');
    showError('');
    textarea.scrollTop = textarea.scrollHeight;
  } catch (err) {
    showError(err.message);
  }
}

function pqFill() { pqFillInto(pqLines, pqPrefix, pqStart, pqEnd, pqShowError); }

// The message for a bad batch (empty or over the limit), or '' when it is fine.
function pqLinesError(lines) {
  if (!lines.length) return 'Type at least one sticker line, or fill a range first.';
  if (lines.length > Sequence.MAX_ITEMS) return `That's ${lines.length} stickers — the limit is ${Sequence.MAX_ITEMS} per batch.`;
  return '';
}

function pqCurrentEmail() {
  // Only trust firebase.auth() once an app has actually been initialized —
  // in PASTE mode the compat SDK loads from the CDN (so firebase.auth is a
  // real function) but initApp() never calls firebase.initializeApp(), and
  // calling firebase.auth() with no app throws synchronously.
  const app = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
  const user = app ? app.auth().currentUser : null;
  return user ? user.email : '';
}

async function pqSend() {
  const lines = Sequence.parseLines(pqLines.value);
  const bad = pqLinesError(lines);
  if (bad) { pqShowError(bad); return; }
  const size = document.querySelector('input[name="pq-size"]:checked').value;
  pqSendBtn.disabled = true;
  try {
    // Nothing is written until here — the textarea is the only draft state,
    // so Collin never sees a batch appear one line at a time.
    await Storage.addPrintItem({ kind: 'stickers', lines, size, jobName: null, createdBy: pqCurrentEmail() });
    pqLines.value = '';
    pqShowError('');
    pqBuilder.open = false;
    pqSetStatus(pqMainPanel, `${lines.length} sticker${lines.length !== 1 ? 's' : ''} sent to the print list.`);
    renderPrintLists();
  } catch (err) {
    // Firestore rejected (rules missing, offline…): nothing was cached, so
    // the list is untouched. Say why.
    pqShowError(`Couldn't send — ${err.message}`);
  } finally {
    pqSendBtn.disabled = false;
  }
}

pqFillBtn.addEventListener('click', pqFill);
pqSendBtn.addEventListener('click', pqSend);
[pqPrefix, pqStart, pqEnd].forEach(el => el.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); pqFill(); }
}));

/* ── Job screen: Stickers button + panel (this job's batches) ── */
const jobStickersBtn     = document.getElementById('job-stickers-btn');
const jobStickersPanel   = document.getElementById('job-stickers-panel');
const jobStickersList    = document.getElementById('job-stickers-list');
const jobStickersPrinted = document.getElementById('job-stickers-printed-list');
const jsPanel = { statusEl: document.getElementById('job-stickers-status'), undoBtn: document.getElementById('job-stickers-undo'), undoId: null, render: () => renderPrintLists() };
let jsPanelJob = null;   // the job the panel (and its unsaved draft) belongs to; showContentScreen closes it when another job shows

function renderJobStickers() {
  if (!currentProject) return;
  const all = [...Storage.getPrintQueue(), ...Storage.getPrintedItems()];
  const n = JobStickers.waitingCount(all, currentProject);
  jobStickersBtn.textContent = n ? `Stickers (${n})` : 'Stickers';
  jobStickersBtn.classList.toggle('print-queue-btn--pending', n > 0);
  if (jobStickersPanel.hidden) return;
  const mine = JobStickers.ordered(JobStickers.forJob(all, currentProject));
  const waiting = mine.filter(i => i.printedAt == null);
  const printed = mine.filter(i => i.printedAt != null);
  jobStickersList.innerHTML = waiting.length
    ? pqRowsHtml(waiting) : '<div class="print-queue-empty">No stickers waiting for this job.</div>';
  jobStickersPrinted.innerHTML = printed.length
    ? pqRowsHtml(printed) : '<div class="print-queue-empty">Nothing printed for this job in the last 30 days.</div>';
}

jobStickersBtn.addEventListener('click', () => {
  jobStickersPanel.hidden = !jobStickersPanel.hidden;
  // A draft typed for another job must never be one click from saving under this one.
  if (jsPanelJob !== currentProject) {
    [jsLines, jsPrefix, jsStart, jsEnd].forEach(el => { el.value = ''; });
    jsShowError('');
  }
  jsPanelJob = currentProject;
  pqSetStatus(jsPanel, '');
  renderJobStickers();
});
jobStickersList.addEventListener('click', e => pqOnRowClick(jsPanel, e));
jobStickersPrinted.addEventListener('click', e => pqOnRowClick(jsPanel, e));
jsPanel.undoBtn.addEventListener('click', () => { if (jsPanel.undoId) pqUnmarkPrinted(jsPanel, jsPanel.undoId, jsPanel.undoBtn); });

const jsLines   = document.getElementById('js-lines');
const jsPrefix  = document.getElementById('js-prefix');
const jsStart   = document.getElementById('js-start');
const jsEnd     = document.getElementById('js-end');
const jsError   = document.getElementById('js-error');
const jsSaveBtn = document.getElementById('js-save-btn');

function jsShowError(msg) {
  jsError.textContent = msg;
  jsError.hidden = !msg;
}

async function jsSave() {
  const lines = Sequence.parseLines(jsLines.value);
  const bad = pqLinesError(lines);
  if (bad) { jsShowError(bad); return; }
  const size = document.querySelector('input[name="js-size"]:checked').value;
  const jobName = currentProject;   // snapshot before the await
  jsSaveBtn.disabled = true;
  try {
    await Storage.addPrintItem({ kind: 'stickers', lines, size, jobName, createdBy: pqCurrentEmail() });
    renderPrintLists();
    if (currentProject !== jobName) return;   // moved to another job meanwhile — its box and status aren't ours
    jsLines.value = '';
    jsShowError('');
    pqSetStatus(jsPanel, `${lines.length} sticker${lines.length !== 1 ? 's' : ''} saved to this job.`);
  } catch (err) {
    jsShowError(`Couldn't save — ${err.message}`);
  } finally {
    jsSaveBtn.disabled = false;
  }
}

document.getElementById('js-fill-btn').addEventListener('click', () => pqFillInto(jsLines, jsPrefix, jsStart, jsEnd, jsShowError));
jsSaveBtn.addEventListener('click', jsSave);
[jsPrefix, jsStart, jsEnd].forEach(el => el.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); pqFillInto(jsLines, jsPrefix, jsStart, jsEnd, jsShowError); }
}));

/* ── Builder: + Send a document ── */
const pqDocBuilder = document.getElementById('pq-doc-builder');
const pqFile       = document.getElementById('pq-file');
const pqDocStaged  = document.getElementById('pq-doc-staged');
const pqDocLabel   = document.getElementById('pq-doc-label');
const pqDocClear   = document.getElementById('pq-doc-clear');
const pqDocSize    = document.getElementById('pq-doc-size');
const pqDocError   = document.getElementById('pq-doc-error');
const pqDocSendBtn = document.getElementById('pq-doc-send-btn');
const PQ_DOC_MAX_BYTES = 10 * 1024 * 1024;
let pqDoc = null;   // staged { file, bytes, pages, size } — nothing uploads until Send
let pqDocSending = false;   // true while pqDocSend is awaiting; blocks drops/Clear from racing it
let pqStageSeq = 0;   // bumped on every pqStageFile call; lets the latest drop win over a stale one

function pqDocShowError(msg) {
  pqDocError.textContent = msg;
  pqDocError.hidden = !msg;
}

function pqDocPickedSize() {
  const r = document.querySelector('input[name="pq-doc-size"]:checked');
  return r ? r.value : null;
}

function pqDocRender() {
  if (!pqDoc) {
    pqDocStaged.hidden = true;
    pqDocSize.hidden = true;
    pqDocSendBtn.disabled = true;
    return;
  }
  const size = pqDoc.size || pqDocPickedSize();
  pqDocLabel.textContent = `${pqDoc.file.name} · ${pqDoc.pages} page${pqDoc.pages === 1 ? '' : 's'}${size ? ' · ' + size : ''}`;
  pqDocStaged.hidden = false;
  pqDocSize.hidden = !!pqDoc.size;     // picker only when auto-detect found nothing
  pqDocSendBtn.disabled = !size;
}

function pqDocReset() {
  pqDoc = null;
  pqFile.value = '';
  document.querySelectorAll('input[name="pq-doc-size"]').forEach(r => { r.checked = false; });
  pqDocRender();
}

async function pqStageFile(file) {
  if (pqDocSending) return;
  const my = ++pqStageSeq;
  pqDocShowError('');
  pqDocReset();
  if (!file) return;
  pqDocBuilder.open = true;
  if (file.size > PQ_DOC_MAX_BYTES) {
    pqDocShowError(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is 10 MB.`);
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (my !== pqStageSeq) return;
  if (!DocInfo.isPdf(bytes)) { pqDocShowError("That isn't a PDF."); return; }
  let info;
  try {
    info = await DocInfo.inspectPdf(bytes);
  } catch (_) {
    pqDocShowError(`Couldn't read ${file.name} — is it encrypted?`);
    return;
  }
  if (my !== pqStageSeq) return;
  pqDoc = { file, bytes, pages: info.pages, size: DocInfo.sizeFor(info.width, info.height) };
  pqDocRender();
}

// The bytes are already in memory from staging, so encode those rather than
// re-reading the file. Chunked: String.fromCharCode can't take 10 MB of args.
function pqBytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

async function pqDocSend() {
  if (!pqDoc) return;
  const size = pqDoc.size || pqDocPickedSize();
  if (!size) { pqDocShowError('Pick a size first.'); return; }
  // Snapshot everything before the first await — pqDoc can be replaced or
  // cleared out from under us while this send is in flight (drop/browse/
  // Clear are blocked by pqDocSending below, but this is the actual fix:
  // never re-read module-level pqDoc after control leaves this function).
  const { file, bytes, pages } = pqDoc;
  const name = file.name;
  const base64 = pqBytesToBase64(bytes);
  // Same PASTE-mode guard as pqSend: only touch firebase.auth() once an app exists.
  const app = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
  pqDocSending = true;
  pqDocSendBtn.disabled = true;
  pqDocShowError('');
  pqSetStatus(pqMainPanel, `Uploading ${name}…`);
  try {
    if (!Endpoint.enabled()) throw new Error('endpoint not configured');
    const user = app ? app.auth().currentUser : null;
    const idToken = await Auth.getIdToken();
    const fileId = await Endpoint.uploadDoc(name, base64, idToken);
    if (!fileId) throw new Error('endpoint not configured');
    // Upload first, queue second. If this write fails the file sits unused in
    // the Drive folder — accepted; Travis just sends again.
    await Storage.addPrintItem({ kind: 'document', fileId, fileName: name, pages, size, lines: [], jobName: null, createdBy: user ? user.email : '' });
    pqDocReset();
    pqDocBuilder.open = false;
    pqSetStatus(pqMainPanel, `${name} sent to the print list.`);
    renderPrintLists();
  } catch (err) {
    pqSetStatus(pqMainPanel, '');
    pqDocShowError(`Couldn't send — ${err.message}`);
    pqDocSendBtn.disabled = false;
  } finally {
    pqDocSending = false;
  }
}

// Drops anywhere on the panel stage the file (the disclosure is usually
// collapsed). stopPropagation matters: document.body's drop handler treats
// any file dropped on the Projects screen as a job-sheet upload.
['dragenter', 'dragover'].forEach(ev => printQueuePanel.addEventListener(ev, e => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault();
  e.stopPropagation();
  printQueuePanel.classList.add('pq-drop--over');
}));
printQueuePanel.addEventListener('dragleave', e => {
  if (!printQueuePanel.contains(e.relatedTarget)) printQueuePanel.classList.remove('pq-drop--over');
});
printQueuePanel.addEventListener('drop', e => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  printQueuePanel.classList.remove('pq-drop--over');
  pqStageFile(file);
});
pqFile.addEventListener('change', () => pqStageFile(pqFile.files[0]));
pqDocClear.addEventListener('click', () => { if (pqDocSending) return; pqDocShowError(''); pqDocReset(); });
document.querySelectorAll('input[name="pq-doc-size"]').forEach(r => r.addEventListener('change', pqDocRender));
pqDocSendBtn.addEventListener('click', pqDocSend);

/* ══════════════════════════════════════════
   Owner screens - switches, Settings (customer billing redesign, Phase 1)
   Spec: docs/superpowers/specs/2026-10-04-customer-billing-phase-1-2-design.md
   app.js only gains the hooks to open them; each screen lives in its own file.
══════════════════════════════════════════ */
// PASTE-mode guard (same as pqSend): firebase.auth() throws if no app was initialised.
function currentUserEmail() {
  const app = (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
  const user = app ? app.auth().currentUser : null;
  return user ? (user.email || '') : '';
}

// Nav buttons exist only when the switch for THIS owner is on. For Collin, Features.on() is
// always false, so this is a no-op that leaves the header exactly as today.
function applyFeatureNav() {
  document.getElementById('settings-btn').hidden = !Features.on('settings');
  if (!Features.on('settings') && !settingsScreen.hidden) showProjectsScreen();
  document.getElementById('billing-btn').hidden = !Features.on('billing');
  if (!Features.on('billing') && billingScreens().some(el => !el.hidden)) showProjectsScreen();
  document.getElementById('projects-show-finished-wrap').hidden = !Features.on('jobCard');
  if (!Features.on('jobCard')) { const op = document.getElementById('owner-panel'); op.hidden = true; op.innerHTML = ''; }
  if (!Features.on('jobCard') && (showFinished || viewingFinished)) {
    const wasInside = !contentScreen.hidden;
    resetFinishedView();
    if (wasInside) { currentProject = null; showProjectsScreen(); }
    else if (!projectsScreen.hidden) renderProjects();
  }
}

// Re-paint whatever is on screen after owner data or a switch changes.
function rerenderCurrent() {
  if (!projectsScreen.hidden) renderProjects();
  if (!contentScreen.hidden)  showContentScreen();
  if (!settingsScreen.hidden) SettingsScreen.render();
  const vis = id => { const el = document.getElementById(id); return !!el && !el.hidden; };
  if (vis('billing-screen')) BillingScreen.render();
  if (typeof InvoiceScreen !== 'undefined' && vis('invoice-screen')) InvoiceScreen.render();
  if (typeof BillingDone !== 'undefined' && vis('billing-done-screen')) BillingDone.render();
}

// Billing opens a job on the same job card Collin uses: the active board when the job is on it,
// otherwise the owner's finished view (list handed over by Billing). Back returns to Billing.
function openJobFromBilling(jobName, finishedList) {
  if (sheets.some(s => Keys.jobOf(s) === jobName)) {
    currentProject = jobName; viewingFinished = false;
  } else {
    finishedSheets = finishedList || []; viewingFinished = true; currentProject = jobName;
  }
  cardReturn = 'billing'; setCardBackLabel();
  hideAllScreens();
  vanlabForgetJob();
  showContentScreen();
}

function invoiceScreenOpen() {
  const el = document.getElementById('invoice-screen');
  return typeof InvoiceScreen !== 'undefined' && !!el && !el.hidden;
}

SettingsScreen.init({ hideOthers: hideAllScreens, onBack: showProjectsScreen, currentEmail: currentUserEmail });
JobDetails.init({ currentEmail: currentUserEmail, fillCustomerSelect });
JobCard.init({
  currentEmail: currentUserEmail,
  openEdit: (jobName, jobSheets) => JobDetails.openEdit(jobName, jobSheets),
  onChanged: rerenderCurrent,
  onPutBack: async () => {
    currentProject = null;
    showProjectsScreen();   // clears the finished view; the sheets listener brings the job back onto the board
  },
});
JobCard.setSheetsProvider(() => getDisplaySheets());
BillingScreen.init({
  hideOthers: hideAllScreens, onBack: showProjectsScreen, activeSheets: () => sheets,
  loadFinishedSheets: () => Storage.loadFinishedSheets({ strict: true }),
  compareSheets, openJob: openJobFromBilling, currentEmail: currentUserEmail,
  openInvoice: d => { if (typeof InvoiceScreen !== 'undefined') InvoiceScreen.show(d); },
  invoiceOpen: invoiceScreenOpen,
  onFinishedLoaded: () => { if (invoiceScreenOpen()) InvoiceScreen.render(); },
});
if (typeof BillingDone !== 'undefined') BillingDone.init({ hideOthers: hideAllScreens, onBack: showProjectsScreen });
document.getElementById('billing-btn').addEventListener('click', () => BillingScreen.show());
document.getElementById('projects-show-finished').addEventListener('change', async e => {
  showFinished = e.target.checked;
  if (showFinished) finishedSheets = await Storage.loadFinishedSheets();
  renderProjects();
});
document.getElementById('settings-btn').addEventListener('click', () => SettingsScreen.show());
Features.onChange(() => { applyFeatureNav(); rerenderCurrent(); });

/* ══════════════════════════════════════════
   Helpers
══════════════════════════════════════════ */
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDT(date) {
  return LogRows.formatCompletedTime(date);
}

function localIso(date) {
  const p = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/* ══════════════════════════════════════════
   Firebase Init
══════════════════════════════════════════ */
let dataLoaded = false;

async function loadDataAndShowApp() {
  // Must come first: it decides whether loadSheets()/onSheetsChange use the finished filter.
  await Storage.loadMigrationState();
  const [storedSheets] = await Promise.all([
    Storage.loadSheets(),
    Storage.loadCompletions(),
    Storage.loadNotes(),
    Storage.loadSheetNotes(),
    Storage.loadCustomers(),
    Storage.loadProjectCustomers(),
    Storage.loadAnnotations(),
    Storage.loadPrintQueue(),
  ]);

  sheets = storedSheets;
  newJobs.baseline(storedSheets);
  // Everyone lands on Projects, empty board or not: its header holds To Print, so a sticker
  // queued for Collin is reachable with no jobs loaded (+ Upload Job is one click away).
  showProjectsScreen();

  Storage.onSheetsChange(applySheetsSnapshot);

  Storage.onCompletionChange(() => {
    BillingScreen.render();   // no-op unless Billing is open
    if (invoiceScreenOpen()) InvoiceScreen.render();
    if (!projectsScreen.hidden) renderProjects();
    if (!contentScreen.hidden)  renderAllSheets();
  });

  Storage.onNoteChange(() => {
    if (!projectsScreen.hidden) renderProjects();
    if (!contentScreen.hidden)  updateJobNoteBanner();
  });

  Storage.onSheetNoteChange(() => {
    if (!projectsScreen.hidden) renderProjects();
    if (!contentScreen.hidden)  renderAllSheets();
  });

  Storage.onAnnotationsChange(() => {
    if (!contentScreen.hidden) renderAllSheets();
  });

  Storage.onCustomersChange(() => {
    // The export picker is a modal that reads Storage.getCustomers() fresh
    // each time it opens, so it needs no live re-render here. But the
    // Manage Customers screen can be left open on one device while another
    // device adds/renames/removes a customer, so it does need one.
    if (!customersScreen.hidden) renderCustomersList();
    if (!settingsScreen.hidden) SettingsScreen.render();
  });

  Storage.onPrintQueueChange(() => {
    // Badge count on the To Print button updates everywhere; the list only
    // re-renders while the panel is open (renderPrintQueue checks).
    renderPrintLists();
  });

  renderPrintLists();   // initial badge from the loaded cache

  loadingScreen.classList.add('hidden');
}

// Owner state first: Features decides whether OwnerStore is even asked (Collin's read of
// settings/features is denied by the rules -> operator -> nothing else is loaded).
// Any failure = operator view (all owner screens off); the app must never stick on the loader.
async function loadOwnerStateThen(db, email) {
  try {
    await Features.load(db, email);
    if (Features.isOwner()) {
      OwnerStore.init(db);
      await OwnerStore.loadAll();
      OwnerStore.onChange(rerenderCurrent);
      InvoiceStore.init(db, { getIdToken: () => Auth.getIdToken(), upsertLogRows: Endpoint.upsertLogRows, hasDatabase });
      await InvoiceStore.loadAll();
      InvoiceStore.onChange(rerenderCurrent);
    }
    applyFeatureNav();
  } catch (err) {
    console.warn('Owner state failed to load - continuing as operator:', err);
    try { Features._setForTests(null, ''); } catch (e) { /* ignore */ }   // drop any half-loaded owner state
    try { applyFeatureNav(); } catch (e) { /* ignore */ }
  }
}

async function initApp() {
  try {
    const configured = typeof FIREBASE_CONFIG !== 'undefined'
      && FIREBASE_CONFIG.projectId
      && !FIREBASE_CONFIG.projectId.startsWith('PASTE');

    if (!configured) throw new Error('Firebase config not set');

    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.firestore();
    Storage.init(db);

    Auth.onAuthChange(user => {
      if (!user) {
        showLoginScreen();
        return;
      }
      authBarEmail.textContent = user.email;
      authBar.hidden = false;
      loginScreen.hidden = true;
      if (!dataLoaded) {
        dataLoaded = true;
        loadOwnerStateThen(db, user.email).then(loadDataAndShowApp);
      } else {
        // Signing back in after the session was lost (user went null, login
        // screen shown). A DIFFERENT account may be signing in, and Features /
        // OwnerStore / caches hold the previous account's owner state - reload
        // so everything starts clean (Firebase persists the new session).
        location.reload();
      }
    });

  } catch (err) {
    console.warn('Running without Firebase:', err.message);
    if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
      // Firebase SDK itself failed to load (e.g. flaky CDN) - fail closed
      // rather than dropping the operator onto the ungated upload screen.
      showLoginScreen();
      loginError.textContent = 'Could not load sign-in. Check your connection and reload.';
      loginError.hidden = false;
    } else {
      // Intentional local-testing fallback (FIREBASE_CONFIG.projectId is a
      // "PASTE..." placeholder) - keep degrading open, unchanged.
      loadingScreen.classList.add('hidden');
    }
  }
}

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.hidden = true;
  loginSubmit.disabled = true;
  try {
    await Auth.signIn(loginEmail.value.trim(), loginPassword.value);
    // Auth.onAuthChange's listener (registered in initApp) handles what
    // happens next - nothing else to do here on success.
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  } finally {
    loginSubmit.disabled = false;
  }
});

authBarSignout.addEventListener('click', () => {
  Auth.signOut()
    .then(() => location.reload())
    .catch(err => showSaveBanner('Sign out failed: ' + err.message));
});

initApp();
