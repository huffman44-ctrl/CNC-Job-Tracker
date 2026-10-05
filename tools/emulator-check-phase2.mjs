// Phase 2 emulator check: the REAL OwnerStore + InvoiceStore running against the REAL
// Phase 2 Firestore rules (HQ worktree jt-billing-phase-2) in the local emulator.
// Not under test/ on purpose (node --test would run it). Run from the HQ worktree:
//   export PATH="/c/Users/Golden Boys/AppData/Local/Programs/jdk-21.0.12.1+1/bin:$PATH"
//   export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Users\\Public\\jtmp"; mkdir -p /c/Users/Public/jtmp
//   npx firebase emulators:exec --only firestore,auth --project cnc-job-tracker "node \"../../../CNC_WebApp/.worktrees/customer-billing-phase-2/tools/emulator-check-phase2.mjs\""
// Fake data only. Emails are parsed from the rules file at run time and never printed.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HQ = process.env.HQ_WORKTREE || 'C:/Users/Golden Boys/Documents/Agemtic Workflows/HQ/.worktrees/jt-billing-phase-2';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const hqRequire = createRequire(path.join(HQ, 'package.json'));
const cncRequire = createRequire(path.join(root, 'package.json'));

function fail(m) { console.error('FAIL: ' + m); process.exitCode = 1; }
function assert(c, m) { if (!c) fail(m); else console.log('PASS: ' + m); }
async function denied(p) { try { await p; return false; } catch { return true; } }
async function threw(p) { try { await p; return null; } catch (e) { return e; } }

