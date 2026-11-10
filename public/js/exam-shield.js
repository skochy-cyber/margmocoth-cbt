/* MARGMOCOTH CBT — Exam Shield
 * Extra screenshot / screen-recording hardening for exam-page.html.
 * Load AFTER js/exam.js:  <script src="js/exam-shield.js"></script>
 *
 * What it does (browser-level, best effort):
 *  1. Traceable watermark (student name + matric + time) over the whole exam.
 *  2. Instantly covers the exam with a black screen when focus is lost, the
 *     tab is hidden, the OS/Win key is held, PrintScreen or a snipping /
 *     recording shortcut is pressed, or printing starts.
 *  3. Records a "screenshot" violation for snip / Game Bar shortcuts.
 *  4. Scans for virtual cameras and capture devices (OBS, ManyCam, etc.).
 *  5. Disables printing via CSS.
 *
 * Limit: a web page cannot stop OS-level screenshots or recorders (for example
 * phone power+volume). For a true block, wrap the exam in an Android app that
 * sets FLAG_SECURE.
 */
(function () {
  'use strict';
  if (window.__ttpShield) return;
  window.__ttpShield = true;

  var student = null;
  try { student = JSON.parse(sessionStorage.getItem('student') || 'null'); } catch (e) {}
  var who = student ? [student.name, student.matric].filter(Boolean).join(' - ') : 'MARGMOCOTH CBT';

  function submitted() {
    try { return typeof examSubmitted !== 'undefined' && examSubmitted === true; } catch (e) { return false; }
  }
  function violation(reason) {
    try {
      if (!submitted() && typeof recordViolation === 'function') {
        recordViolation(reason, 'rule_violation', 'screenshot');
      }
    } catch (e) {}
  }

  /* ---------- styles ---------- */
  var css = document.createElement('style');
  css.textContent =
    '@media print{html,body{display:none!important}}' +
    '#ttp-wm{position:fixed;inset:0;z-index:2147483000;pointer-events:none;background-repeat:repeat}' +
    '#ttp-cover{position:fixed;inset:0;z-index:2147483647;background:#000;color:#fff;display:none;' +
    'align-items:center;justify-content:center;text-align:center;font:600 18px system-ui,Arial,sans-serif;padding:24px}' +
    '#ttp-cover.on{display:flex}';
  document.head.appendChild(css);

  /* ---------- watermark ---------- */
  var wm = document.createElement('div');
  wm.id = 'ttp-wm';
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function paintWatermark() {
    var d = new Date();
    var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    var text = (who + '  |  ' + stamp).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200">' +
      '<text x="20" y="120" font-family="Arial,sans-serif" font-size="15" font-weight="600" ' +
      'fill="rgba(0,0,0,0.10)" transform="rotate(-25 180 100)">' + text + '</text></svg>';
    wm.style.backgroundImage = 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }
  paintWatermark();
  setInterval(paintWatermark, 30000);

  /* ---------- cover ---------- */
  var cover = document.createElement('div');
  cover.id = 'ttp-cover';
  cover.textContent = 'Exam content hidden. Return to the exam window to continue.';
  var holdUntil = 0;
  function show() { cover.classList.add('on'); }
  function hide() { if (Date.now() >= holdUntil && document.hasFocus() && !document.hidden) cover.classList.remove('on'); }
  function hold(ms) { holdUntil = Math.max(holdUntil, Date.now() + ms); show(); setTimeout(hide, ms + 50); }

  function mount() {
    if (!document.body) return setTimeout(mount, 50);
    document.body.appendChild(wm);
    document.body.appendChild(cover);
    if (!document.hasFocus()) show();
  }
  mount();

  window.addEventListener('blur', show);
  window.addEventListener('focus', hide);
  document.addEventListener('visibilitychange', function () { document.hidden ? show() : hide(); });
  window.addEventListener('beforeprint', function () { hold(3000); violation('Print attempt detected'); });
  setInterval(function () { if (!submitted()) { document.hasFocus() ? hide() : show(); } }, 400);

  /* ---------- keyboard shortcuts ---------- */
  window.addEventListener('keydown', function (e) {
    if (submitted()) return;
    var k = (e.key || '').toLowerCase();
    if (e.key === 'PrintScreen') { hold(3000); return; }               // exam.js already logs it
    if (e.key === 'Meta' || e.key === 'OS') { hold(2500); return; }    // Win/Cmd key held
    if (e.metaKey && e.shiftKey && (k === 's' || k === '3' || k === '4' || k === '5')) {
      hold(4000); violation('Screenshot shortcut detected (Win/Cmd + Shift)'); e.preventDefault(); return;
    }
    if (e.metaKey && e.altKey && (k === 'r' || k === 'g' || k === 'printscreen')) {
      hold(4000); violation('Screen recording shortcut detected (Win + Alt)'); e.preventDefault(); return;
    }
    if (e.metaKey && k === 'g') { hold(4000); violation('Game Bar shortcut detected (Win + G)'); e.preventDefault(); }
  }, true);
  window.addEventListener('keyup', function (e) {
    if (e.key === 'PrintScreen' || e.key === 'Meta' || e.key === 'OS') hold(1500);
  }, true);

  /* ---------- virtual camera / capture device scan ---------- */
  var BAD = /obs|virtual|manycam|xsplit|splitcam|camtwist|snap camera|screen|capture|display|record/i;
  var seen = {};
  function scan() {
    if (submitted() || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      list.forEach(function (d) {
        if (d.kind === 'videoinput' && d.label && BAD.test(d.label) && !seen[d.label]) {
          seen[d.label] = true;
          violation('Virtual or capture camera detected: ' + d.label);
        }
      });
    }).catch(function () {});
  }
  setTimeout(scan, 6000);
  setInterval(scan, 20000);
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', scan);
  }
})();
