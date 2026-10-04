/**
 * js/features.js - which owner screens are switched on for whom (spec section 3, 7.8).
 * The doc settings/features is readable ONLY by owners (Firestore rules). On sign-in the app
 * tries to read it: the operator's read is denied, so state stays null and every owner screen is
 * off by construction, with no email in this file (the repo is public).
 *
 * Unknown = off (controller ruling P22). Firestore compat doc.get() does not reject when the
 * device is offline: it answers from the local cache (snap.metadata.fromCache === true), and a
 * doc that is not cached looks like "does not exist". So a cache-only snapshot, or any failed
 * read, is UNKNOWN: every switch off for this session, nothing is ever written, and even a
 * cached copy of the doc is ignored (one policy, simplest to reason about).
 *
 * The default doc (settings + jobDetails on for the signing-in owner only, so that owner can
 * reach Settings to turn the rest on) is created ONLY inside a transaction that re-reads
 * settings/features and sets it only if it still does not exist; if it exists at commit,
 * what is there is used. Switching a screen off hides it on the next render; it never changes data.
 */
const Features = (() => {
  const SCREENS = [
    { key: 'jobDetails', label: 'Job details at upload' },
    { key: 'jobCard',    label: 'Job card owner panel' },
    { key: 'billing',    label: 'Billing' },
    { key: 'settings',   label: 'Settings' },
  ];
  let db = null;
  let email = '';
  let state = null;          // null = operator or unknown (doc unreadable / not loaded)
  const listeners = [];
  const norm = e => String(e || '').trim().toLowerCase();

  function defaults(ownerEmail) {
    return {
      jobDetails: { on: true,  users: [ownerEmail] },
      jobCard:    { on: false, users: [] },
      billing:    { on: false, users: [] },
      settings:   { on: true,  users: [ownerEmail] },
    };
  }

  function emit() { listeners.forEach(cb => { try { cb(); } catch (e) { console.warn('Features listener threw:', e); } }); }

  async function load(firestore, currentEmail) {
    db = firestore;
    email = norm(currentEmail);
    state = null;
    try {
      const ref = db.collection('settings').doc('features');
      const snap = await ref.get();
      // Cache-only answer = we do not really know. Off, no write.
      if (snap.metadata && snap.metadata.fromCache) return false;
      if (snap.exists) {
        state = snap.data();
      } else {
        // Real server read says the doc is missing: create it, but only if it is still missing.
        state = await db.runTransaction(async tx => {
          const cur = await tx.get(ref);
          if (cur.exists) return cur.data();
          const d = defaults(email);
          tx.set(ref, d);
          return d;
        });
      }
      ref.onSnapshot(s => { if (s.exists) { state = s.data(); emit(); } },
        err => console.warn('Firestore features listener error:', err));
      return true;
    } catch (e) {
      // Operator (permission-denied) or any other failure: stay off, stay silent.
      state = null;
      return false;
    }
  }

  function isOwner() { return state !== null; }

  // Deep copy: the Settings grid reads every column; nothing outside this file mutates state.
  function getState() { return state ? JSON.parse(JSON.stringify(state)) : null; }

  function on(key) {
    const s = state && state[key];
    return !!(s && s.on && Array.isArray(s.users) && s.users.map(norm).includes(email));
  }

  function owners() {
    const set = new Set();
    if (state) Object.values(state).forEach(s => (s && Array.isArray(s.users) ? s.users : []).forEach(u => set.add(norm(u))));
    if (email) set.add(email);
    return [...set].sort();
  }

  // Pure. `on` follows the user list; Settings can never be switched off for the last owner.
  function applySwitch(current, key, userEmail, enabled) {
    if (!SCREENS.some(s => s.key === key)) throw new Error('Unknown screen: ' + key);
    const next = JSON.parse(JSON.stringify(current || {}));
    const sw = next[key] || (next[key] = { on: false, users: [] });
    const users = (sw.users || []).filter(u => norm(u) !== norm(userEmail));
    if (enabled) users.push(norm(userEmail));
    sw.users = users;
    sw.on = users.length > 0;
    if (key === 'settings' && users.length === 0) throw new Error('Settings must stay on for at least one owner.');
    return next;
  }

  async function setSwitch(key, userEmail, enabled) {
    const next = applySwitch(state, key, userEmail, enabled);
    state = next;
    if (db) await db.collection('settings').doc('features').set(next);
    emit();
  }

  function onChange(cb) { listeners.push(cb); }

  function _setForTests(s, e) { state = s; email = norm(e); db = null; }

  return { SCREENS, defaults, load, isOwner, getState, on, owners, applySwitch, setSwitch, onChange, _setForTests };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Features;