async function main() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('REFUSING: FIRESTORE_EMULATOR_HOST is not set — this script only runs inside "firebase emulators:exec"');
    process.exit(1);
  }
  const firebase = hqRequire('firebase/compat/app');
  hqRequire('firebase/compat/auth');
  hqRequire('firebase/compat/firestore');
  const { ensureUserWithUid, seedDoc } = hqRequire('./.verify/auth-helper');

  // Allowlists parsed from the rules, never printed.
  const rules = fs.readFileSync(path.join(HQ, 'firestore.rules'), 'utf8');
  const emailsOf = fn => {
    const m = rules.match(new RegExp(`function ${fn}\\(\\)\\s*\\{\\s*return\\s*(\\[[^\\]]*\\]);`));
    if (!m) throw new Error(`firestore.rules has no ${fn}()`);
    return JSON.parse(m[1].replace(/'/g, '"'));
  };
  const OWNERS = emailsOf('jtOwnerEmails'), OPERATORS = emailsOf('jtOperatorEmails');
  const TRAVIS = OWNERS[0], COLLIN = OPERATORS.find(e => !OWNERS.includes(e));
  const BY = 'owner';

  const [fsHost, fsPort] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const authAddr = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  async function clientFor(name, localId, email) {
    const account = await ensureUserWithUid({ localId, email, password: 'password123' });
    const app = firebase.initializeApp({ projectId: 'cnc-job-tracker', apiKey: 'fake-api-key' }, name);
    const auth = app.auth(); auth.useEmulator('http://' + authAddr, { disableWarnings: true });
    await auth.signInWithEmailAndPassword(account.email || email, 'password123');
    const db = app.firestore(); db.useEmulator(fsHost, Number(fsPort));
    return db;
  }

  // CNC browser modules (IIFE globals + module.exports shim)
  globalThis.Pricing = cncRequire('./js/pricing.js');
  const LogRows = globalThis.LogRows = cncRequire('./js/log-rows.js');
  const OwnerStore = globalThis.OwnerStore = cncRequire('./js/storage-owner.js');
  const InvoiceStore = cncRequire('./js/invoice-store.js');

  // ── fake data ──
  const cut1 = '2026-10-01T16:12:00.000Z', cut2 = '2026-10-02T17:00:00.000Z', cut3 = '2026-10-03T15:00:00.000Z';
  const mkSheet = k => ({ fileKey: k, sheetTitle: 'Sheet ' + k, jobName: 'NL_Bridge_Wall_Panels', totalTime: '00:18:00', toolpaths: [{ name: 'Profile' }], archiveUrl: '' });
  const rowFor = (k, cutAt) => LogRows.build(mkSheet(k), { completedAt: cutAt, operator: 'Collin' }, 'Northlight Studios');
  const priced = n => ({ handling: 10, timeCharge: n, weekendPremium: 0, repeatOf: null, hourlyRate: 80, priceList: 'standard' });
  const sheetDoc = () => ({ status: 'unbilled', invoiceNumber: null, poNumber: null, billedAt: null, cutAtBilled: null, priced: null, cutDateOverride: null, jobKey: null, customerKey: null });
  const jobDoc = () => ({
    jobName: 'NL_Bridge_Wall_Panels', customerKey: 'cust_nl', customerName: 'Northlight Studios',
    material: { kind: 'ours', materialId: 'mat_bb', name: '3/4 in Baltic birch', pricePerSheet: 95, taxable: false },
    turnaround: 'standard', noDesignTime: false, readyForBilling: true, readyAt: 1, readyBy: BY, thicknessIn: 0.75,
    laborLines: [{ id: 'll_1', typeId: 'design', typeName: 'Design', hours: 2, note: 'Layout', status: 'unbilled', invoiceNumber: null, billedAt: null, enteredAt: 1, enteredBy: BY }],
  });
  const customerDoc = name => ({ name, billedOutsideApp: false, priceList: 'standard', defaultMaterialByThickness: {}, notes: '', openInvoice: null });
  const baseJobFp = labor => ({ proj_a: { turnaround: 'standard', materialKind: 'ours', materialId: 'mat_bb', pricePerSheet: 95, readyForBilling: true, labor } });
  const cuts = { s1: cut1, s2: cut2, s3: cut3 };
  const draft = (number, sheetKeys, over = {}) => {
    const perSheet = {}, fsheets = {};
    sheetKeys.forEach(k => { perSheet[k] = { jobKey: 'proj_a', cutAt: cuts[k], cutDate: cuts[k].slice(0, 10), operator: 'Collin', priced: priced(24), row: rowFor(k, cuts[k]) }; fsheets[k] = { completedAt: cuts[k], cutDateOverride: null }; });
    return {
      number, customerKey: 'cust_nl', customerName: 'Northlight Studios', throughDate: '2026-10-04', invoiceDate: '2026-10-05',
      dueDate: null, dueTerm: 'receipt', poNumber: '', sheetKeys, laborLineRefs: [], lines: [], breakdown: {}, total: 480, priceListName: 'Standard',
      settingsSnapshot: { priceList: {}, laborTypes: [], qbItems: [] }, perSheet,
      fingerprint: { sheets: fsheets, jobs: baseJobFp({}) },
      csv: 'a,b', ...over,
    };
  };

  await seedDoc('customerBilling', 'cust_nl', customerDoc('Northlight Studios'));
  await seedDoc('customerBilling', 'cust_hl', customerDoc('Harbor Lane Pictures'));
  for (const k of ['s1', 's2', 's3']) {
    await seedDoc('sheetBilling', k, sheetDoc());
    await seedDoc('completions', k, { status: 'complete', completedAt: cuts[k] });
  }
  await seedDoc('jobBilling', 'proj_a', jobDoc());

  const ownerDb = await clientFor('owner', 'travis-uid-000000000000010', TRAVIS);
  const collinDb = await clientFor('collin', 'collin-uid-000000000000010', COLLIN);
  const rawGet = async (db, col, id) => { const s = await db.collection(col).doc(String(id)).get(); return s.exists ? s.data() : null; };
  const deps = { getIdToken: async () => 'x', upsertLogRows: async () => ({ ok: true }), hasDatabase: () => true, getCompletion: () => null };
  const useDb = db => { OwnerStore._resetForTests(); InvoiceStore._resetForTests(); OwnerStore.init(db); InvoiceStore.init(db, deps); };
  const note = (label, e) => { if (e) console.error('  ' + label + ' error: ' + (e.code || '') + ' ' + e.message); };

  // ── 1. owner: settings seeds, labor line, cut-date override ──
  useDb(ownerDb);
  await OwnerStore.loadAll();
  const seeded = ['laborTypes', 'materials', 'pricing', 'qbItems', 'invoicing'];
  const stored = await Promise.all(seeded.map(n => rawGet(ownerDb, 'settings', n)));
  assert(seeded.every(n => OwnerStore.getSetting(n)) && stored.every(Boolean), 'owner: loadAll seeds the 5 settings docs');
  const ll = OwnerStore.newLaborLine('design', 2, 'Layout', BY);
  const jbErr = await threw(OwnerStore.mutateJobBilling('proj_c', cur => ({ ...cur, laborLines: [...cur.laborLines, ll] }), BY));
  note('mutateJobBilling', jbErr);
  assert(jbErr === null && ((await rawGet(ownerDb, 'jobBilling', 'proj_c')) || {}).laborLines?.length === 1, 'owner: mutateJobBilling adds a labor line (rules accept)');
  const coErr = await threw(OwnerStore.setCutDateOverride('s9', '2026-10-02', { jobKey: 'proj_c', customerKey: 'cust_nl' }, BY));
  note('setCutDateOverride', coErr);
  assert(coErr === null && ((await rawGet(ownerDb, 'sheetBilling', 's9')) || {}).cutDateOverride === '2026-10-02', 'owner: setCutDateOverride works (rules accept)');

  // ── 2. owner: lockAndCreate ──
  const d1 = draft(3801, ['s1', 's2'], { laborLineRefs: [{ jobKey: 'proj_a', lineId: 'll_1' }] });
  d1.fingerprint.jobs = baseJobFp({ ll_1: { typeId: 'design', hours: 2 } });
  const lockErr = await threw(InvoiceStore.lockAndCreate(d1, BY));
  note('lock 3801', lockErr);
  const inv1 = await rawGet(ownerDb, 'invoices', 3801);
  assert(lockErr === null && inv1 && inv1.status === 'in-progress', 'owner: lockAndCreate 3801 — rules accept every write in the transaction');
  const sb1 = await rawGet(ownerDb, 'sheetBilling', 's1'), jb1 = await rawGet(ownerDb, 'jobBilling', 'proj_a'), cb1 = await rawGet(ownerDb, 'customerBilling', 'cust_nl');
  assert(sb1.status === 'in-progress' && sb1.invoiceNumber === 3801 && jb1.laborLines[0].status === 'in-progress' && cb1.openInvoice === 3801, 'owner: sheets, labor line and customer.openInvoice written by the lock');

  // ── 3. owner: overlapping lock / number reuse ──
  const e3a = await threw(InvoiceStore.lockAndCreate(draft(3802, ['s2'], { customerKey: 'cust_hl', customerName: 'Harbor Lane Pictures' }), BY));
  assert(e3a && e3a.code === 'sheet-taken', 'owner: second lock on an overlapping sheet -> sheet-taken (got ' + (e3a && e3a.code) + ')');
  const e3b = await threw(InvoiceStore.lockAndCreate(draft(3801, ['s3'], { customerKey: 'cust_hl', customerName: 'Harbor Lane Pictures' }), BY));
  assert(e3b && e3b.code === 'number-used', 'owner: same number -> number-used (got ' + (e3b && e3b.code) + ')');
  assert((await rawGet(ownerDb, 'invoices', 3801)).createdAt === inv1.createdAt, 'owner: refused re-lock left createdAt unchanged');

  // ── 4. owner: markImported, cancel refused, raw total edit denied ──
  const imp = await threw(InvoiceStore.markImported(3801, BY));
  note('markImported', imp);
  const inv1i = await rawGet(ownerDb, 'invoices', 3801);
  assert(imp === null && inv1i.status === 'imported', 'owner: markImported -> invoice imported');
  const sbi1 = await rawGet(ownerDb, 'sheetBilling', 's1'), sbi2 = await rawGet(ownerDb, 'sheetBilling', 's2');
  assert(sbi1.status === 'billed' && sbi2.status === 'billed', 'owner: markImported -> sheets billed');
  assert((await rawGet(ownerDb, 'jobBilling', 'proj_a')).laborLines[0].status === 'billed' && (await rawGet(ownerDb, 'customerBilling', 'cust_nl')).openInvoice === null, 'owner: markImported -> labor line billed, customer.openInvoice cleared');
  const canc = await threw(InvoiceStore.cancel(3801, BY));
  assert(canc && canc.code === 'state', 'owner: cancel of an imported invoice refused (state)');
  assert(await denied(ownerDb.collection('invoices').doc('3801').update({ total: 5 })), 'owner: raw update of an imported invoice total DENIED by rules');

  // ── 5. owner: addPo ──
  const po = await threw(InvoiceStore.addPo(3801, 'PO-77', BY));
  note('addPo', po);
  assert(po === null && (await rawGet(ownerDb, 'invoices', 3801)).poNumber === 'PO-77' && (await rawGet(ownerDb, 'sheetBilling', 's1')).poNumber === 'PO-77', 'owner: addPo allowed (invoice and billed sheets carry the PO)');

  // ── 6. owner: lock, cancel, re-lock with the same number ──
  const l6 = await threw(InvoiceStore.lockAndCreate(draft(3803, ['s3']), BY));
  note('lock 3803', l6);
  const inv3 = await rawGet(ownerDb, 'invoices', 3803);
  assert(l6 === null && inv3 && inv3.status === 'in-progress', 'owner: lockAndCreate 3803 ALLOWED');
  const c6 = await threw(InvoiceStore.cancel(3803, BY));
  note('cancel 3803', c6);
  const inv3c = await rawGet(ownerDb, 'invoices', 3803);
  assert(c6 === null && inv3c.status === 'cancelled' && (await rawGet(ownerDb, 'sheetBilling', 's3')).status === 'unbilled', 'owner: cancel 3803 ALLOWED, sheet back to unbilled');
  const r6 = await threw(InvoiceStore.lockAndCreate(draft(3803, ['s3']), BY));
  note('re-lock 3803', r6);
  const inv3r = await rawGet(ownerDb, 'invoices', 3803);
  assert(r6 === null && inv3r.status === 'in-progress' && inv3r.createdAt === inv3.createdAt && inv3r.createdBy === inv3.createdBy, 'owner: re-lock of cancelled 3803 with the same number ALLOWED, createdAt unchanged');

  // ── 7. Collin: denied everywhere ──
  useDb(collinDb);
  assert(await denied(OwnerStore.mutateSheetBilling('s3', cur => ({ ...cur, cutDateOverride: '2026-10-01' }), 'collin')), 'Collin: OwnerStore.mutateSheetBilling DENIED');
  assert(await denied(InvoiceStore.lockAndCreate(draft(3900, ['s1']), 'collin')), 'Collin: InvoiceStore.lockAndCreate DENIED');
  assert(await denied(collinDb.collection('invoices').doc('3801').get()), 'Collin: raw get of invoices/ DENIED');

  console.log(process.exitCode ? 'SUITE: FAIL' : 'SUITE: PASS');
  process.exit(process.exitCode || 0);
}

main().catch(e => { console.error('FAIL: script error: ' + ((e && e.stack) || e)); process.exit(1); });
