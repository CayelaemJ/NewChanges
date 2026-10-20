import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('public/dashboard.html', 'utf8');
const initial = source.slice(source.indexOf('const PORTFOLIO ='), source.indexOf('/* Portfolio measure glossary.'));
const background = source.slice(source.indexOf('async function fetchPortfolioInBackground('), source.indexOf('// month picker'));
const run = (code, context) => vm.runInContext(code, context);
for (const outcome of ['success', 'failure', 'stale']) {
  let resolveRequest, rejectRequest;
  let renders = 0;
  const pending = new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; });
  const context = vm.createContext({
    URLSearchParams, AbortSignal, location: { search: '' }, API_BASE: '', LIVE_REQUEST_SEQ: 1,
    PF_RENDERED: false, PF_SELECTION_INITIALIZED: false, PF_SELECTED_IDS: new Set(),
    document: { getElementById: () => ({ style: { display: '' } }) },
    renderPortfolio: () => { renders++; }, fetch: () => pending,
  });
  run(initial, context);
  assert.equal(run('PORTFOLIO.employers.length', context), 0, 'no initial fixture rows');
  run(background, context);
  const request = run('fetchPortfolioInBackground(1)', context);
  assert.equal(run('PORTFOLIO.loading', context), true);
  assert.equal(run('PORTFOLIO.employers.length', context), 0);
  if (outcome === 'stale') run('LIVE_REQUEST_SEQ=2', context);
  if (outcome === 'failure') rejectRequest(new Error('Network unavailable'));
  else resolveRequest({ ok: true, json: async () => ({ employers: [{ id: 'authorised-employer', name: 'Authorised employer' }], filterContext: { label: 'October 2026' } }) });
  await request;
  if (outcome === 'success') {
    assert.equal(run('PORTFOLIO.employers[0].id', context), 'authorised-employer');
    assert.equal(run('PORTFOLIO.live', context), true);
    assert.equal(renders, 2, 'visible portfolio repaints when response arrives');
  } else {
    assert.equal(run('PORTFOLIO.employers.length', context), 0, 'failure/stale request cannot paint fixtures or old data');
    if (outcome === 'failure') assert.equal(run('PORTFOLIO.error', context), true);
  }
}
console.log('Portfolio loading behaviour passed: pending, success, failure and stale response.');

let options = '';
const current = new Date().toISOString().slice(0, 7);
const select = { querySelectorAll: () => [], insertAdjacentHTML: (_position, html) => { options += html; } };
const periodContext = vm.createContext({
  URLSearchParams, AbortSignal, Date, API_BASE: '', LIVE_REQUEST_SEQ: 1, location: { search: '' },
  document: { getElementById: () => select }, updatePeriodControlTone: () => {},
  hasValue: value => value !== null && value !== undefined && value !== '',
  esc: value => String(value).replaceAll('<', '&lt;'),
  fetch: async () => ({ ok: true, json: async () => [
    { period: current, optimiseScore: null },
    { period: '2999-12', optimiseScore: 90 },
    { period: '<script>', optimiseScore: 80 },
  ] }),
});
run(source.slice(source.indexOf('async function populateMonthSelect('), source.indexOf('function switchPeriod(')), periodContext);
await run("populateMonthSelect('authorised-employer', '', '')", periodContext);
assert.ok(options.includes(current));
assert.ok(options.includes('Score unavailable'), 'missing scores stay unavailable');
assert.ok(!options.includes('Score 0'), 'null is never coerced to a zero score');
assert.ok(!options.includes('2999') && !options.includes('<script>'), 'future and malformed periods are excluded');
console.log('Reporting period behaviour passed: future/invalid months rejected and null score preserved.');

options='';
run('LIVE_REQUEST_SEQ=2',periodContext);
await run("populateMonthSelect('obsolete-employer', '', '', 1)",periodContext);
assert.equal(options,'','obsolete month-picker response cannot overwrite the current employer');
console.log('Reporting period race protection passed.');
