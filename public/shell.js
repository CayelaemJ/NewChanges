/* Shared shell: global loading indicator + cookie notice. No third parties. */
(function () {
  'use strict';
  // ── loading state: thin progress bar while any app API request is in flight ──
  var bar = document.createElement('div'); bar.id = 'ent-progress'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-hidden', 'true');
  var pending = 0, tick = null, w = 0;
  function start() { if (pending++ > 0) return; w = 8; bar.classList.add('on'); bar.style.width = w + '%'; tick = setInterval(function () { w += (90 - w) * 0.12; bar.style.width = w + '%'; }, 250); }
  function done() { if (--pending > 0) return; pending = 0; clearInterval(tick); bar.style.width = '100%'; setTimeout(function () { bar.classList.remove('on'); bar.style.width = '0'; }, 250); }
  function mount() { if (!bar.parentNode && document.body) document.body.appendChild(bar); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  var nativeFetch = window.fetch;
  if (nativeFetch) window.fetch = function (input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var track = url.indexOf('/api/') !== -1 && url.indexOf('/api/analytics/') === -1;
    if (track) start();
    var p = nativeFetch.apply(this, arguments);
    if (track) p.then(done, done);
    return p;
  };

  // ── cookie notice (only when the page has not rendered its own) ──
  var KEY = 'cookieNoticeDismissed';
  function dismissed() { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } }
  function showCookie() {
    if (dismissed() || document.getElementById('cookie-banner') || document.getElementById('ent-cookie')) return;
    var el = document.createElement('div'); el.id = 'ent-cookie'; el.className = 'ent-cookie'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Cookie notice');
    el.innerHTML = '<div class="inner"><p>We use one strictly necessary cookie to keep you signed in. There are no advertising or cross-site tracking cookies. See our <a href="/cookies">Cookie Notice</a>.</p><button type="button">Got it</button></div>';
    el.querySelector('button').addEventListener('click', function () { try { localStorage.setItem(KEY, '1'); } catch (_) {} el.remove(); });
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showCookie); else showCookie();
})();
