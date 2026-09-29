(function () {
  'use strict';
  var f = document.getElementById('contact-form'); if (!f) return;
  var btn = document.getElementById('c-btn'), alertBox = document.getElementById('form-alert');
  var msg = document.getElementById('c-msg'), count = document.getElementById('c-count');
  msg.addEventListener('input', function () { count.textContent = msg.value.length; });
  function setErr(id, field, on) { var box = document.getElementById(id); box.parentNode.classList.toggle('has-error', on); field.setAttribute('aria-invalid', on ? 'true' : 'false'); if (on) field.setAttribute('aria-describedby', id); }
  function validate() {
    var n = f.elements.name, e = f.elements.email, m = f.elements.message, ok = true, first = null;
    var bad = [[ 'e-name', n, !n.value.trim() ], [ 'e-email', e, !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.value.trim()) ], [ 'e-message', m, m.value.trim().length < 10 ]];
    bad.forEach(function (b) { setErr(b[0], b[1], b[2]); if (b[2]) { ok = false; first = first || b[1]; } });
    if (first) first.focus();
    return ok;
  }
  f.addEventListener('input', function (ev) { var p = ev.target.closest('.field'); if (p && p.classList.contains('has-error')) { validate(); } });
  f.addEventListener('submit', function (ev) {
    ev.preventDefault(); alertBox.classList.remove('show');
    if (!validate()) return;
    btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.innerHTML = '<span class="spin"></span>Sending…';
    fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), organisation: f.elements.organisation.value.trim(),
      message: f.elements.message.value.trim(), website: f.elements.website.value
    }) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { if (!x.ok) throw new Error((x.d && x.d.error) || 'Something went wrong. Please try again.'); location.href = '/thank-you'; })
      .catch(function (e) { alertBox.textContent = e.message; alertBox.classList.add('show'); alertBox.scrollIntoView({ block: 'nearest' }); btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Send message'; });
  });
})();
