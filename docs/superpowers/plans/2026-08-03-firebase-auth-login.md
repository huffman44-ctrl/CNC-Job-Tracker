# Firebase Auth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close CNC_WebApp's wide-open Firestore database behind a two-account Firebase Auth login, deployed in a way that can't lock an operator out mid-shift.

**Architecture:** A thin `js/auth.js` wrapper around the Firebase Auth compat SDK (mirrors the existing `js/endpoint.js`/`js/storage.js` pattern — no DOM knowledge), a new login screen + persistent "Signed in as X · Sign out" bar wired into `js/app.js`'s existing screen-navigation system, and a Firestore rules change pasted into the Firebase Console once both operators have verified they can sign in.

**Tech Stack:** Firebase Authentication (Email/Password provider), Firebase compat SDK v10.12.0 (matches the app's existing Firestore SDK version), vanilla JS, no build step, no framework.

## Global Constraints

- Firestore rules allowlist, verbatim: `request.auth != null && request.auth.token.email in ['huffman44@gmail.com', '777litch777@gmail.com']` — applied to every collection (`sheets/`, `completions/`, `projectNotes/`, `sheetNotes/`, `customers/`, `projectCustomer/`).
- Two accounts only: `huffman44@gmail.com` (Travis), `777litch777@gmail.com` (Collin — two L's).
- `master` deploys live via GitHub Pages the instant it's pushed — no CI/build step in between.
- Never test against production by writing fake data. This feature has no separate staging Firebase project; the staged rollout (Task 5) is itself the live test, safe specifically because Firestore rules stay open (`allow read, write: if true`) until Task 6.
- No custom error-message mapping — surface Firebase Auth's own `err.message` text directly on the login form (spec's explicit call, avoids inventing scope).
- No new Firestore collections, no changes to `js/storage.js`'s data model, no changes to the Operator dropdown (Collin/Travis/Other) in the Mark Complete modal.

---

## Task 1: Create the two Firebase Auth accounts

Manual, Firebase Console only — no repo changes, nothing to commit. Everything downstream (Task 4's live sign-in test, Task 5, Task 6) depends on these existing first.

**Files:** none.

- [ ] **Step 1: Enable the Email/Password provider**

Open the [Firebase Console](https://console.firebase.google.com/), select the `cnc-job-tracker` project → **Authentication** (left sidebar) → **Sign-in method** tab → click **Email/Password** → toggle **Enable** → **Save**. Skip this step if it's already enabled.

- [ ] **Step 2: Add Travis's account**

**Authentication** → **Users** tab → **Add user**. Email: `huffman44@gmail.com`. Password: pick one now (this is what you'll type into the login screen once it's live — a password manager suggestion is fine). Click **Add user**.

- [ ] **Step 3: Add Collin's account**

Same **Add user** flow. Email: `777litch777@gmail.com`. Password: coordinate with Collin on what his should be, or set a temporary one and have him use "Forgot password" on first login. Click **Add user**.

- [ ] **Step 4: Confirm**

The Users list now shows both accounts. Keep this tab open or note the two emails exactly as typed — Task 3's Firestore rules must match them character-for-character (a typo here silently locks out real access later).

---

## Task 2: `js/auth.js` — Firebase Auth wrapper

**Files:**
- Create: `js/auth.js`

**Interfaces:**
- Produces: `Auth.signIn(email, password)` → `Promise` (resolves on success, rejects with a Firebase `Error` carrying a human-readable `.message`), `Auth.signOut()` → `Promise<void>`, `Auth.onAuthChange(callback)` — registers `callback(user)` to fire immediately with current state and again on every change; `user` is `null` when signed out, else a Firebase `User` object (`user.email` is what Task 4 needs).

- [ ] **Step 1: Write the module**

```js
/**
 * Thin wrapper around Firebase Authentication (Email/Password provider).
 * No DOM knowledge - app.js owns all screen/UI wiring. Errors are passed
 * through as Firebase throws them (real .message text like "The password
 * is invalid...") rather than mapped to custom copy - see the design
 * spec's Error handling section for why.
 */
const Auth = (() => {
  function signIn(email, password) {
    return firebase.auth().signInWithEmailAndPassword(email, password);
  }

  function signOut() {
    return firebase.auth().signOut();
  }

  function onAuthChange(callback) {
    firebase.auth().onAuthStateChanged(callback);
  }

  return { signIn, signOut, onAuthChange };
})();
```

- [ ] **Step 2: Syntax-check it**

This repo has no browser-side test harness for Firebase-dependent modules (`firebase` isn't defined outside a real page load) — `js/endpoint.js` is the existing precedent for a thin Firebase/fetch wrapper with no dedicated test file. A syntax check is what's available standalone; real behavior is verified live in Task 4/Task 5.

Run: `node --check js/auth.js`
Expected: no output, exit code 0 (`--check` only parses, it doesn't execute — safe even though `firebase` isn't defined in Node).

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat: add Firebase Auth wrapper module"
```

---

## Task 3: Login screen and signed-in bar — markup & styles

**Files:**
- Modify: `index.html`
- Modify: `css/style.css`

**Interfaces:**
- Consumes: none (pure markup/CSS, no JS logic yet)
- Produces: DOM elements Task 4 wires up — `#login-screen`, `#login-form`, `#login-email`, `#login-password`, `#login-error`, `#login-submit`, `#auth-bar`, `#auth-bar-email`, `#auth-bar-signout`

- [ ] **Step 1: Add the Firebase Auth SDK script tag**

In `index.html`, right after the existing Firestore SDK tag (~line 18):

```html
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
```

- [ ] **Step 2: Add the login screen**

Insert this new screen block right after the existing `LOADING SCREEN` div (~line 39) and before `PROJECTS SCREEN`:

```html
<!-- ══════════════════════════════════
     LOGIN SCREEN
══════════════════════════════════ -->
<div id="login-screen" class="login-screen" hidden>
  <div class="login-card">
    <div class="upload-brand">
      <span class="upload-logo-badge">CNC</span>
      <span class="upload-brand-name">Job Sheet Tracker</span>
    </div>
    <h1>Sign In</h1>
    <form id="login-form" class="modal-form login-form">
      <div class="form-group">
        <label class="form-label" for="login-email">Email</label>
        <input type="email" id="login-email" class="form-input" autocomplete="username" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="login-password">Password</label>
        <input type="password" id="login-password" class="form-input" autocomplete="current-password" required>
      </div>
      <p id="login-error" class="upload-error" hidden></p>
      <button type="submit" class="btn btn-primary login-submit" id="login-submit">Sign In</button>
    </form>
  </div>
</div>
```

A real `<form>` with `type="submit"` and standard `autocomplete` values is deliberate — it's what makes Chrome/Edge's built-in password manager offer to save and autofill credentials, and lets Enter submit the form.

- [ ] **Step 3: Add the screen-independent signed-in bar**

Insert right after the existing `save-banner` div (~line 27), following the same "screen-independent" pattern and its explanatory comment style:

```html
<!-- Screen-independent signed-in indicator: visible on every screen once
     signed in. There's no single shared header across all five screens
     (Ticket History / Manage Customers currently have none at all), so
     this lives outside all of them instead of being duplicated five times. -->
<div id="auth-bar" class="auth-bar" hidden>
  <span id="auth-bar-email" class="auth-bar-email"></span>
  <button type="button" id="auth-bar-signout" class="btn btn-ghost btn-sm">Sign out</button>
</div>
```

- [ ] **Step 4: Add `js/auth.js` to the script list**

Near the bottom of `index.html`, add it before `app.js` (app.js's Task 4 changes will call into it):

```html
<script src="js/storage.js?v=12"></script>
<script src="js/parser.js?v=7"></script>
<script src="js/markup.js?v=4"></script>
<script src="js/auth.js?v=1"></script>
<script src="js/app.js?v=20"></script>
```

(Note the `app.js` version bump from `?v=19` to `?v=20` — Task 4 modifies that file, and this repo's cache-busting convention is bumping the query string on every change, same as `?v=15` below for `style.css`.)

- [ ] **Step 5: Bump the stylesheet version**

```html
<link rel="stylesheet" href="css/style.css?v=15">
```

- [ ] **Step 6: Add the CSS**

Append to `css/style.css` (placement: right after the existing `UPLOAD SCREEN` section ends, before `APP HEADER` — keeps it near its closest visual sibling):

```css
/* ═══════════════════════════════════════════
   LOGIN SCREEN
═══════════════════════════════════════════ */
.login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at 75% 15%, rgba(255,90,31,0.28) 0%, transparent 55%),
    radial-gradient(ellipse at 15% 85%, rgba(6,182,212,0.16) 0%, transparent 55%),
    linear-gradient(155deg, #0b0d10 0%, #181c22 55%, #101317 100%);
}
.login-screen[hidden] { display: none; }

.login-card {
  background: var(--white);
  border-radius: var(--radius-lg);
  padding: 52px 44px;
  width: 100%;
  max-width: 400px;
  text-align: center;
  box-shadow: var(--shadow-lg);
  position: relative;
  overflow: hidden;
}
.login-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5px;
  background: linear-gradient(90deg, var(--orange), var(--cyan));
}
.login-card h1 {
  font-size: 13px;
  font-weight: 700;
  color: var(--gray-400);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  margin-bottom: 28px;
}
.login-form { text-align: left; }
.login-submit { width: 100%; margin-top: 6px; }

/* ── Signed-in bar ──
   Fixed to the viewport, same reasoning as .save-banner: visible
   regardless of which of the five screens is showing. Bottom-right
   (not top-right) specifically to avoid overlapping the existing
   header-right button clusters on the Projects/Content screens. */
.auth-bar {
  position: fixed;
  bottom: 16px; right: 16px;
  z-index: 150;
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(20,24,29,0.9);
  padding: 8px 8px 8px 14px;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.auth-bar[hidden] { display: none; }
.auth-bar-email {
  font-size: 12px;
  color: rgba(255,255,255,0.75);
  white-space: nowrap;
}
```

- [ ] **Step 7: Preview it**

No JS wiring exists yet (that's Task 4), so open `index.html` directly in a browser, open devtools, select the `#login-screen` element, and remove its `hidden` attribute to preview. Confirm: card is centered, brand badge + "Sign In" heading match the upload screen's visual style, both fields and the button render correctly, no layout overflow. Re-add `hidden` when done (or just don't save/commit any devtools-only change — it's not part of the file).

- [ ] **Step 8: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: add login screen and signed-in bar markup/styles"
```

---

## Task 4: Wire authentication into `js/app.js`

**Files:**
- Modify: `js/app.js:52-56` (DOM refs block)
- Modify: `js/app.js:1526-1604` (`initApp`)

**Interfaces:**
- Consumes: `Auth.signIn(email, password)`, `Auth.signOut()`, `Auth.onAuthChange(callback)` (Task 2); `#login-screen`, `#login-form`, `#login-email`, `#login-password`, `#login-error`, `#login-submit`, `#auth-bar`, `#auth-bar-email`, `#auth-bar-signout` (Task 3)
- Produces: `showLoginScreen()` — callable by nothing else in this codebase today, but follows the exact naming convention of `showProjectsScreen()`/`showContentScreen()` for consistency

- [ ] **Step 1: Hoist the loading-screen ref and add the new DOM refs**

`js/app.js:52-56` currently reads:

```js
const uploadScreen        = document.getElementById('upload-screen');
const projectsScreen      = document.getElementById('projects-screen');
const contentScreen       = document.getElementById('content-screen');
const ticketHistoryScreen = document.getElementById('ticket-history-screen');
const customersScreen     = document.getElementById('customers-screen');
```

Replace with:

```js
const loadingScreen       = document.getElementById('loading-screen');
const loginScreen         = document.getElementById('login-screen');
const uploadScreen        = document.getElementById('upload-screen');
const projectsScreen      = document.getElementById('projects-screen');
const contentScreen       = document.getElementById('content-screen');
const ticketHistoryScreen = document.getElementById('ticket-history-screen');
const customersScreen     = document.getElementById('customers-screen');

const loginForm     = document.getElementById('login-form');
const loginEmail    = document.getElementById('login-email');
const loginPassword = document.getElementById('login-password');
const loginError    = document.getElementById('login-error');
const loginSubmit   = document.getElementById('login-submit');

const authBar         = document.getElementById('auth-bar');
const authBarEmail    = document.getElementById('auth-bar-email');
const authBarSignout  = document.getElementById('auth-bar-signout');
```

(`loadingScreen` moves here from its old home as a local `const` inside `initApp()` — Step 3 below removes that local declaration since multiple functions need it now.)

- [ ] **Step 2: Add `showLoginScreen()` next to the other screen-nav functions**

Immediately after the existing `showProjectsScreen()` function (`js/app.js`, in the `Screen Navigation` section):

```js
function showLoginScreen() {
  loadingScreen.classList.add('hidden');
  uploadScreen.hidden        = true;
  projectsScreen.hidden      = true;
  contentScreen.hidden       = true;
  ticketHistoryScreen.hidden = true;
  customersScreen.hidden     = true;
  authBar.hidden              = true;
  loginError.hidden           = true;
  loginForm.reset();
  loginScreen.hidden          = false;
  loginEmail.focus();
}
```

- [ ] **Step 3: Replace `initApp()` and add `loadDataAndShowApp()`**

`js/app.js:1526-1604` (the whole `Firebase Init` section through the trailing `initApp();` call) currently reads:

```js
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
      Storage.loadSheetNotes(),
      Storage.loadCustomers(),
      Storage.loadProjectCustomers(),
      Storage.loadAnnotations(),
    ]);

    if (storedSheets.length > 0) {
      sheets = storedSheets;
      showProjectsScreen();
    }

    Storage.onSheetsChange(newSheets => {
      sheets = newSheets;
      if (!projectsScreen.hidden) renderProjects();
      if (!contentScreen.hidden) {
        const remaining = currentProject
          ? sheets.filter(s => projectKey(s) === currentProject)
          : sheets;
        if (!remaining.length) {
          showProjectsScreen();
          return;
        }
        if (selectedSheetKey && !remaining.some(s => s.fileKey === selectedSheetKey)) {
          selectedSheetKey = null;
        }
        showContentScreen();
      }
    });

    Storage.onCompletionChange(() => {
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
    });

  } catch (err) {
    console.warn('Running without Firebase:', err.message);
  }

  loadingScreen.classList.add('hidden');
}

initApp();
```

Replace with:

```js
let dataLoaded = false;

async function loadDataAndShowApp() {
  const [storedSheets] = await Promise.all([
    Storage.loadSheets(),
    Storage.loadCompletions(),
    Storage.loadNotes(),
    Storage.loadSheetNotes(),
    Storage.loadCustomers(),
    Storage.loadProjectCustomers(),
    Storage.loadAnnotations(),
  ]);

  if (storedSheets.length > 0) {
    sheets = storedSheets;
    showProjectsScreen();
  }

  Storage.onSheetsChange(newSheets => {
    sheets = newSheets;
    if (!projectsScreen.hidden) renderProjects();
    if (!contentScreen.hidden) {
      const remaining = currentProject
        ? sheets.filter(s => projectKey(s) === currentProject)
        : sheets;
      if (!remaining.length) {
        showProjectsScreen();
        return;
      }
      if (selectedSheetKey && !remaining.some(s => s.fileKey === selectedSheetKey)) {
        selectedSheetKey = null;
      }
      showContentScreen();
    }
  });

  Storage.onCompletionChange(() => {
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
  });

  loadingScreen.classList.add('hidden');
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
        loadDataAndShowApp();
      } else {
        // Signing back in mid-session (e.g. Travis -> Collin switch on a
        // shared PC) - data + listeners are already live from the first
        // sign-in, just get back to a sane screen instead of re-registering
        // duplicate Firestore listeners.
        loadingScreen.classList.add('hidden');
        showProjectsScreen();
      }
    });

  } catch (err) {
    console.warn('Running without Firebase:', err.message);
    loadingScreen.classList.add('hidden');
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
  Auth.signOut();
});

initApp();
```

- [ ] **Step 4: Verify against the real Firebase project**

This can't be a `node --test` unit test — it's a live Firebase Auth + DOM integration, and per the Global Constraints this repo has no staging project. It's safe to test against production right now specifically because Firestore rules are still `allow read, write: if true` (Task 6 hasn't happened yet) — a broken login can't lose or corrupt any job data.

Run: `npm run serve`, open the printed local URL in a browser.

Expected:
- Login screen appears (not the projects/upload screen) — confirms unauthenticated visitors no longer see the board by default.
- Entering a wrong password for `huffman44@gmail.com` shows a red error message inline (Firebase's own text) and the form stays usable.
- Entering the real password for `huffman44@gmail.com` (from Task 1) signs in: login screen disappears, the app loads normally (projects or upload screen depending on existing data), and the bottom-right bar shows "huffman44@gmail.com · Sign out".
- Clicking "Sign out" returns to the login screen and the bar disappears.
- Signing in again with `777litch777@gmail.com` works the same way and shows that email in the bar.
- Reloading the page while signed in skips the login screen entirely (confirms `LOCAL` persistence — this is Firebase's default, nothing to configure).

- [ ] **Step 5: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: wire Firebase Auth login into the app"
```

(`index.html`'s version-bump edits from Task 3 Step 4 land in the same commit as this task's `app.js` changes if not already committed — adjust the `git add` list to whatever's actually still unstaged.)

---

## Task 5: Deploy with rules still open, verify both operators

This is the design's staged rollout, step 1 and step 2. **Do not proceed to Task 6 until this is fully confirmed** — that's what prevents a mid-shift lockout.

**Files:** none (deployment + manual verification only).

- [ ] **Step 1: Push to `master`**

Confirm with Travis before pushing — `master` deploys live to GitHub Pages the instant it's pushed, per this repo's own CLAUDE.md warning.

```bash
git push origin master
```

- [ ] **Step 2: Confirm the deploy landed**

Open https://huffman44-ctrl.github.io/CNC-Job-Tracker/ in a private/incognito window (bypasses any cached old version) a minute or two after pushing. Expected: the login screen appears. If it still shows the old upload/projects screen, GitHub Pages hasn't finished deploying yet — wait and refresh.

- [ ] **Step 3: Hard-refresh both shop PCs**

On Travis's computer and the shop-floor computer: hard refresh (Ctrl+Shift+R) the tab that has this app open. This is the exact step that was missed before on this same codebase (see the oversized-sheet fix in the project notes) — a normal refresh can still serve cached JS.

- [ ] **Step 4: Both operators sign in**

Travis signs in with `huffman44@gmail.com` on his machine; Collin signs in with `777litch777@gmail.com` on the shop-floor machine (or his phone). Confirm for each: the app loads normally, the signed-in bar shows the right email, and existing job data is visible exactly as before (rules are still open, so nothing about data access has changed yet).

- [ ] **Step 5: Only proceed once both are confirmed**

If either sign-in fails or looks wrong, stop here and fix it — Firestore rules are still open, so there's no urgency and no data risk. Do not move to Task 6 until both Travis and Collin have each successfully signed in on their own machine.

---

## Task 6: Enforce the Firestore rules

The design's staged rollout, step 3. Only start this once Task 5 is fully confirmed.

**Files:** none (Firebase Console only).

- [ ] **Step 1: Open the rules editor**

Firebase Console → `cnc-job-tracker` project → **Firestore Database** → **Rules** tab.

- [ ] **Step 2: Replace every collection's rule**

Every collection currently reads:

```
allow read, write: if true;
```

Replace each occurrence with (exact allowlist from the Global Constraints section above — copy carefully, a typo here is a real lockout, not a cosmetic bug):

```
allow read, write: if request.auth != null
  && request.auth.token.email in ['huffman44@gmail.com', '777litch777@gmail.com'];
```

Apply to all six collections: `sheets/`, `completions/`, `projectNotes/`, `sheetNotes/`, `customers/`, `projectCustomer/`.

- [ ] **Step 3: Publish**

Click **Publish**. The Console's rules editor flags syntax errors before it lets you publish — resolve any before continuing.

- [ ] **Step 4: Verify enforcement**

Open the live URL in a fresh incognito window (no saved session). Expected: only the login screen appears, no board content loads even briefly. This confirms unauthenticated access is actually blocked, not just hidden by the UI.

- [ ] **Step 5: Re-verify both operators are still working**

Have Travis and Collin each confirm their already-signed-in sessions from Task 5 still work normally (upload, mark complete, export) now that rules are enforced. This is the real end-to-end proof the allowlist emails were typed correctly.

- [ ] **Step 6: Know the rollback**

If anything looks wrong: Firebase Console → Firestore Database → Rules → revert each collection back to `allow read, write: if true;` → Publish. Takes under a minute, immediately unblocks everyone, no deploy needed — buys time to find the real issue without anyone being stuck.

---

## Self-review notes

- **Spec coverage:** Accounts (Task 1) · Firestore rules (Task 6) · Adding/removing an account (documented in the spec itself, not a task — it's a Console-only runbook for later, no code) · App/UI changes (Tasks 2-4) · Rollout sequence (Tasks 5-6, split exactly along the spec's own 3 steps) · Rollback (Task 6 Step 6) · Error handling (Task 4 Step 3's login form handler, using Firebase's own `.message`) · Testing (Task 4 Step 4, Task 5 — both explicitly live-against-prod-but-safe, matching the spec's stated approach, no invented staging project).
- **Not in scope, confirmed excluded:** no third account, no role tiers, no Operator-dropdown changes, no kiosk/read-only view, no automation of the Console steps — none of the tasks above touch any of these.
- **Type/name consistency check:** `Auth.signIn`/`Auth.signOut`/`Auth.onAuthChange` (Task 2) are called with those exact names in Task 4's `initApp`/`loginForm` handler/`authBarSignout` handler. DOM ids `login-form`/`login-email`/`login-password`/`login-error`/`login-submit`/`auth-bar`/`auth-bar-email`/`auth-bar-signout` (Task 3) match the `getElementById` calls in Task 4 Step 1 exactly.
