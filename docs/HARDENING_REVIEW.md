# Hardening review

## Fixed
- Rate limiting keyed on the proxy IP (trustProxy missing): all visitors shared one bucket. Now per client, plus a per-account login limit.
- Stored XSS: user/employer names, filenames and error text were interpolated into innerHTML unescaped. Added `public/safe.js` (`esc()`) and applied it to data-bearing fields in admin, users and dashboard.
- Session tokens are now stored as SHA-256 digests (existing sessions are invalidated once on deploy).
- Login timing equalised for unknown accounts; non-string inputs rejected before reaching Prisma filters.
- `PATCH /api/users/:id` allow-lists and validates fields; admins cannot deactivate/demote themselves.
- Crashes on empty bodies (reset-password, snapshot) now return 400. Audit-log limit clamped.
- Anonymous analytics writes dropped; event types allow-listed.
- Log redaction for Authorization/Cookie, graceful shutdown, hourly expired-session sweep.
- Admin bootstrap password must meet the password policy. Self-deactivation email is HTML-escaped.
- Dockerfile: multi-stage, `npm ci`, non-root, healthcheck. Removed stale `dist/` and 9 unused asset generations.

## Still open (not done here)
- CSP still needs `script-src 'unsafe-inline'` because pages use inline scripts/handlers; moving to nonces/external JS is the real fix.
- Rate limiter is in-process (needs Redis if scaled out). Set `TRUST_PROXY=false` if not behind a proxy.
- Integration "test connection" accepts admin-supplied URLs (SSRF surface, admin-only).
- `xlsx@0.18.5` has known advisories; run `npm audit` and consider replacing it.
- No visual redesign was done; see the summary for what that would take.

## 0.8.0 enterprise UI + public-site checklist
- Design layer (`public/enterprise.css`): serif headings, tabular figures, square 4-6px radii, split-screen sign-in, uppercase table headers. Colours are inherited from each page's own tokens, so the original purple admin palette and white-label partner themes are preserved.
- New: `404.html` (API paths still get JSON 404), `contact.html` + `POST /api/contact` (honeypot, throttle, validation, SMTP delivery), `thank-you.html`, `robots.txt`, `sitemap.xml`, full favicon set + manifest, 1200x630 OG image, per-page title/description/canonical/OG/Twitter meta (app pages are `noindex`), shared cookie notice, global loading bar, form error states, sticky mobile CTA, first-party pageview analytics on public pages.
- Fixed: `/static/ui-enhance-v2.js` was referenced by three pages but never existed (404 on every load).

### Required configuration (set in Railway Variables)
`CONTACT_EMAIL` (also the contact-form recipient), optional `PRIVACY_EMAIL`, `LEGAL_EMAIL`, `INFORMATION_OFFICER`, `CONTACT_ADDRESS` (physical/registered address), `PUBLIC_BASE_URL` (e.g. https://portal.example.com, used for canonical/OG/sitemap). SMTP must be configured in Admin > Email settings for the form to deliver.

## 0.9.0 review of the ChatGPT pass
Kept: same-origin enforcement for cookie sessions, session-only cookie when "Remember me" is off, partner-field validation, extra headers, landing page, `.env.example`, production-readiness script.
Fixed:
- Static images were `immutable` for a year on unversioned URLs (a replaced logo/OG image would never update). Now 1 day + stale-while-revalidate.
- Origin check now accepts the request's own host as well as `PUBLIC_BASE_URL`, so a custom domain + platform domain no longer 403s every write.
- `createPartner` had none of the new validation; both partner routes returned HTTP 500 on invalid input (now 400 with a message).
- Admin logo upload and the demo-partner preset ignored failed responses and reported success; SVG logos (used by the preset) were newly rejected. Added `apiOk()` and allowed SVG for `<img>` use.
- Landing page showed unlabelled figures (72, 68%, R 4.9m); now marked "Illustrative sample, not real data".
- Legal pages called the address the "Registered address". It is Empower FS's published business address; registered-office status is unverified, so the wording is now "Business address".
- `.gitignore` ignored `.env.example`. Added CI workflow (`.github/workflows/ci.yml`) running every gate.

## Release blockers that only you can clear
1. `npm ci && npm run build` has not been run (no network in the review environments). Run it first.
2. `npm audit --audit-level=high` will most likely FAIL on `xlsx@0.18.5` (no fix on npm). Use SheetJS's own build: `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, then re-run the import checks.
3. Set `CONTACT_EMAIL`, `PRIVACY_EMAIL`, `LEGAL_EMAIL`, `INFORMATION_OFFICER`, `PUBLIC_BASE_URL`, SMTP and DB variables. Published contact on empowerfin.co.za is admin@empowerfs.co.za / 010 900 3212, but use whatever mailbox you actually monitor.
4. Have the responsible party's legal/privacy owner approve the legal text and the "Last updated" date.

## 0.10.0 brand engine + dark mode rebuild
- `public/brand-engine.js` (client-side, dependency-free, 98 unit assertions in `tests/brand-engine.test.mjs`): OKLab/OKLCH analysis, opaque-background detection, 36-bin hue histogram with circular smoothing and watershed clustering, chroma-weighted scoring, WCAG contrast enforcement by lightness only, monochrome/tiny-logo warnings and a confidence score. Outputs: `accentColor` = dominant hue (text-safe >= 4.5:1), `primaryColor` = secondary brand hue, `navyColor` = brand bar (>= 8:1 for white text).
- Dark mode is token-driven (`dark-theme-v2.css` + `BrandEngine.themeController()`), derived from each partner's colours. The whole-page `invert(1)` hack and the fixed lavender palette were removed. Admin light mode keeps its original palette.
- Root cause of the broken dark mode: `enterprise.css` hard-coded `#fff` surfaces and used the brand colour as a button background; both are now tokens.
- The UI regression guard for the logo fix sat after the script's failure exit and could never fail; it is now inside it, and mutation-tested.
