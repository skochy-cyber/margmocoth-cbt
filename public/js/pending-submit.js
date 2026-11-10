// Retries any exam submission that could not reach the server earlier (network or server error).
// Copies are kept in localStorage as pending_exam_submit_<sessionId> until MongoDB confirms the result.
(function () {
  var running = false;
  async function retryPending() {
    if (running || !navigator.onLine) return;
    running = true;
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('pending_exam_submit_') === 0) keys.push(k);
      }
      for (var j = 0; j < keys.length; j++) {
        try {
          var payload = JSON.parse(localStorage.getItem(keys[j]));
          if (!payload || !payload.session_id) { localStorage.removeItem(keys[j]); continue; }
          var res  = await fetch('/api/submit-exam', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          var data = await res.json();
          if (data && data.success) {
            localStorage.removeItem(keys[j]);
            try { localStorage.removeItem('exam_progress_' + payload.session_id); } catch (e) {}
          }
        } catch (e) { /* still offline or server down - try again later */ }
      }
    } catch (e) {}
    running = false;
  }
  window.addEventListener('online', retryPending);
  setInterval(retryPending, 60000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retryPending);
  else retryPending();
})();
