# Final review fixes
1. billing-model.js: row.laborBilledOn (unique ascending invoice numbers of billed/in-progress labor lines, from jb.laborLines, no new read); rowDetail ends "design hours billed on #3612 [and #3620]" when sheets present, no unbilled lines, and laborBilledOn non-empty. "no design hours" and "added after" unchanged.
2. billing.js: model() catch also clears els.recentJobs.
3. pricing.js: comment on `charged` (current-minimum assumption).
TDD: 3 new tests in test/billing-model.test.mjs; RED = laborBilledOn undefined (3 failures); GREEN after change.
npm test: 517 pass, 0 fail. node tools/browser-check-phase2.mjs: SUITE: PASS (no assertion needed rewording).
