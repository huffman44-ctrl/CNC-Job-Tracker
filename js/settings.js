/**
 * js/settings.js — the Settings screen (spec §7.7). Phase 1 ships three cards: Screens
 * on/off, Customers (billing) and Maintenance. Prices / labor types / QuickBooks /
 * materials cards are Phase 2. Owners only: reached through a header button that exists
 * only when Features.on('settings'). app.js owns navigation; this file owns the cards.
 * Uses app.js's global escHtml / formatDT (resolved at call time, after app.js loads).
 */
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
