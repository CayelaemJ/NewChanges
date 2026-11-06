// Isolated mobile layout regression checks. No production endpoint or credentials.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const widths = [320, 360, 375, 390, 414, 430, 768];
const variants = [
  { name: 'ios-light', platform: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', theme: 'light' },
  { name: 'ios-dark', platform: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', theme: 'dark' },
  { name: 'android-light', platform: 'Android', ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', theme: 'light' },
  { name: 'android-dark', platform: 'Android', ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', theme: 'dark' },
];
const routes = ['/admin', '/users', '/mfa'];
const folder = 'test-results/mobile-ui';
mkdirSync(folder, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

function serveAsset(url) {
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/admin' || pathname === '/users')
    return { contentType: 'text/html', body: readFileSync('public' + pathname + '.html') };
  if (pathname === '/mfa')
    return { contentType: 'text/html', body: readFileSync('public/admin-mfa.html') };
  if (pathname.startsWith('/static/')) {
    const name = pathname.slice('/static/'.length);
    if (name.includes('..') || name.startsWith('/')) return { status: 403, body: 'Forbidden' };
    const path = 'public/' + name;
    if (!existsSync(path)) return { status: 404, body: 'Missing static asset' };
    const contentType = path.endsWith('.js') ? 'application/javascript' :
      path.endsWith('.css') ? 'text/css' :
      path.endsWith('.svg') ? 'image/svg+xml' :
      path.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    return { contentType, body: readFileSync(path) };
  }
  return null;
}

try {
  for (const path of routes) for (const width of widths) for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width, height: 812 },
      deviceScaleFactor: 1,
      isMobile: width < 768,
      hasTouch: width < 768,
      reducedMotion: 'reduce',
      colorScheme: variant.theme,
      userAgent: variant.ua,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(theme => {
      window.__testTheme = theme;
      localStorage.setItem('cookieNoticeDismissed', '1');
      sessionStorage.setItem('efsWelcomeShown', '1');
      // Keep the preference explicit so testing does not depend on host OS defaults.
      localStorage.setItem('ef_theme', window.__testTheme);
    }, variant.theme);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'mobile-ui.test') return route.abort();
      const asset = serveAsset(url);
      if (asset) return route.fulfill(asset);
      if (url.pathname.startsWith('/api/')) {
        // All fixtures are synthetic. Mutating API requests are never executed.
        if (!['GET', 'HEAD'].includes(route.request().method()))
          return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Synthetic tests are read-only"}' });
        const response = url.pathname === '/api/auth/me'
          ? { id: 'fixture-admin', name: 'Mobile Test Admin', role: 'SUPERADMIN', modules: { dashboard: true, admin: true, users: true }, employers: [], theme: null }
          : url.pathname === '/api/auth/mfa/status'
          ? { configured: true, enrolled: false, verified: false, totpAvailable: true, totpEnrolled: false, passkeyEnrolled: false, canManageRecovery: false }
          : url.pathname === '/api/admin/reports'
          ? { loadOrder: [], reports: [] }
          : url.pathname === '/api/admin/integration'
          ? { configured: true, enabled: true, sourceMode: 'SQL', effectiveSourceMode: 'SQL', scheduleHours: 24, lastSyncStatus: 'OK' }
          : url.pathname === '/api/users' ? []
          : [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
      }
      return route.fulfill({ status: 404, body: 'Unmocked fixture resource' });
    });
    const label = path.slice(1) + '-' + width + '-' + variant.name;
    try {
      const response = await page.goto('http://mobile-ui.test' + path, { waitUntil: 'domcontentloaded' });
      assert.equal(response?.status(), 200, 'Page should load successfully');
      await page.waitForTimeout(350);
      await page.evaluate(() => document.fonts.ready);
      // The same fixture is rendered under OS theme preferences and both mobile UA profiles.
      await page.evaluate(theme => {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.classList.toggle('portal-dark', theme === 'dark');
      }, variant.theme);
      const layout = await page.evaluate(() => {
        const allowedScroll = '.console-table-scroll,.security-table-wrap,[role="grid"],[data-allow-horizontal-scroll]';
        const visible = el => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        };
        const offenders = [...document.querySelectorAll('body *')]
          .filter(el => visible(el) && !el.closest(allowedScroll))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            return style.position !== 'fixed' && rect.right > innerWidth + 3 && rect.left < innerWidth;
          })
          .slice(0, 12)
          .map(el => ({
            element: el.tagName.toLowerCase(), id: el.id,
            className: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
            right: Math.round(el.getBoundingClientRect().right),
          }));
        const clipped = [...document.querySelectorAll('button,input,select,textarea,h1,h2,h3,label')]
          .filter(el => visible(el) && !el.closest(allowedScroll))
          .filter(el => {
            const style = getComputedStyle(el);
            return (el.scrollWidth > el.clientWidth + 3 && ['hidden', 'clip'].includes(style.overflowX)) ||
              (el.scrollHeight > el.clientHeight + 3 && ['hidden', 'clip'].includes(style.overflowY));
          })
          .slice(0, 12).map(el => ({ element: el.tagName, id: el.id, text: el.textContent?.trim().slice(0, 45) }));
        return {
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
          bodyTextLength: document.body.innerText.trim().length,
          offenders, clipped,
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          theme: document.documentElement.getAttribute('data-theme'),
          touchTargets: [...document.querySelectorAll('button,input[type="button"],input[type="submit"],[role="button"]')]
            .filter(el => visible(el))
            .filter(el => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
            .slice(0, 12).map(el => ({ id: el.id, label: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 45) })),
        };
      });
      assert.ok(layout.bodyTextLength > 50, 'Blank or nearly empty mobile screen: ' + JSON.stringify(layout));
      assert.ok(layout.documentWidth <= layout.viewport + 3, 'Horizontal document overflow: ' + JSON.stringify(layout));
      assert.deepEqual(layout.offenders, [], 'Elements escaping the viewport');
      assert.deepEqual(layout.clipped, [], 'Clipped form controls or headings');
      assert.equal(layout.theme, variant.theme, 'Theme preference not reflected in document');
      assert.deepEqual(pageErrors, [], 'Unhandled browser errors');
      results.push({ path, width, platform: variant.platform, theme: variant.theme, status: 'pass', layout });
    } catch (error) {
      const screenshot = folder + '/' + label + '-failure.png';
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      results.push({ path, width, platform: variant.platform, theme: variant.theme, status: 'fail', error: String(error), pageErrors, screenshot });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(folder + '/results.json', JSON.stringify(results, null, 2));
const failures = results.filter(result => result.status === 'fail');
console.log('Mobile UI test matrix: ' + (results.length - failures.length) + '/' + results.length + ' passed');
for (const failure of failures) console.error(JSON.stringify(failure));
assert.equal(failures.length, 0, 'Mobile UI regression failures. See ' + folder + '/results.json');
