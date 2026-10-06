# Billing — everything cut goes in, no Done step, jobs reachable from Billing

**Status:** design approved in conversation 2026-10-06 (Travis); implemented 2026-10-06 on branch `billing-auto-include` (plan: ../plans/2026-10-06-billing-auto-include.md). Not merged.
**Builds on:** `2026-10-04-customer-billing-phase-1-2-design.md` (live since 2026-10-05). Only the parts named here change.

## 1. Why

Using the live Billing screen on 2026-10-06 showed two bottlenecks:

1. **Cut sheets wait for "Done".** A job whose owner has not pressed *Done — ready for billing* shows "Cut, but the job is not marked ready yet" and is left out of the total until someone clicks *Add the cut sheets*. For customers who never get design work (Orville) that is one extra click per job, every week, and a missed click quietly pushes the sheets to a later bill.
2. **Design hours are hard to reach.** They are entered on the job card, but Billing has no way to open a job card (only jobs missing details have a button). After Collin exports, the job is off the board, so the path is Projects › *Show finished jobs* › find the job › open it — and once a job's sheets are billed it drops off Billing entirely.

## 2. Goal

For **every job and every customer**:

- Every cut, unbilled sheet within the "Bill work cut through" date is **in the bill by default**. The owner removes things rather than adding them.
- Design/CAM hours go on the **next bill as soon as they are entered** — no Done step.
- Every job on Billing, and every recently finished job, **opens its job card in one click**, and Back returns to Billing.
- A job's design/CAM **minimum is charged once per job**, even when its hours go out on more than one bill.

No price changes. Collin's screens do not change. No Firestore rules change.

## 3. Billing screen

Unchanged: the "Bill work cut through" box (date, *Everything to date*, *Refresh*), the in-progress invoice reminder, *Needs job details*, the Invoice screen, QuickBooks file, *Imported OK* / *Cancel*, Done screen, Recent invoices.

### 3.1 Customer card rows

Every row is **included by default** (today only `ready` and `labor-only` are). Each row keeps one toggle button: **Remove** when included, **Add back** when removed. The *Bill <customer> · $N* button total reflects what is included.

Row states after this change (the `waiting` state is deleted):

| State | When | Label | Toggle switches |
|---|---|---|---|
| `ready` | job has unbilled cut sheets in the date window and none still uncut | **Ready** | the row's sheets and its unbilled labor together |
| `partly` | some sheets cut in the window, some not cut yet | **2 cut sheets, 4 still to cut** | the row's sheets and its unbilled labor together |
| `labor-only` | no billable sheets, but unbilled design/CAM lines | **Design hours only** | the labor |

Row detail line gains the design state: "… · no design hours" or "… · 1.5 h design". For a `labor-only` row whose sheets went out earlier: "Sheets billed on #3612 · 1.5 h Design added after".

### 3.2 Job name is a link

Every row's job name opens that job's card (`openJobFromBilling`, already used by *Needs job details*). It works for jobs on the board and for finished jobs (Billing already loads the finished list).

### 3.3 Recent jobs (new, bottom of Billing, above Recent invoices)

"**Recent jobs** — Finished in the last 30 days. Click one to add design or CAM hours."

One line per job whose sheets were all finished (exported) in the last 30 days (`max(finishedAt)` of its sheets), newest first, owners' non-*billed outside this app* customers only. Each line: job name (link → job card), then "Customer · finished Oct 2 · 6 sheets billed #3612 · 1.5 h design" or "· no design hours". Billing status wording: "N sheets billed #A[, #B]", "N of M sheets billed", or "not billed yet". Built from data Billing already has (finished sheets, `sheetBilling`, `jobBilling.laborLines`); no new reads beyond what Billing loads today.

## 4. Job card (owner panel)

- **Removed:** the *No design time on this job* checkbox, the *Done — ready for billing* button, *Edit — not ready yet*, and the caption "Cut sheets can still go on a weekly bill before this. Design hours wait for this button."
- **Job chip** (job card header and the Projects screen card) becomes billing status instead of *Not sent to billing yet* / *Ready for billing ✓*: **Not billed yet** · **2 of 3 sheets billed** · **Billed · #3612** (several numbers joined with "and"). *Needs job details* stays as it is and wins over these.
- **Each design/CAM line** shows its status: **Goes on the next bill** (unbilled) · **On invoice 3612 (in progress)** · **Billed · #3612**. Delete stays allowed only while unbilled (as today).
- Caption under the hours form: "Hours go on the next bill once you add them. The minimum is charged once per job, even if the hours go out on two bills."
- **Back** returns to Billing when the card was opened from Billing (today it always returns to Projects).

## 5. The minimum, charged once per job (`js/pricing.js`)

Today: per invoice, per job, per labor type, `topUp = max(0, minHours − hours on this invoice)`. Billing a job's hours in two pieces would charge the minimum twice.

New rule — over all of a job's bills, the charge for a labor type is `max(minHours, total hours entered)`:

```
prior     = hours of that job's lines of that type already billed or in progress (real hours, no top-up)
now       = hours of that type on this invoice
charged   = prior > 0 ? max(minHours, prior) : 0          // what earlier bills already charged
thisBill  = max(minHours, prior + now) − charged          // never negative
```

The shortfall/credit stays on the LAST line of that type on this invoice (as today). A line can therefore be billed at **$0.00**; it still appears on the invoice with "(covered by the 1-h minimum)" so the customer sees the hours.

| Entered | 1st bill | 2nd bill | Job total |
|---|---|---|---|
| 0.5 h, then 0.5 h | 1 h $150 | 0 h $0.00 | 1 h $150 |
| 0.5 h, then 2 h | 1 h $150 | 1.5 h $225 | 2.5 h $375 |
| 1.5 h at once | 1.5 h $225 | — | 1.5 h $225 |

Input change: `priceInvoice` takes `priorLaborHours: { [jobKey]: { [typeId]: hours } }`; BillingModel fills it from `jobBilling.laborLines` with status `billed` or `in-progress` on another invoice. Lines billed before this change follow the same formula (their invoices charged `max(min, hours)` once, which is what `charged` assumes). Rush applies to `thisBill` hours, as today.

## 6. Data

- No new fields, no rules change, no migration. `jobBilling.readyForBilling`, `readyAt`, `readyBy`, `noDesignTime` stay on existing docs and are no longer read or written.
- `InvoiceStore` lock re-check of `readyForBilling` (invoice-store.js ~l.102) and the fingerprint's `readyForBilling` (billing-model.js ~l.307) are removed; the labor-line re-checks stay.
- **Rollout effect to check before deploy:** any job that already has unbilled design lines but was never marked Done will show those hours on the next Billing visit. List them (owner console read) and tell Travis before pushing.

## 7. Testing

- `test/pricing.test.mjs`: the three table rows in §5; rush on a split bill; a type with `minHours: 0`; `priorLaborHours` absent = today's behaviour.
- BillingModel tests: every state included by default; `waiting` never produced; labor of a not-Done job is billable; Remove/Add back toggles sheets + labor together; recent-jobs list (30-day window, newest first, outside-app customers excluded, status wording).
- Job card tests: no Done/checkbox; chip wording for the three states; line status wording.
- `tools/browser-check-phase2.mjs` (PASTE mode): replace the Done step with: cut → Billing shows the row included → job-name link opens the card → add hours → Back lands on Billing with a `labor-only` row after the sheets were billed → Recent jobs lists the job. Collin still sees none of it.
- Check a $0.00 labor line imports into QuickBooks (one real test import before relying on it).

## 8. Out of scope

Per-customer defaults, a search box on Billing (Travis chose the list), changing Collin's export, any price change.
