# Firebase Auth Login

## Problem

`js/firebase-config.js` points at the real, shared production Firestore project (`cnc-job-tracker`), and every collection's security rules are currently `allow read, write: if true`. There is no auth code anywhere in the app — no `firebase-auth` SDK, no login screen, no session check in `js/storage.js` or `js/app.js`. Anyone who finds the site URL (or just the Firebase project ID/API key, visible in the page's own source) can read or write the shared job/customer/completions database directly, bypassing the webpage entirely. The Apps Script endpoint's token is explicitly a junk filter, not auth, and doesn't help here.

Two people need access — Travis (enters jobs) and Collin (marks started/finished, runs the CSV export) — on two shared shop-floor computers plus Collin's phone occasionally. Travis wants two separate accounts, not one shared login, so access can be revoked independently and switching users on a shared computer is clean.

## Design

### Accounts

Two Firebase Authentication accounts, Email/Password provider (the app already uses Firebase for Firestore, so no new backend/service):

- `huffman44@gmail.com` — Travis
- `777litch777@gmail.com` — Collin

Created manually in the Firebase Console — not something app code or this repo can automate. Real, checkable email addresses (not placeholders) are used specifically so Firebase's free "forgot password" self-service reset-by-email flow works.

### Firestore rules

Every collection (`sheets/`, `completions/`, `projectNotes/`, `sheetNotes/`, `customers/`, `projectCustomer/`) changes from:

```
allow read, write: if true;
```

to:

```
allow read, write: if request.auth != null
  && request.auth.token.email in ['huffman44@gmail.com', '777litch777@gmail.com'];
```

This locks down both read and write — the current exposure isn't just "anyone can edit," it's "anyone can see the whole job/customer database," so both need to close. Rules are pasted directly into the Firebase Console, same manual pattern already used on this project (they aren't tracked in the repo).

### App/UI changes

- New login screen (email + password) becomes the true first screen the app shows, ahead of the existing "Loading" screen. Unauthenticated visitors see only this — no board, no data.
- `firebase-auth-compat.js` added to `index.html` alongside the existing Firebase scripts.
- A persistent "Signed in as `<email>` · Sign out" control in the main UI (near the dark mode toggle). Sign out returns to the login screen.
- Session persistence uses Firebase Auth's default (`LOCAL`) — signed-in state survives page reloads and browser/computer restarts, since these are dedicated shop-floor machines used for nothing else. The SDK refreshes the underlying token silently in the background; nobody sees or has to do anything for that to keep working. Only an explicit Sign out, a cleared browser storage, an incognito/private window, or a changed password ends the session.
- No changes to `js/storage.js`'s data model, Firestore collection shapes, or the existing Operator dropdown (Collin/Travis/Other) in the Mark Complete modal — that field records who completed a sheet and is unrelated to who's authenticated to use the app.

### Rollout sequence

Chosen specifically to avoid locking an operator out mid-shift on a machine that's picked up stale JS (this app has hit that exact class of bug before — see the oversized-sheet fix in `Brain/Projects/CNC Job Tracker.md`, where the shop PC kept running old code until manually hard-refreshed):

1. **Code deploy.** Push the login screen + auth SDK to `master` (live GitHub Pages deploy) while Firestore rules stay at `allow read, write: if true`. The app behaves exactly as it does today, login screen included, but nothing is enforced yet.
2. **Verify.** Hard-refresh both shop PCs. Travis and Collin each sign in and confirm the app works normally. Because rules are still open at this point, there is zero data-loss risk even if login is broken — this step doubles as the live test; no separate staging Firebase project is needed.
3. **Enforce.** Only once both logins are confirmed working, paste the restrictive rules (above) into the Firebase Console. This is the moment read/write actually starts requiring auth.

### Rollback

If anything breaks after step 3 — a typo in the rules, someone locked out, unexpected app behavior — Travis reverts the Firestore rules back to `allow read, write: if true` directly in the Firebase Console. Under a minute, no deploy needed, immediately unblocks operators while the real issue gets fixed calmly.

## Error handling

- Wrong email/password on the login screen: standard Firebase Auth error surfaced inline on the form (e.g. "Wrong password" / "No account with this email") — no custom error handling needed, the SDK provides this.
- An email that isn't one of the two allowlisted addresses can still create a Firebase Auth session (Auth and Firestore rules are separate systems), but every Firestore read/write will be rejected by the rules once step 3 is live — surfaced to that user as failed loads/saves, not a login failure. Not expected to happen in practice (only two accounts exist, both created by Travis), but worth knowing since the failure mode looks different than a login rejection.
- Signed-out state (session expired/cleared) mid-use: any in-flight Firestore read/write fails with a permission error; the app should return to the login screen rather than sitting on a broken board. Exact detection mechanism (Firebase Auth's `onAuthStateChanged` listener) is an implementation detail for the plan, not a design decision.

## Testing

Per this repo's rules (no framework; never test writes against real Firestore data; `master` deploys live):

1. The existing `PASTE_DISABLED` local-only fallback (`initApp()`, app.js ~line 850) skips Firebase entirely, so it can't exercise real Firebase Auth — not useful for this feature's core path.
2. Instead, testing the login screen *is* the rollout's step 2 (see above): because Firestore rules stay open until step 3, Travis and Collin can sign in against the real Firebase Auth project with zero risk to job data regardless of whether login succeeds, fails, or behaves unexpectedly.
3. Before step 3 (enforcing rules), confirm manually in the Firebase Console: both accounts exist and can sign in; the rules text is valid (Console's rules editor flags syntax errors before publish) and matches the allowlist above exactly (typo-checked against the two real email addresses).
4. After step 3, confirm an incognito/signed-out tab hitting the live URL sees only the login screen and no data loads.

## Not in scope

- Any third account, role-based permissions, or admin/read-only tier — just the two named accounts with full access, per Travis's explicit call.
- Changing the Operator dropdown (Collin/Travis/Other) in the Mark Complete modal — that's unrelated completion-record data, not access control.
- A public/kiosk read-only view — unlike the Kanban board's now-removed `?display=1` mode, this app has no shop-TV display requirement.
- Automating Firebase Auth account creation or rules deployment — both are manual, one-time Console steps.
