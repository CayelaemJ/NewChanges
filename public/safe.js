/* Shared HTML-escaping helper. Every value that originates from the API or the
   user (names, e-mails, filenames, error text) must pass through esc() before
   it is interpolated into an innerHTML template. */
(function (w) {
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  w.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"'`]/g, function (c) { return MAP[c]; });
  };
})(window);
