// Browser checks against the compiled React dashboard using an isolated synthetic fixture.
// Chromium simulations do not certify WebKit/Safari, native iOS Liquid Glass or Android system UI.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Vite writes the built app into public/react (see frontend/vite.config.ts).
const root = 'public/react';
assert.ok(existsSync(root + '/index.html'), 'Build frontend before dashboard chart audit');
const inventory = [
  'Workforce Financial Wellness Score',
  'Monthly cash freed up',
  'Total advanced per month',
  'From enrolled to better off',
  'Activated employees by income band',
];
const sourceCode = readFileSync('frontend/src/App.tsx', 'utf8');
for (const name of inventory) assert.ok(sourceCode.includes(name), 'Missing registered chart: ' + name);
assert.equal((sourceCode.match(/<LineChart values=/g) || []).length, 2,
  'Line chart inventory changed. Update coverage for each new chart before merging.');

const data = {
  theme: { branded: false },
  wellness: { score: 74, prior: 69, band: 'On track', complete: true,
    drivers: [{ name: 'Income resilience', weight: .5, score: 68 }] },
  kpis: { takeUp: { enrolled: 120, pct: 48 }, monthlySaving: { rand: 45000, trend: [12000, 23000, 45000] },
    activated: { count: 85, pct: 70 }, avgRating: { val: 4.2, responses: 41 } },
  comparison: {
    current: { label: 'Current', savings: [12000, 23000, 45000], savingsLabels: ['Aug', 'Sep', 'Oct'],
      ewa: [1400, 1900, 2200], ewaLabels: ['Aug', 'Sep', 'Oct'], totalAdvancedRaw: 2200 },
    previous: { label: 'Prior', savings: [9000, 14000, 19000], savingsLabels: ['May', 'Jun', 'Jul'],
      ewa: [800, 1200, 1600], ewaLabels: ['May', 'Jun', 'Jul'] },
  },
  funnel: [{ label: 'Registered', sub: 'Synthetic cohort', n: 120, pct: 100 },
    { label: 'Activated', sub: 'Synthetic cohort', n: 85, pct: 71 }],
  income: [{ name: 'Band A', count: 30 }, { name: 'Band B', count: 55 }],
  ewa: { trend: [1400, 1900, 2200], trendLabels: ['Aug', 'Sep', 'Oct'] },
};
const folder = 'test-results/dashboard-charts';
mkdirSync(folder, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  for (const width of [320, 375, 390, 430, 768, 1366]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width, height: 852 }, colorScheme: theme,
      isMobile: width < 768, hasTouch: width < 768, reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'dashboard-ci.test') return route.abort();
      if (u.pathname === '/react/dashboard') return route.fulfill({
        contentType: 'text/html', body: readFileSync(root + '/index.html'),
      });
      if (u.pathname.startsWith('/api/')) {
        const response = u.pathname === '/api/auth/me'
          ? { id: 'ci-user', name: 'Fixture User', role: 'SUPERADMIN',
            employers: [{ id: 'ci-employer', name: 'Synthetic Employer' }], theme: { branded: false } }
          : u.pathname.includes('/dashboard') ? data
          : u.pathname.endsWith('/periods') ? ['2026-10']
          : { pollingEnabled: false };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
      }
      const file = u.pathname.startsWith('/static/') ? 'public/' + u.pathname.slice(8)
        : u.pathname.startsWith('/react/assets/') ? root + u.pathname.slice('/react'.length)
        : null;
      if (file && !file.includes('..') && existsSync(file)) {
        const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css'
          : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
        return route.fulfill({ contentType, body: readFileSync(file) });
      }
      return route.fulfill({ status: 404, body: 'Fixture resource unavailable' });
    });
    const label = width + '-' + theme;
    try {
      await page.goto('http://dashboard-ci.test/react/dashboard', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.wellness-gauge', { timeout: 15000 });
      // Use the actual application theme toggle rather than modifying classes by hand.
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Switch to dark mode' }).click();
        await page.waitForFunction(() => document.documentElement.classList.contains('portal-dark'));
      }
      const report = await page.evaluate(() => {
        const charts = [...document.querySelectorAll('svg[role="img"],.comparison-chart,.funnel,.wd-track')];
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          charts: charts.map((node, index) => {
            const rect = node.getBoundingClientRect();
            const svg = node.matches('svg') ? node : node.querySelector('svg');
            return {
              index, label: node.getAttribute('aria-label') || node.className.baseVal || node.className,
              width: rect.width, height: rect.height, right: rect.right,
              svgPathCount: svg?.querySelectorAll('path').length || 0,
            };
          }),
          dark: document.documentElement.classList.contains('portal-dark'),
          background: getComputedStyle(document.body).backgroundColor,
          rootText: document.body.innerText.slice(0, 100),
        };
      });
      assert.ok(report.charts.length >= 5, 'Expected all chart classes with synthetic data: ' + JSON.stringify(report));
      assert.ok(report.charts.every(c => c.width > 0 && c.height > 0), 'A chart rendered with zero dimensions');
      assert.ok(report.charts.some(c => String(c.label).includes('Workforce Financial Wellness')),
        'Accessible wellness gauge SVG missing');
      assert.ok(report.charts.filter(c => c.svgPathCount >= 2).length >= 2,
        'Expected both trend SVGs to render plotted paths');
      assert.equal(report.dark, theme === 'dark', 'Actual dashboard theme toggle failed');
      assert.deepEqual(errors, [], 'React dashboard runtime errors');
      assert.ok(report.overflow <= 3, 'Dashboard overflows mobile viewport by ' + report.overflow + 'px');
      results.push({ width, theme, status: 'pass', report });
    } catch (e) {
      const screenshot = folder + '/' + label + '-failure.png';
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      results.push({ width, theme, status: 'fail', error: String(e), errors, screenshot });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(folder + '/results.json', JSON.stringify(results, null, 2));
const failures = results.filter(r => r.status === 'fail');
for (const failure of failures) console.error(JSON.stringify(failure));
console.log('React chart/theme checks passed: ' + (results.length - failures.length) + '/' + results.length);
assert.equal(failures.length, 0, 'Dashboard chart/theme regression: see ' + folder + '/results.json');
