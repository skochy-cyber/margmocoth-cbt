// ===== MARGMOCOTH CBT EXAM ENGINE =====
'use strict';

let questions      = [];
let answers        = {};
let flagged        = new Set();
let currentQ       = 0;
let timerInterval  = null;
let timeRemaining  = 0;
let violationCount = 0;
let examSubmitted       = false;
let autoSubmitTriggered = false; // blocks duplicate autoSubmit calls during the 2.5s delay
let lastViolationAt     = 0;     // timestamp of last violation — global cooldown guard
let networkReconnectedAt = 0;    // timestamp of last reconnect — suppress AI violations briefly after reconnect
// * FIX: AI monitoring suppression — when offline, AI detectors (face/voice/side-look)
// can misfire because webcam frames stall or model inference queues up.
// Suppress AI-triggered violations while offline or within 5s of reconnect.
function isAiMonitoringReliable() {
  if (isOffline) return false;
  if (networkReconnectedAt && Date.now() - networkReconnectedAt < 5000) return false;
  return true;
}
let webcamStream   = null;
let webcamInterval = null;
let sessionId      = null;
let networkOfflineAt = null;
let isOffline        = false;
let offlineSyncPending  = false; // true when answers need syncing after reconnect
let pendingViolations   = [];    // violations queued while offline — flushed on reconnect

// * Mobile detection — Android/iOS browsers misfire fullscreen & visibilitychange events
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let visibilityHideAt = null; // timestamp when page went hidden — used to debounce violations

// ── face-api.js Identity Verification ────────────────────────
const FACE_MATCH_THRESHOLD     = 0.55;   // Euclidean distance; lower = stricter match (0.55 tolerates lighting/angle variation)
const IDENTITY_CHECK_INTERVAL  = 5000;  // check every 5s during exam
const IDENTITY_MAX_MISMATCHES  = 2;     // auto-submit after 2 consecutive mismatches

let faceApiModelsLoaded   = false;  // true once TinyFaceDetector + FaceNet are ready
let referenceDescriptor   = null;   // Float32Array — registered student's face descriptor
let identityCheckReady    = false;  // true once reference descriptor is loaded
let identityMismatchCount = 0;      // consecutive mismatches (resets on good match)
let identityCheckTimer    = null;   // setInterval handle for periodic checks
let identityViolationPending = false;

// CDN URLs for face-api model weights — local server first (fastest), then CDN fallback
const FACEAPI_MODELS_CDN  = '/models';                                                        // local — served from public/models/
const FACEAPI_MODELS_ALT  = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights'; // CDN fallback
const FACEAPI_MODELS_ALT2 = null; // unused

// Face anti-cheat state
let blazeFaceModel        = null;
let faceDetectInterval    = null;   // kept for cleanup reference only
let faceDetectionRunning  = false;  // guard: prevents overlapping rAF calls
let noFaceTimer           = null;
let _examStartTime        = Date.now(); // used for startup grace period
let faceViolationPending  = false;
let faceEngineReady       = false;

// Side-look detection state
let sideLookTimer      = null;
let sideLookPending    = false;
let sideLookFrames     = 0;          // consecutive frames with a side-look detected
let sideLookEarlyFrame = null;       // snapshot captured on the FIRST detected frame
let multiFaceFrames    = 0;          // consecutive frames with multiple faces (debounce noise)

// Voice/mouth detection state
let mouthMoveTimer   = null;
let mouthMovePending = false;

// * Mouth recording state — records a video clip while mouth is moving
let mouthMediaRecorder   = null;  // active MediaRecorder instance
let mouthRecordedChunks  = [];    // accumulated video chunks
let mouthRecordingActive = false; // true while recording is in progress
let mouthRecordingTimer  = null;  // safety cap: auto-stop after 15s

// Settings loaded from server
let examSettings = {
  allow_prev_question:    true,
  show_instructions:      true,
  max_violations:         3,
  exam_rules:             '',
  webcam_enabled:         true,
  fullscreen_enabled:     true,
  anticheat_enabled:      true,
  face_anticheat_enabled: false,
  restrict_side_look:     false,
  reshuffle_on_violation: false,
  restrict_voice:         false,
  show_results:           false,
  show_percentage:        true,
  show_score_breakdown:   true,
  show_grade:             true,
};

const student  = JSON.parse(sessionStorage.getItem('student')     || 'null');
const examData = JSON.parse(sessionStorage.getItem('currentExam') || 'null');

if (!student || !examData) {
  window.location.href = 'login.html';
}

// * FIX: Redirect to results if already submitted — unless this is a legitimate retake.
(function guardAlreadySubmitted() {
  const examKey = examData?.id || examData?._id;
  function clearStale() {
    sessionStorage.removeItem('examResult');
    if (examKey) sessionStorage.removeItem('examSessionSubmitted_' + examKey);
  }
  const existingResult = sessionStorage.getItem('examResult');
  if (existingResult) {
    try {
      const r = JSON.parse(existingResult);
      if (r && examData && (r.exam_id === (examData.id || examData._id) || r.exam_title === examData.title)) {
        if (examData.allow_retake) { clearStale(); }
        else { history.replaceState(null,'','results.html'); window.location.replace('results.html'); }
      }
    } catch(e) {}
  }
  const submittedFlag = sessionStorage.getItem('examSessionSubmitted_' + examKey);
  if (submittedFlag === '1') {
    if (examData && examData.allow_retake) { clearStale(); }
    else { history.replaceState(null,'','results.html'); window.location.replace('results.html'); }
  }
})();

function getExamId() {
  if (!examData) return null;
  return examData.id || examData._id || null;
}

async function loadExamSettings() {
  try {
    // First check if we have settings already stored from exam-access.html
    const cached = sessionStorage.getItem('examSettings');
    if (cached) {
      examSettings = { ...examSettings, ...JSON.parse(cached) };
    }
    // Always refresh from server (server is authoritative)
    const res  = await fetch('/api/settings/exam-engine');
    const data = await res.json();
    examSettings = { ...examSettings, ...data };
  } catch(e) {
    console.warn('Could not load exam settings, using defaults:', e);
  }

  // * DIAGNOSTIC — always log anticheat state to console so you can confirm
  console.log('%c[ICBT ANTICHEAT STATE]', 'background:#0f6b30;color:white;font-weight:bold;padding:2px 8px;border-radius:4px;', {
    face_anticheat_enabled: examSettings.face_anticheat_enabled,
    restrict_side_look:     examSettings.restrict_side_look,
    restrict_voice:         examSettings.restrict_voice,
    webcam_enabled:         examSettings.webcam_enabled,
    anticheat_enabled:      examSettings.anticheat_enabled,
  });
  if (!examSettings.face_anticheat_enabled || !examSettings.restrict_side_look || !examSettings.restrict_voice) {
    console.warn('%c[ICBT WARNING] One or more anticheat features are DISABLED in admin settings!', 'color:red;font-weight:bold;');
    console.warn('Go to Admin → Settings and enable: Face Anti-Cheat, Restrict Side Look, Restrict Voice');
  }
}

async function initExam() {
  await loadExamSettings();
  if (typeof initCalcFromSettings === 'function') initCalcFromSettings(examSettings);

  document.getElementById('examTitle').textContent = examData.title;

  // Instructions screen (includes global exam_rules)
  if (examSettings.show_instructions) {
    await showInstructionsScreen();
  }

  // Strict fullscreen if enabled
  if (examSettings.fullscreen_enabled) {
    await requestFullscreen();
    setupStrictFullscreen();
  }

  // Webcam (shares stream with face engine)
  if (examSettings.webcam_enabled) {
    await initWebcam();
  } else {
    ['webcamPreview', 'webcamSide'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  // * AI engine fires in the BACKGROUND — never await it before loading questions.
  // On slow connections (mobile Nigeria), TF.js + BlazeFace can take 10-30s to load.
  // Awaiting it left students staring at "Loading question..." and 00:00 timer.
  // The engine sets faceEngineReady=true when it's ready; detection loop starts then.
  if (examSettings.webcam_enabled && (
        examSettings.face_anticheat_enabled ||
        examSettings.restrict_side_look     ||
        examSettings.restrict_voice
      )) {
    initFaceAntiCheat(); // intentionally NOT awaited
    if (student && student.id) initializeFaceVerification(student.id); // intentionally NOT awaited
  }

  // Load questions and start timer IMMEDIATELY — don't wait for AI
  await loadQuestions();
  const dur = parseInt(examData.duration, 10);
  if (!dur || dur <= 0) {
    console.error('[ICBT] Invalid exam duration:', examData.duration);
    document.getElementById('timerDisplay').textContent = '--:--';
  } else {
    startTimer(dur * 60);
  }

  // ── Show identity verified toast if face-capture.html set the token ─────
  const verifyToken = sessionStorage.getItem('faceVerified');
  const matchScore  = sessionStorage.getItem('faceMatchScore');
  if (verifyToken) {
    const scoreText = matchScore ? ` (${matchScore}% match)` : '';
    showSuccessToast(`Identity verified successfully${scoreText}`);
    sessionStorage.removeItem('faceVerified');
    sessionStorage.removeItem('faceMatchScore');
  }

  // ── Periodic auto-save every 30s ──────────────────────────────
  setInterval(() => {
    if (!examSubmitted && sessionId) saveProgress();
  }, 30000);

  if (examSettings.anticheat_enabled) {
    setupAntiCheat();
  }

  applyPrevButtonSetting();
}

// ═══════════════════════════════════════════════════════════════
// * STRICT FULLSCREEN — block back, close, minimize, overlay
// ═══════════════════════════════════════════════════════════════

function setupStrictFullscreen() {
  // Block back navigation
  history.pushState(null, '', window.location.href);
  window.addEventListener('popstate', function(e) {
    if (examSubmitted) {
      // * FIX: Exam already done — don't let back re-enter the exam.
      // Replace the exam page in history with results so the student
      // can't navigate back and retake.
      history.replaceState(null, '', 'results.html');
      window.location.replace('results.html');
      return;
    }
    history.pushState(null, '', window.location.href);
    recordViolation('Attempted to navigate away (back button)');
    showViolationToast('Back navigation blocked — violation recorded!');
  });

  // Block page close / tab close
  window.addEventListener('beforeunload', function(e) {
    if (!examSubmitted) {
      e.preventDefault();
      e.returnValue = 'Leaving this page will count as a violation. Are you sure?';
      return e.returnValue;
    }
  });

  // Handle visibility change (minimize, notification bar, app overlay)
  // * FIX: Debounce on mobile — Android fires visibilitychange for keyboard popups,
  // notifications, and address bar changes. Only count as a violation if hidden > 2s.
  let _visibilityTimer = null;
  document.addEventListener('visibilitychange', function() {
    if (document.hidden && !examSubmitted) {
      if (isMobile) {
        visibilityHideAt = Date.now();
        // * FIX: Store the timer so we can cancel it if the student returns quickly.
        //        Previously the timer still fired even if the page became visible again.
        clearTimeout(_visibilityTimer);
        _visibilityTimer = setTimeout(() => {
          _visibilityTimer = null;
          if (document.hidden && !examSubmitted && visibilityHideAt) {
            visibilityHideAt = null;
            recordViolation('Page hidden — possible minimize/notification bar/split-screen detected', 'rule_violation', 'focus_loss');
            showViolationToast('Exam window hidden — violation recorded!');
          }
        }, 2000); // * raised from 1500ms to 2000ms for slower Android devices
      } else {
        recordViolation('Page hidden — possible minimize/notification bar/split-screen detected', 'rule_violation', 'focus_loss');
        showViolationToast('Exam window hidden — violation recorded!');
      }
    } else if (!document.hidden) {
      // * FIX: Cancel pending mobile timer when student returns quickly
      clearTimeout(_visibilityTimer);
      _visibilityTimer = null;
      visibilityHideAt = null; // cleared when page comes back
    }
  });

  // Handle window blur (clicking outside, taskbar, notification area)
  window.addEventListener('blur', function() {
    if (!examSubmitted && examSettings.fullscreen_enabled) {
      setTimeout(() => {
        if (document.visibilityState === 'visible' && !document.fullscreenElement) {
          // Fullscreen lost — record and re-enter
        }
      }, 200);
    }
  });

  // Re-request fullscreen when exited
  // * FIX: On mobile (Android/iOS) the fullscreen API is unreliable — it fires spuriously
  // when the keyboard opens, the address bar hides, or during orientation changes.
  // Skip the violation on mobile; still re-request fullscreen silently.
  document.addEventListener('fullscreenchange', function() {
    if (!document.fullscreenElement && !examSubmitted) {
      if (!isMobile) {
        recordViolation('Fullscreen exited');
        showViolationToast('Fullscreen exited — violation recorded! Returning to fullscreen...');
      }
      setTimeout(requestFullscreen, 1500);
    }
  });

  // Block keyboard shortcuts that could reveal taskbar / notification bar
  document.addEventListener('keydown', function(e) {
    if (examSubmitted) return;
    const blocked = (
      e.key === 'Escape' ||
      (e.ctrlKey && ['c','v','u','a','s','p','f'].includes(e.key.toLowerCase())) ||
      e.key === 'F12' || e.key === 'F11' ||
      (e.metaKey) ||
      (e.altKey && e.key === 'Tab') ||
      (e.altKey && e.key === 'F4') ||
      (e.ctrlKey && e.altKey && e.key === 'Delete') ||
      (e.key === 'Meta') ||
      (e.ctrlKey && e.shiftKey && ['i','j','c'].includes(e.key.toLowerCase())) ||
      (e.key === 'F5') ||
      (e.key === 'PrintScreen') ||
      (e.ctrlKey && e.key === 'w') ||
      (e.ctrlKey && e.key === 't') ||
      (e.ctrlKey && e.key === 'n')
    );
    if (blocked) {
      e.preventDefault();
      e.stopPropagation();
      if (['Escape','F11','F12'].includes(e.key)) {
        // F11 on mobile is a phantom browser event (address bar toggle), not a real key — skip logging
        if (e.key === 'F11' && isMobile) { return; }
        recordViolation(`Blocked key pressed: ${e.key}`);
      }
      if (e.key === 'PrintScreen') {
        // Wipe clipboard immediately so any screenshot captured before preventDefault is cleared
        navigator.clipboard && navigator.clipboard.writeText('').catch(()=>{});
        recordViolation('Screenshot attempt detected (PrintScreen key)', 'rule_violation', 'screenshot');
        showViolationToast('Screenshot blocked — violation recorded!');
      }
    }
  }, true);

  // Block keyup for PrintScreen — Chromium captures clipboard on keyup not keydown
  document.addEventListener('keyup', function(e) {
    if (e.key === 'PrintScreen') {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard && navigator.clipboard.writeText('').catch(()=>{});
    }
  }, true);

  // Block copy/cut — prevents Ctrl+C clipboard capture of question content
  document.addEventListener('copy', e => { e.preventDefault(); e.stopPropagation(); }, true);
  document.addEventListener('cut',  e => { e.preventDefault(); e.stopPropagation(); }, true);

  // Block right-click context menu
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ── Screen Recording / Capture Detection ──────────────────────────────────
  // 1. Block browser-initiated screen sharing via getDisplayMedia (screen cast)
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    const _originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async function(...args) {
      recordViolation('Screen recording/sharing attempt detected (getDisplayMedia)', 'rule_violation', 'screenshot');
      showViolationToast('Screen recording blocked — violation recorded!');
      throw new DOMException('Screen capture blocked by exam policy.', 'NotAllowedError');
    };
  }

  // 2. Detect new capture devices appearing (e.g. virtual camera / screen capture software)
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCapture = devices.some(d =>
          d.kind === 'videoinput' && /screen|capture|display|record/i.test(d.label)
        );
        if (hasCapture) {
          recordViolation('Screen capture device detected', 'rule_violation', 'screenshot');
          showViolationToast('Screen capture device detected — violation recorded!');
        }
      } catch(_) {}
    });
  }

  // 3. CSS: disable text selection and drag on exam body to harden against content scraping
  document.body.style.userSelect        = 'none';
  document.body.style.webkitUserSelect  = 'none';
  document.body.style.webkitTouchCallout = 'none';
}

function showViolationToast(msg) {
  // Legacy function kept for compatibility — routes to modern overlay for rule violations
  const toast = document.getElementById('violationToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

function showViolationBanner(reason, violation_type) {
  // Modern violation banner shown to student with count + remaining
  const maxV      = examSettings.max_violations || 3;
  const remaining = maxV - violationCount;
  const isNetwork = violation_type === 'network_error';
  const isRule    = !isNetwork && violation_type !== 'system_error';

  let existing = document.getElementById('violBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'violBanner';

  const cleanReason = reason.replace(/^\[.*?\]\s*/, '');
  const isInfo = violation_type === 'system_error';
  const icon = isNetwork
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>'
    : isInfo
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:100000;
    background:${isNetwork ? '#14163f' : isInfo ? '#1e4d2b' : '#7f1d1d'};
    color:#fff;padding:0;
    font-family:'DM Sans',system-ui,sans-serif;
    animation:slideDown .25s ease;
    box-shadow:0 4px 24px rgba(0,0,0,.35);
  `;

  if (!document.getElementById('violBannerStyle')) {
    const s = document.createElement('style');
    s.id = 'violBannerStyle';
    s.textContent = `
      @keyframes slideDown { from{transform:translateY(-100%)} to{transform:translateY(0)} }
      @keyframes slideUp   { from{transform:translateY(0)} to{transform:translateY(-100%)} }
      #violBanner .vb-bar {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 18px;gap:12px;
      }
      #violBanner .vb-left { display:flex;align-items:center;gap:10px;min-width:0; }
      #violBanner .vb-icon { font-size:20px;flex-shrink:0; }
      #violBanner .vb-msg  { font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
      #violBanner .vb-pills { display:flex;gap:8px;align-items:center;flex-shrink:0; }
      #violBanner .vb-pill {
        background:rgba(255,255,255,.18);border-radius:999px;
        padding:3px 12px;font-size:11px;font-weight:800;letter-spacing:.3px;white-space:nowrap;
      }
      #violBanner .vb-pill.danger { background:rgba(239,68,68,.5); }
      #violBanner .vb-prog {
        height:3px;background:rgba(255,255,255,.15);
        position:relative;overflow:hidden;
      }
      #violBanner .vb-prog-fill {
        height:100%;background:rgba(255,255,255,.6);
        animation:progShrink 4s linear forwards;
      }
      @keyframes progShrink { from{width:100%} to{width:0} }
    `;
    document.head.appendChild(s);
  }

  banner.innerHTML = `
    <div class="vb-bar">
      <div class="vb-left">
        <span class="vb-icon">${icon}</span>
        <span class="vb-msg">${cleanReason}</span>
      </div>
      <div class="vb-pills">
        ${isRule ? `<span class="vb-pill">Violation #${violationCount} of ${maxV}</span>` : ''}
        ${isRule && remaining > 0 ? `<span class="vb-pill ${remaining <= 1 ? 'danger' : ''}">${remaining} warning${remaining===1?'':'s'} remaining</span>` : ''}
        ${isRule && remaining <= 0 ? `<span class="vb-pill danger">Auto-submitting…</span>` : ''}
      </div>
    </div>
    <div class="vb-prog"><div class="vb-prog-fill"></div></div>
  `;

  document.body.appendChild(banner);
  setTimeout(() => {
    if (banner.parentNode) {
      banner.style.animation = 'slideUp .25s ease forwards';
      setTimeout(() => banner.remove(), 260);
    }
  }, 4000);
}

async function requestFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch(e) { console.warn('Fullscreen request failed:', e); }
}

// ═══════════════════════════════════════════════════════════════════
// * IDENTITY VERIFICATION — face-api.js (TinyFaceDetector + FaceNet)
// ═══════════════════════════════════════════════════════════════════

/**
 * Entry point — loads face-api.js CDN script, then loads the three
 * required model weights, then fetches the reference descriptor.
 * Called once from initExam() when webcam is enabled.
 */
async function initializeFaceVerification(studentId) {
  try {
    await loadFaceApiScript();
    await loadFaceModels();
    faceApiModelsLoaded = true;
    showFaceEngineToast('Identity Tracking Active', '#14163f');
    console.log('[OK] face-api.js models loaded — identity verification active');
    await loadReferenceDescriptor(studentId);
  } catch (e) {
    console.warn('face-api.js identity verification failed to initialise:', e.message);
    faceApiModelsLoaded = false;
    // Fail-closed: if face verification is required and models failed, block the exam.
    const required = examSettings.face_verify_required !== false;
    if (required) {
      alert('Identity verification failed to load. You cannot continue this exam. Please check your internet connection and try again.');
      window.location.href = 'dashboard.html';
    }
  }
}

/** Dynamically inject face-api.js CDN script and wait for it to be available. */
function loadFaceApiScript() {
  return new Promise((resolve, reject) => {
    if (window.faceapi) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = 'https://cdn.jsdelivr.net/npm/face-api.js/dist/face-api.min.js';
    s.onload  = () => {
      const start = Date.now();
      (function wait() {
        if (window.faceapi) { resolve(); return; }
        if (Date.now() - start > 10000) { reject(new Error('face-api.js load timeout')); return; }
        setTimeout(wait, 100);
      })();
    };
    s.onerror = () => reject(new Error('face-api.js CDN failed'));
    document.head.appendChild(s);
  });
}

/** Load TinyFaceDetector, FaceLandmark68Net, FaceRecognitionNet model weights. */
async function loadFaceModels() {
  for (const url of [FACEAPI_MODELS_CDN, FACEAPI_MODELS_ALT, FACEAPI_MODELS_ALT2].filter(Boolean)) {
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68Net.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url),
      ]);
      console.log('face-api models loaded from', url);
      return;
    } catch (e) {
      console.warn('Model load attempt failed from', url);
      try { faceapi.nets.tinyFaceDetector.dispose(); } catch(_) {}
      try { faceapi.nets.faceLandmark68Net.dispose(); } catch(_) {}
      try { faceapi.nets.faceRecognitionNet.dispose(); } catch(_) {}
    }
  }
  throw new Error('Could not load face-api model weights from any source');
}

/**
 * Fetch the student's registered Cloudinary photo, run face detection on it,
 * and store its 128-d descriptor as referenceDescriptor.
 */
async function loadReferenceDescriptor(studentId) {
  try {
    const res  = await fetch(`/api/student/profile-photo/${studentId}`);
    const data = await res.json();
    if (!data.success || !data.url) {
      console.warn('No reference photo — blocking exam entry');
      const required = examSettings.face_verify_required !== false;
      if (required) {
        alert('No registered face photo found for your account. Contact your administrator to upload your profile photo before taking this exam.');
        window.location.href = 'dashboard.html';
      }
      return;
    }

    const img = await faceapi.fetchImage(data.url);
    const det = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!det) {
      console.warn('Reference photo: no face detected — blocking exam entry');
      const required = examSettings.face_verify_required !== false;
      if (required) {
        alert('No face could be detected in your registered profile photo. Contact your administrator to re-upload a clear photo.');
        window.location.href = 'dashboard.html';
      }
      return;
    }

    referenceDescriptor   = det.descriptor;
    identityCheckReady    = true;
    identityMismatchCount = 0;
    console.log('[OK] Reference descriptor ready');
    startIdentityCheckTimer();
  } catch (e) {
    console.warn('loadReferenceDescriptor error:', e.message);
  }
}

/** Start the periodic identity check timer (called once reference is loaded). */
function startIdentityCheckTimer() {
  if (identityCheckTimer) return;
  identityCheckTimer = setInterval(runIdentityCheck, IDENTITY_CHECK_INTERVAL);
}

/**
 * Periodic identity check — runs every IDENTITY_CHECK_INTERVAL ms.
 * Captures a webcam frame, runs face detection + descriptor extraction,
 * and compares Euclidean distance against the reference descriptor.
 */
async function runIdentityCheck() {
  if (examSubmitted || !identityCheckReady || !faceApiModelsLoaded) return;
  if (!referenceDescriptor) return; // no reference → skip (admin review handles it)

  const video = document.getElementById('webcamPreview') ||
                document.getElementById('webcamSide');
  if (!video || !video.srcObject || video.readyState < 2) return;

  try {
    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 })
      )
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      // No face in frame — soft warning only, do NOT count as an identity mismatch.
      // BlazeFace handles genuine no-face violations separately.
      // Reset mismatch counter so a lighting change doesn't lock in a bad state.
      identityMismatchCount = 0;
      console.log('[IdentityCheck] No face detected — skipping this cycle');
      return;
    }

    // Check for multiple faces via a full multi-detection pass (fast at 224px)
    const allDetections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.45 })
    );

    if (allDetections.length >= 2) {
      handleIdentityResult(false, null, 'multiple_faces');
      return;
    }

    // Compute Euclidean distance between live face and reference
    const distance = faceapi.euclideanDistance(referenceDescriptor, detection.descriptor);
    const matched  = distance <= FACE_MATCH_THRESHOLD;

    console.log(`[IdentityCheck] dist=${distance.toFixed(3)} matched=${matched}`);
    handleIdentityResult(matched, distance, matched ? 'ok' : 'mismatch');

  } catch (e) {
    console.warn('[IdentityCheck] error:', e.message);
  }
}

/**
 * Process the result of one identity check cycle.
 * @param {boolean}      matched   - true if distance ≤ threshold
 * @param {number|null}  distance  - Euclidean distance (null if no face)
 * @param {string}       reason    - 'ok' | 'mismatch' | 'no_face' | 'multiple_faces'
 */
function handleIdentityResult(matched, distance, reason) {
  if (examSubmitted) return;

  if (matched) {
    // Good match — reset mismatch counter
    identityMismatchCount     = 0;
    identityViolationPending  = false;
    return;
  }

  // Bad match — increment counter
  identityMismatchCount++;

  const reasonLabels = {
    mismatch:       'Face mismatch — different person detected',
    no_face:        'No face detected during identity check',
    multiple_faces: 'Multiple faces detected — possible impersonation',
  };
  const label = reasonLabels[reason] || 'Identity check failed';

  console.warn(`[IdentityCheck] MISMATCH #${identityMismatchCount}/${IDENTITY_MAX_MISMATCHES}: ${label}`);

  if (identityMismatchCount >= IDENTITY_MAX_MISMATCHES) {
    // Maximum mismatches — capture evidence, show fail screen, force auto-submit
    if (!identityViolationPending) {
      identityViolationPending = true;
      const snapshot = captureFrameNow();
      recordIdentityViolation(label, snapshot); // also checks maxV internally
      showIdentityFailScreen();
      // FIX 6: don't wait 3.5s for the auto-submit — trigger it directly
      // recordIdentityViolation calls autoSubmit if maxV reached.
      // This setTimeout is a safety net in case violationCount didn't hit maxV yet.
      setTimeout(() => autoSubmit('Identity verification failed after multiple checks'), 2000);
    }
  } else if (reason === 'mismatch' && !identityViolationPending) {
    // Clear face mismatch = different person confirmed — auto-submit immediately
    identityViolationPending = true;
    const snapshot = captureFrameNow();
    recordViolation(`[IDENTITY] ${label}`, 'rule_violation', 'face', snapshot);
    // Don't wait — force submit right away on confirmed identity mismatch
    setTimeout(() => autoSubmit('Identity mismatch — different person detected'), 1500);
  } else if (!identityViolationPending) {
    // Intermediate mismatch (no_face / multiple_faces during identity check)
    identityViolationPending = true;
    const snapshot = captureFrameNow();
    recordViolation(`[IDENTITY] ${label}`, 'rule_violation', 'face', snapshot);
    setTimeout(() => { identityViolationPending = false; }, 4000);
  }
}

/** Async — upload violation evidence + save to DB. */
async function recordIdentityViolation(reason, snapshot) {
  violationCount++;
  const maxV = examSettings.max_violations || 3;

  // Update violation pill in topbar
  const violCount = document.getElementById('violPillCount');
  if (violCount) violCount.textContent = violationCount;
  const violPill = document.getElementById('violPill');
  if (violPill) {
    violPill.style.background  = violationCount >= maxV ? 'rgba(220,38,38,0.35)' : 'rgba(234,179,8,0.25)';
    violPill.style.color       = violationCount >= maxV ? '#fca5a5' : '#fef08a';
    violPill.style.borderColor = violationCount >= maxV ? 'rgba(220,38,38,0.6)' : 'rgba(234,179,8,0.5)';
    violPill.style.transform   = 'scale(1.15)';
    setTimeout(() => { violPill.style.transform = 'scale(1)'; }, 300);
  }

  const cap = snapshot || await captureViolationSnapshot();
  if (sessionId) {
    try {
      await fetch('/api/record-violation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_id:     sessionId,
          reason:         `[IDENTITY] ${reason}`,
          count:          violationCount,
          violation_type: 'rule_violation',
          sub_type:       'face',
          capture_data:   cap
        })
      });
    } catch (e) { /* offline — violation still counted locally */ }
  }

  // FIX 1: Check max violations AFTER uploading evidence
  if (violationCount >= maxV) {
    autoSubmit(`Maximum violations (${maxV}) reached — identity failure.`);
  }
}

/** Fullscreen danger modal — shown when exam is auto-submitted due to identity failure. */
function showIdentityFailScreen() {
  // Remove any existing
  const existing = document.getElementById('identityFailOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'identityFailOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:rgba(10,5,5,0.98);
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:20px;padding:30px;text-align:center;
    animation:identFadeIn .4s ease;
  `;

  if (!document.getElementById('identFailStyle')) {
    const st = document.createElement('style');
    st.id = 'identFailStyle';
    st.textContent = `
      @keyframes identFadeIn { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
      @keyframes identPulse   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.08)} }
    `;
    document.head.appendChild(st);
  }

  overlay.innerHTML = `
    <div style="display:flex;justify-content:center;margin-bottom:8px;"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:identPulse 1.5s ease-in-out infinite;"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>
    <div style="
      color:#ef4444;font-size:22px;font-weight:900;line-height:1.3;
      max-width:400px;text-shadow:0 0 24px rgba(239,68,68,.4);
    ">Identity Verification Failed</div>
    <div style="
      color:#fca5a5;font-size:14px;max-width:380px;
      line-height:1.8;background:rgba(239,68,68,.08);
      border:1px solid rgba(239,68,68,.2);border-radius:14px;
      padding:16px 20px;
    ">
      Your face could not be matched to the registered student photo after
      multiple checks. Your exam has been submitted and a violation has been
      recorded.
    </div>
    <div style="
      color:#8e92b3;font-size:12px;letter-spacing:.5px;font-weight:600;
    "><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/></svg> Submitting exam…</div>
  `;
  document.body.appendChild(overlay);
}

/**
 * Yellow warning toast — shown on each intermediate mismatch (before max reached).
 * Different from the red violation banner — softer colour, identity-specific copy.
 */
function showWarningToast(msg) {
  // Remove stale toast
  const old = document.getElementById('identityWarnToast');
  if (old) old.remove();

  const toast = document.createElement('div');
  toast.id    = 'identityWarnToast';
  toast.style.cssText = `
    position:fixed;top:16px;left:50%;transform:translateX(-50%);
    z-index:99998;
    background:linear-gradient(135deg,#78350f,#d97706);
    color:#fff;
    padding:12px 22px;border-radius:14px;
    font-family:'DM Sans',system-ui,sans-serif;
    font-size:13px;font-weight:800;
    box-shadow:0 4px 20px rgba(0,0,0,.35);
    white-space:nowrap;
    animation:identWarnIn .3s ease;
    pointer-events:none;
  `;

  if (!document.getElementById('identWarnStyle')) {
    const st = document.createElement('style');
    st.id = 'identWarnStyle';
    st.textContent = `@keyframes identWarnIn{from{opacity:0;top:4px}to{opacity:1;top:16px}}`;
    document.head.appendChild(st);
  }

  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 5000);
}

/**
 * Green success toast — used by face-capture.html result to confirm verification
 * when the exam page first loads (reads sessionStorage flag set by face-capture.html).
 */
function showSuccessToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;top:16px;left:50%;transform:translateX(-50%);
    z-index:99998;
    background:linear-gradient(135deg,#14532d,#16a34a);
    color:#fff;
    padding:12px 22px;border-radius:14px;
    font-family:'DM Sans',system-ui,sans-serif;
    font-size:13px;font-weight:800;
    box-shadow:0 4px 20px rgba(0,0,0,.35);
    white-space:nowrap;pointer-events:none;
    animation:identWarnIn .3s ease;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

/**
 * Show a red error modal (generic — can be called from other parts of the system).
 * @param {string} title
 * @param {string} message
 */
function showErrorModal(title, message) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999998;
    background:rgba(0,0,0,.88);
    display:flex;align-items:center;justify-content:center;padding:24px;
  `;
  overlay.innerHTML = `
    <div style="
      background:#1a0808;border:1px solid rgba(239,68,68,.35);
      border-radius:22px;padding:32px 28px;max-width:360px;
      width:100%;text-align:center;
      box-shadow:0 0 50px rgba(239,68,68,.15);
    ">
      <div style="display:flex;justify-content:center;margin-bottom:14px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg></div>
      <div style="color:#ef4444;font-size:20px;font-weight:900;margin-bottom:12px;">${title}</div>
      <div style="color:#fca5a5;font-size:13px;line-height:1.7;">${message}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 8000);
}

// ═══════════════════════════════════════════════
// * FACE ANTI-CHEAT ENGINE (BlazeFace / TF.js)
// ═══════════════════════════════════════════════

async function initFaceAntiCheat() {
  // FIX 1: Proper async/await — no more .then() so caller actually waits
  // for model to load before proceeding. Critical on slow Android connections.
  try {
    await loadFaceScripts();
    try {
      await tf.setBackend('webgl'); await tf.ready();
    } catch(_) {
      try { await tf.setBackend('wasm'); await tf.ready(); }
      catch(__) { await tf.setBackend('cpu'); await tf.ready(); }
    }
    console.log('[ICBT] TF backend:', tf.getBackend());
    blazeFaceModel = await blazeface.load();
    faceEngineReady = true;
    console.log('[OK] BlazeFace model loaded — AI proctoring active');
    showFaceEngineToast('AI Proctoring Active', '#0f6b30');
    _examStartTime = Date.now(); // reset start time to when engine is actually ready
    faceDetectionRunning = true;
    requestAnimationFrame(runFaceDetection);
  } catch(e) {
    console.warn('[ICBT] Face anti-cheat load attempt failed:', e);
    // Retry up to 3 times with increasing delay (handles bad/slow network)
    if (!initFaceAntiCheat._retries) initFaceAntiCheat._retries = 0;
    if (initFaceAntiCheat._retries < 3) {
      initFaceAntiCheat._retries++;
      const delay = initFaceAntiCheat._retries * 4000; // 4s, 8s, 12s
      showFaceEngineToast(`AI Proctoring retrying (${initFaceAntiCheat._retries}/3)...`, '#d97706');
      setTimeout(() => initFaceAntiCheat(), delay);
    } else {
      initFaceAntiCheat._retries = 0;
      showFaceEngineToast('AI Proctoring unavailable', '#dc2626');
    }
  }
}

function loadFaceScripts() {
  return new Promise((resolve, reject) => {
    // * FIX: exam-page.html preloads TF.js + BlazeFace in <head>.
    // If they're already present, resolve immediately — no re-injection.
    if (window.tf && window.blazeface) {
      console.log('[ICBT] TF.js + BlazeFace already loaded (preloaded in <head>)');
      resolve();
      return;
    }

    // Wait for a global to appear on window (polls up to ~15s)
    function waitForGlobal(name, cb, ms = 15000) {
      const start = Date.now();
      (function check() {
        if (window[name]) return cb();
        if (Date.now() - start > ms) {
          console.error(`[ICBT] Timeout waiting for ${name} — CDN may be blocked or network is too slow`);
          return reject(new Error(`Timeout waiting for ${name}`));
        }
        setTimeout(check, 80);
      })();
    }

    function loadScriptWithFallback(primarySrc, fallbackSrc, globalName, cb) {
      if (window[globalName]) { cb(); return; }
      const s1 = document.createElement('script');
      s1.src = primarySrc;
      s1.onload = () => waitForGlobal(globalName, cb);
      s1.onerror = () => {
        console.warn(`[ICBT] ${globalName} primary CDN failed (${primarySrc}) — trying fallback`);
        const s2 = document.createElement('script');
        s2.src = fallbackSrc;
        s2.onload = () => waitForGlobal(globalName, cb);
        s2.onerror = () => {
          console.error(`[ICBT] ${globalName} failed from ALL CDNs. AI proctoring will not work. Check network.`);
          reject(new Error(`${globalName} CDN failed`));
        };
        document.head.appendChild(s2);
      };
      document.head.appendChild(s1);
    }

    function loadBlaze() {
      if (window.blazeface) { resolve(); return; }
      loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js',
        'https://unpkg.com/@tensorflow-models/blazeface@0.0.7/dist/blazeface.min.js',
        'blazeface',
        resolve
      );
    }

    if (window.tf) {
      loadBlaze();
    } else {
      loadScriptWithFallback(
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js',
        'https://unpkg.com/@tensorflow/tfjs@4.10.0/dist/tf.min.js',
        'tf',
        loadBlaze
      );
    }
  });
}

// Throttle + single-instance guard for the rAF detection loop
let _lastFaceDetectTime  = 0;
let _faceDetectionActive = false; // prevents concurrent estimateFaces calls

async function runFaceDetection() {
  // ── Single-instance guard ────────────────────────────────────────────────
  // async rAF fires at 60fps but estimateFaces takes 100–300ms.
  // Without this guard, dozens of concurrent TF calls pile up → WebGL crash.
  if (_faceDetectionActive) {
    if (faceDetectionRunning && !examSubmitted) requestAnimationFrame(runFaceDetection);
    return;
  }
  _faceDetectionActive = true;

  try {
    if (!faceDetectionRunning || examSubmitted) return;

    // Throttle to ~3 real detections/sec (was 500ms — missed quick movements)
    const now = performance.now();
    if (now - _lastFaceDetectTime < 350) return;
    _lastFaceDetectTime = now;

    if (!faceEngineReady || !blazeFaceModel) return;

    const video = document.getElementById('webcamPreview') ||
                  document.getElementById('webcamSide');
    if (!video || !video.srcObject || video.readyState < 2) return;

    // * blazeface@0.0.7 uses POSITIONAL args — do NOT pass an object here.
    // estimateFaces(input, returnTensors, flipHorizontal, annotateBoxes)
    const predictions = await blazeFaceModel.estimateFaces(video, false, false, true);

    // Filter noise: face must be >55×55 px (was 80 — missed distant faces on mobile)
    const validFaces = predictions.filter(f => {
      const w = Math.abs(f.bottomRight[0] - f.topLeft[0]);
      const h = Math.abs(f.bottomRight[1] - f.topLeft[1]);
      return w > 55 && h > 55;
    });

    // Always call handleFaceResult so no-face/multi-face state is tracked
    // even when face_anticheat_enabled is off (needed by side-look & voice).
    handleFaceResult(validFaces.length);

    if (validFaces.length > 0) {
      if (examSettings.restrict_side_look) handleSideLookResult(validFaces[0]);
      if (examSettings.restrict_voice)     handleVoiceResult(validFaces[0]);
    } else {
      if (examSettings.restrict_side_look) clearSideLookTimer();
      if (examSettings.restrict_voice)     clearMouthMoveTimer();
    }

  } catch(e) {
    console.warn('[ICBT] Face detection error (loop continues):', e.message);
  } finally {
    _faceDetectionActive = false;
    if (faceDetectionRunning && !examSubmitted) {
      requestAnimationFrame(runFaceDetection);
    }
  }
}

function handleFaceResult(faceCount) {
  if (examSubmitted) return;

  if (faceCount === 0) {
    // Suppress all violations for 20 seconds after engine starts — camera needs time to stabilise
    if (Date.now() - _examStartTime < 10000) return;
    // Only trigger no-face violation when the feature is enabled
    if (examSettings.face_anticheat_enabled && !noFaceTimer && !faceViolationPending) {
      // Generous grace: mobile cameras lose face on scroll/brightness/focus changes
      const noFaceGrace = isMobile ? 3000 : 2000;
      noFaceTimer = setTimeout(() => {
        noFaceTimer = null;
        if (!examSubmitted && !faceViolationPending) {
          faceViolationPending = true;
          triggerFaceViolation('No face detected');
          setTimeout(() => { faceViolationPending = false; }, 4000);
        }
      }, noFaceGrace);
    }
  } else if (faceCount >= 2) {
    clearNoFaceTimer();
    // Only trigger multiple-face violation when the feature is enabled.
    // Require 3 consecutive frames (~1s) to avoid false positives from
    // background objects or momentary detection noise.
    multiFaceFrames++;
    if (examSettings.face_anticheat_enabled && multiFaceFrames >= 3 && !faceViolationPending) {
      faceViolationPending = true;
      triggerFaceViolation(`Multiple faces detected (${faceCount})`);
      setTimeout(() => { faceViolationPending = false; multiFaceFrames = 0; }, 8000);
    }
  } else {
    // Exactly 1 face — clear counters and warnings
    multiFaceFrames = 0;
    clearNoFaceTimer();
    hideFaceWarning();
  }
}

function clearNoFaceTimer() {
  if (noFaceTimer) {
    clearTimeout(noFaceTimer);
    noFaceTimer = null;
    faceViolationPending = false;
  }
}

// Global cooldown: prevents the same student action from cascading into 3 violations.
// Each detector (face/voice/side-look) has its OWN cooldown too; this is the shared gate.
function canTriggerViolation(cooldownMs = 3000) {
  const now = Date.now();
  if (now - lastViolationAt < cooldownMs) return false;
  lastViolationAt = now;
  return true;
}

function triggerFaceViolation(reason) {
  if (examSubmitted) return;
  if (!isAiMonitoringReliable()) return; // * FIX: suppress AI violations while offline/just reconnected
  if (!canTriggerViolation(3000)) return; // global 3s cooldown
  const frame = captureFrameNow();
  const lower = reason.toLowerCase();
  let subType = 'face';
  if (lower.includes('multiple'))  subType = 'multiple_faces';
  else if (lower.includes('no face')) subType = 'no_face';
  else if (lower.includes('side'))    subType = 'side_look';
  showFaceSevereFlash(reason);
  recordViolation(`[FACE] ${reason}`, 'rule_violation', subType, frame);
}

function showFaceSevereFlash(reason) {
  const existing = document.getElementById('faceFlashOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'faceFlashOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(220,38,38,0.92);
    display:flex;align-items:center;justify-content:center;
    flex-direction:column;gap:16px;
    animation:faceFlash .15s ease 3;
    pointer-events:none;
  `;

  const maxV      = examSettings.max_violations || 3;
  // +1 because showFaceSevereFlash is called BEFORE recordViolation increments the counter
  const nextCount = violationCount + 1;
  const remaining = maxV - nextCount;

  overlay.innerHTML = `
    <div style="display:flex;justify-content:center;margin-bottom:4px;"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
    <div style="
      color:#fff;font-size:22px;font-weight:800;
      text-align:center;padding:0 32px;
      text-shadow:0 2px 8px rgba(0,0,0,0.4);
      max-width:480px;line-height:1.3;
    ">${reason}</div>
    <div style="
      color:rgba(255,255,255,0.85);
      font-size:14px;font-weight:600;
      background:rgba(0,0,0,0.2);
      padding:8px 20px;border-radius:999px;
    ">
      ${remaining > 0
        ? `Violation #${nextCount} of ${maxV} · ${remaining} warning${remaining === 1 ? '' : 's'} remaining`
        : 'Final violation — Auto-submitting exam…'
      }
    </div>
  `;

  if (!document.getElementById('faceFlashStyle')) {
    const style = document.createElement('style');
    style.id    = 'faceFlashStyle';
    style.textContent = `
      @keyframes faceFlash {
        0%  { opacity:1; }
        50% { opacity:0.4; }
        100%{ opacity:1; }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3500);
}

function showFaceWarningFlash(msg, color = '#f59e0b') {
  let banner = document.getElementById('faceWarningBanner');
  if (!banner) {
    banner    = document.createElement('div');
    banner.id = 'faceWarningBanner';
    banner.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:99998;
      padding:10px 20px;text-align:center;
      font-size:14px;font-weight:700;color:#fff;
      transition:background .3s;
    `;
    document.body.appendChild(banner);
  }
  banner.style.background = color;
  banner.style.display    = 'block';
  banner.textContent      = msg;
}

function hideFaceWarning() {
  const banner = document.getElementById('faceWarningBanner');
  if (banner) banner.style.display = 'none';
}

function showFaceEngineToast(msg, bg = '#0f6b30') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position:fixed;bottom:80px;right:16px;z-index:9990;
    background:${bg};color:#fff;
    padding:8px 16px;border-radius:10px;
    font-size:12px;font-weight:700;
    box-shadow:0 4px 12px rgba(0,0,0,0.2);
    opacity:1;transition:opacity .5s;
    pointer-events:none;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  setTimeout(() => toast.remove(), 3600);
}

function stopFaceAntiCheat() {
  // Signal the rAF loop to stop (finally{} checks this flag)
  faceDetectionRunning = false;
  faceDetectInterval   = null;   // legacy — no longer a setInterval handle
  if (identityCheckTimer) clearInterval(identityCheckTimer);
  identityCheckTimer = null;
  clearNoFaceTimer();
  clearSideLookTimer();
  clearMouthMoveTimer();
  stopMouthRecording(false); // discard any in-progress clip
  hideFaceWarning();
  faceEngineReady = false;
}

// ═══════════════════════════════════════════════════════
// * SIDE-LOOK DETECTION ENGINE
// ═══════════════════════════════════════════════════════

function handleSideLookResult(prediction) {
  if (examSubmitted) return;
  if (!examSettings.restrict_side_look) return;

  const lm = prediction.landmarks;
  if (!lm || lm.length < 6) return;

  const rightEye = lm[0];
  const leftEye  = lm[1];
  const nose     = lm[2];

  const faceWidth = Math.abs(prediction.bottomRight[0] - prediction.topLeft[0]);
  if (faceWidth < 20) return; // was 30 — missed small faces from distant cameras

  const eyeSpan  = Math.abs(leftEye[0] - rightEye[0]);
  const eyeRatio = eyeSpan / faceWidth;

  const eyeMidX    = (rightEye[0] + leftEye[0]) / 2;
  const noseOffset = Math.abs(nose[0] - eyeMidX) / faceWidth;

  // Tuned thresholds for BlazeFace on Android/mobile cameras:
  // eyeRatio < 0.20 = ~50° head turn (was 0.18 — rarely triggered on mobile)
  // noseOffset > 0.25 = clear lateral shift (was 0.30 — too lenient)
  const isSideLook = eyeRatio < 0.20 || noseOffset > 0.25;

  if (isSideLook) {
    sideLookFrames++;
    // Capture the frame on the VERY FIRST detected frame so the head is still fully turned
    if (sideLookFrames === 1) {
      sideLookEarlyFrame = captureFrameNow();
    }
    if (sideLookFrames >= 2 && !sideLookPending) {
      sideLookPending = true;
      triggerSideLookViolation(sideLookEarlyFrame);
      setTimeout(() => { sideLookPending = false; sideLookFrames = 0; sideLookEarlyFrame = null; }, 5000); // was 10s — re-detect faster
    }
  } else {
    sideLookFrames     = 0;
    sideLookEarlyFrame = null;
    sideLookPending    = false;
    if (!examSettings.restrict_voice || !mouthMovePending) hideFaceWarning();
  }
}

function clearSideLookTimer() {
  if (sideLookTimer) { clearTimeout(sideLookTimer); sideLookTimer = null; }
  sideLookPending    = false;
  sideLookFrames     = 0;
  sideLookEarlyFrame = null;
}

function triggerSideLookViolation(preFrame) {
  if (examSubmitted) return;
  if (!isAiMonitoringReliable()) return; // * FIX: suppress AI violations while offline/just reconnected
  if (!canTriggerViolation(3000)) return; // global 3s cooldown
  const frame = preFrame || captureFrameNow(); // use early-captured frame; fall back to now
  showFaceSevereFlash('Side look detected — eyes on screen violation!');
  recordViolation('[SIDE LOOK] Student looked away from screen', 'rule_violation', 'side_look', frame);
}

// ═══════════════════════════════════════════════════════
// * VOICE / MOUTH MOVEMENT DETECTION + CLIP RECORDING
// Uses BlazeFace mouth landmark to detect sustained lip movement.
// When mouth movement is detected the webcam stream is recorded.
// The clip is attached to the violation sent to the admin page.
// ═══════════════════════════════════════════════════════

let prevNoseToMouth   = null;        // nose-to-mouth distance ratio (only changes when jaw opens)
let mouthMoveFrames  = 0;  // consecutive frames above threshold
let mouthMissFrames  = 0;  // consecutive below-threshold frames (grace buffer)
// Uses nose-to-mouth DISTANCE RATIO instead of absolute mouthY so head bobbing while
// reading doesn't trigger it — only actual jaw-open talking changes this ratio.
// Raise VOICE_THRESHOLD so minor head movements / breathing don't trigger.
// 0.055 requires a clear jaw-open motion; 0.040 was too sensitive on mobile (false positives from typing vibration / breathing).
// Increase VOICE_FRAMES_NEEDED to 7 (~2.5s) so a quick twitch or single breath never fires.
const VOICE_THRESHOLD      = 0.055;
const VOICE_FRAMES_NEEDED  = 7;

function handleVoiceResult(prediction) {
  if (examSubmitted) return;
  if (!examSettings.restrict_voice) {
    // Clear stale state so a leftover prevNoseToMouth can't fire a ghost delta
    // on the frame immediately after restrict_voice gets re-enabled.
    prevNoseToMouth = null;
    return;
  }

  const lm = prediction.landmarks;
  if (!lm || lm.length < 4) return;

  // BlazeFace landmarks: index 2 = nose tip, index 3 = mouth centre
  const noseY  = lm[2][1];
  const mouthY = lm[3][1];
  const faceH  = Math.abs(prediction.bottomRight[1] - prediction.topLeft[1]);
  if (faceH < 30) return;

  // Nose-to-mouth distance normalised by face height.
  // This ratio is stable when the head bobs up/down (both points move together)
  // but increases measurably when the student opens their jaw to talk.
  const noseToMouth = Math.abs(mouthY - noseY) / faceH;

  if (prevNoseToMouth !== null) {
    const delta = Math.abs(noseToMouth - prevNoseToMouth);

    if (delta > VOICE_THRESHOLD) {
      mouthMissFrames = 0; // clear grace counter — mouth is actively moving
      mouthMoveFrames++;

      // Start recording at frame 2 so the full talking episode is captured
      if (mouthMoveFrames === 2 && !mouthRecordingActive) {
        startMouthRecording();
      }

      if (mouthMoveFrames === VOICE_FRAMES_NEEDED && !mouthMovePending) {
        mouthMovePending = true;
        triggerVoiceViolation();
        setTimeout(() => {
          mouthMovePending = false;
          mouthMoveFrames  = 0;
        }, 15000); // 15s cooldown prevents one talking episode from cascading into 3 violations
      }
    } else {
      // Allow 1 grace miss frame so brief pauses mid-word don't wipe the counter.
      // Only reset after 2 consecutive quiet frames.
      mouthMissFrames++;
      if (mouthMissFrames >= 2) {
        if (mouthMoveFrames > 0) {
          stopMouthRecording(/* saveClip= */ false); // no violation yet — discard clip
        }
        mouthMoveFrames = 0;
        mouthMissFrames = 0;
        clearMouthMoveTimer();
        if (!examSettings.restrict_side_look || !sideLookPending) hideFaceWarning();
      }
    }
  }

  prevNoseToMouth = noseToMouth;
}

/**
 * Start recording the webcam stream into mouthRecordedChunks.
 * Called as soon as sustained mouth movement is detected (early, so
 * the clip captures the full talking episode including the start).
 */
function startMouthRecording() {
  if (mouthRecordingActive || !webcamStream) return;
  try {
    // Pick best supported video MIME type
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    mouthRecordedChunks  = [];
    mouthRecordingActive = true;
    mouthMediaRecorder   = new MediaRecorder(webcamStream, mime ? { mimeType: mime } : {});

    mouthMediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) mouthRecordedChunks.push(e.data);
    };

    mouthMediaRecorder.start(200); // collect chunks every 200ms

    // Safety cap: force-stop after 20s so memory doesn't grow unbounded
    mouthRecordingTimer = setTimeout(() => stopMouthRecording(true), 20000);
    console.log('[MouthRec] Recording started');
  } catch(e) {
    console.warn('[MouthRec] Failed to start MediaRecorder:', e.message);
    mouthRecordingActive = false;
  }
}

/**
 * Stop the active mouth recording.
 * @param {boolean} saveClip — if true, convert blob → base64 and return it via Promise.
 * @returns {Promise<string|null>}
 */
function stopMouthRecording(saveClip = true) {
  return new Promise(resolve => {
    if (mouthRecordingTimer) { clearTimeout(mouthRecordingTimer); mouthRecordingTimer = null; }

    if (!mouthRecordingActive || !mouthMediaRecorder) {
      mouthRecordingActive = false;
      resolve(null);
      return;
    }

    mouthRecordingActive = false;

    if (!saveClip) {
      try { mouthMediaRecorder.stop(); } catch(e) {}
      mouthMediaRecorder  = null;
      mouthRecordedChunks = [];
      resolve(null);
      return;
    }

    mouthMediaRecorder.onstop = () => {
      try {
        const blob = new Blob(mouthRecordedChunks, { type: mouthMediaRecorder.mimeType || 'video/webm' });
        mouthRecordedChunks = [];
        mouthMediaRecorder  = null;

        if (blob.size < 1000) { resolve(null); return; } // too small — probably nothing

        // Cap at ~4 MB to keep upload fast
        const MAX = 4 * 1024 * 1024;
        const final = blob.size > MAX ? blob.slice(0, MAX, blob.type) : blob;

        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result); // data:video/webm;base64,...
        reader.onerror   = () => resolve(null);
        reader.readAsDataURL(final);
      } catch(e) {
        console.warn('[MouthRec] Error converting clip:', e.message);
        resolve(null);
      }
    };

    try {
      mouthMediaRecorder.stop();
    } catch(e) {
      mouthMediaRecorder  = null;
      mouthRecordedChunks = [];
      resolve(null);
    }
  });
}

function clearMouthMoveTimer() {
  if (mouthMoveTimer) {
    clearTimeout(mouthMoveTimer);
    mouthMoveTimer   = null;
    mouthMovePending = false;
  }
  prevNoseToMouth = null;
  mouthMoveFrames = 0;
  mouthMissFrames = 0;
}

async function triggerVoiceViolation() {
  if (examSubmitted) return;
  if (!isAiMonitoringReliable()) return; // * FIX: suppress AI violations while offline/just reconnected
  if (!canTriggerViolation(3000)) return; // global 3s cooldown

  // Stop recording and get the clip (mouth is still detected as moving here)
  const videoClip = await stopMouthRecording(true);

  const frame = captureFrameNow(); // still grab a still-frame too
  showFaceSevereFlash('Voice/talking detected — silence violation!');
  recordViolation(
    '[VOICE] Student detected talking/mouthing during exam',
    'rule_violation',
    'voice',
    frame,
    videoClip   // ← new 5th param
  );
}

// ═══════════════════════════════════════════════════════
// INSTRUCTIONS SCREEN
// ═══════════════════════════════════════════════════════

function showInstructionsScreen() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id    = 'instructionsOverlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;
      padding:24px;
    `;

    const examRules    = examSettings.exam_rules || '';
    const examSpecific = examData.instructions   || '';

    let rulesHTML = '';
    if (examRules.trim()) {
      rulesHTML = `
        <div style="
          background:#fffbeb;border:1px solid #fcd34d;
          border-radius:10px;padding:14px 16px;
          margin-bottom:12px;
          font-size:13px;color:#92400e;
          line-height:1.7;text-align:left;
        "><strong>Exam Rules:</strong><br>${examRules.replace(/\n/g,'<br>')}</div>
      `;
    }

    const mainInstructions = examSpecific || defaultInstructions();

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:20px;
        max-width:580px;width:100%;
        padding:36px 32px;text-align:center;
        box-shadow:0 25px 60px rgba(0,0,0,0.4);
        max-height:90vh;overflow-y:auto;
      ">
        <div style="display:flex;justify-content:center;margin-bottom:12px;"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1f2170" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
        <h2 style="font-size:20px;font-weight:800;color:#0f6b30;margin-bottom:8px;">
          Exam Instructions
        </h2>
        <p style="font-size:13px;color:#5b5f80;margin-bottom:20px;">
          ${examData.title} &nbsp;·&nbsp; ${examData.duration} minutes
        </p>
        ${rulesHTML}
        <div style="
          background:#f6f7fc;border:1px solid #e6e8f3;
          border-radius:12px;padding:18px 20px;
          text-align:left;font-size:14px;color:#374151;
          line-height:1.8;margin-bottom:24px;
          max-height:260px;overflow-y:auto;
        ">${mainInstructions}</div>
        <button id="startExamBtn" style="
          background:#0f6b30;color:#fff;border:none;
          border-radius:12px;padding:14px 40px;
          font-size:15px;font-weight:700;cursor:pointer;
          box-shadow:0 4px 15px rgba(15,107,48,0.3);
        ">I Understand — Start Exam</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('startExamBtn').addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

function defaultInstructions() {
  return `
    <strong>Before you begin:</strong><br>
    • Ensure you have a stable internet connection.<br>
    • Do not switch tabs or minimize the browser — this will be recorded as a violation.<br>
    • Do not press F12, Ctrl+U, or attempt to copy/paste.<br>
    • The exam will auto-submit when time runs out.<br>
    • After ${examSettings.max_violations} violations, your exam will be auto-submitted.<br><br>
    <strong>During the exam:</strong><br>
    • Click on an option to select your answer.<br>
    • Use the question grid to navigate between questions.<br>
    • Use the Flag button to mark questions for review.<br>
    • Click <em>Submit</em> when you are done.
  `;
}

function applyPrevButtonSetting() {
  const prevBtn = document.getElementById('prevBtn');
  if (!prevBtn) return;
  if (!examSettings.allow_prev_question) prevBtn.style.display = 'none';
}

async function loadQuestions() {
  try {
    const examId = getExamId();
    if (!examId) {
      alert('Exam data missing. Please go back and try again.');
      window.location.href = 'exam-access.html';
      return;
    }
    const faceToken = sessionStorage.getItem('faceToken') || '';
    const res  = await fetch(`/api/exam-questions?exam_id=${examId}&student_id=${student.id}&face_token=${encodeURIComponent(faceToken)}`);
    const data = await res.json();
    if (data.success) {
      questions = data.questions;
      sessionId = data.session_id;
      sessionStorage.setItem('examSessionId', sessionId);

      // * Clear ALL stale exam_progress keys — including the current session —
      //   so a retake always starts with a blank slate. The server's savedAnswers
      //   (returned in data.savedAnswers) are the only authoritative restore source.
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith('exam_progress_'))
          .forEach(k => localStorage.removeItem(k));
      } catch(e) {}

      // Restore previously saved answers if session was reused (page reload recovery)
      if (data.savedAnswers && Object.keys(data.savedAnswers).length) {
        Object.assign(answers, data.savedAnswers);
      }
      // Also check localStorage for any answers saved offline.
      // * FIX: in-memory answers (already set above) win over stale localStorage.
      //    Old code had Object.assign(answers, saved) which let localStorage OVERWRITE
      //    freshly clicked answers. Correct order: saved fills gaps, answers wins conflicts.
      try {
        const stored = localStorage.getItem(`exam_progress_${sessionId}`);
        if (stored) {
          const saved = JSON.parse(stored).answers || {};
          answers = { ...saved, ...answers }; // in-memory answers WIN
        }
      } catch(e) {}
      renderQuestion(0);
      buildQGrid();
    } else if (data.face_verify_required) {
      // Server rejected entry because face token is missing or expired.
      // Redirect student back to face-capture to re-verify.
      alert('Identity verification is required to enter this exam. You will be redirected to complete face verification.');
      window.location.href = 'face-capture.html';
    } else {
      alert('Failed to load questions: ' + data.message);
    }
  } catch(e) {
    // Show inline error with retry — don't just alert() and leave blank screen
    const qText = document.getElementById('questionText');
    if (qText) {
      qText.innerHTML = `
        <div style="text-align:center;padding:32px 16px;">
          <div style="margin-bottom:12px;display:flex;justify-content:center;"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#5b5f80" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6s4-4 11-4 11 4 11 4"/><path d="M5 10s2.5-2.5 7-2.5 7 2.5 7 2.5"/><path d="M9 14s1-1 3-1 3 1 3 1"/><line x1="12" y1="18" x2="12.01" y2="18" stroke-width="3"/></svg></div>
          <div style="font-weight:800;color:#dc2626;font-size:16px;margin-bottom:8px;">Failed to load questions</div>
          <div style="font-size:13px;color:#5b5f80;margin-bottom:20px;">${e.message || 'Network error. Check your connection.'}</div>
          <button onclick="loadQuestions()" style="
            background:#0f6b30;color:#fff;border:none;border-radius:10px;
            padding:12px 28px;font-size:14px;font-weight:700;cursor:pointer;">
            Retry
          </button>
        </div>`;
    }
  }
}

// * Shuffle questions in-place (used on violation)
function reshuffleQuestions() {
  const savedAnswers = { ...answers };
  const currentQid   = questions[currentQ]?.id; // remember current question
  questions          = shuffleArray([...questions]);
  answers            = savedAnswers; // keyed by qid — survives reorder

  // Stay on the same question after reshuffle — find its new index
  const newIndex = questions.findIndex(q => q.id === currentQid);
  currentQ = newIndex >= 0 ? newIndex : 0;

  buildQGrid();
  renderQuestion(currentQ);
  saveProgress();
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderQuestion(index) {
  currentQ = index;
  const q  = questions[index];
  if (!q) {
    const qText = document.getElementById('questionText');
    if (qText) qText.textContent = 'Question could not be loaded. Please refresh.';
    return;
  }

  const qid = q.id;

  document.getElementById('questionNum').textContent   = `QUESTION ${index + 1}`;
  document.getElementById('questionText').innerHTML    = q.question; // innerHTML for math/HTML
  document.getElementById('progressLabel').textContent = `Question ${index + 1} of ${questions.length}`;

  const answeredCount = Object.keys(answers).length;
  document.getElementById('answeredLabel').textContent = `${answeredCount} answered`;
  document.getElementById('progressBar').style.width   = `${((index + 1) / questions.length) * 100}%`;

  const optList = document.getElementById('optionsList');
  optList.innerHTML = '';

  const isTrueFalse = q.question_type === 'true_false';

  if (isTrueFalse) {
    // Render True/False as two large styled buttons side-by-side
    optList.style.display = 'grid';
    optList.style.gridTemplateColumns = '1fr 1fr';
    optList.style.gap = '12px';

    const tfOpts = [
      { key: 'A', label: q.optionA || 'True',  emoji: '', base: '#166534', light: '#dcfce7', border: '#16a34a' },
      { key: 'B', label: q.optionB || 'False', emoji: '', base: '#991b1b', light: '#fee2e2', border: '#dc2626' }
    ];

    tfOpts.forEach(opt => {
      const isSelected = answers[qid] === opt.key;
      const div = document.createElement('div');
      div.style.cssText = `
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:8px;padding:22px 12px;border-radius:12px;cursor:pointer;
        border:2.5px solid ${isSelected ? opt.border : '#e6e8f3'};
        background:${isSelected ? opt.light : '#fff'};
        transition:all .18s ease;user-select:none;
        -webkit-tap-highlight-color:transparent;
      `;
      div.innerHTML = `
        <span style="font-size:32px;line-height:1;">${opt.emoji}</span>
        <span style="font-size:17px;font-weight:800;color:${isSelected ? opt.base : '#374151'};">
          ${opt.label}
        </span>
      `;
      div.onclick = () => selectAnswer(qid, opt.key);
      optList.appendChild(div);
    });
  } else {
    // Reset grid for multiple choice
    optList.style.display = '';
    optList.style.gridTemplateColumns = '';
    optList.style.gap = '';

    const opts = [
      { key: 'A', text: q.optionA },
      { key: 'B', text: q.optionB },
      { key: 'C', text: q.optionC },
      { key: 'D', text: q.optionD }
    ];

    opts.forEach(opt => {
      const div        = document.createElement('div');
      const isSelected = answers[qid] === opt.key;
      div.className    = 'option-item' + (isSelected ? ' selected' : '');
      div.onclick      = () => selectAnswer(qid, opt.key);
      div.innerHTML    = `
        <div class="option-letter">${opt.key}</div>
        <div class="option-text">${opt.text}</div>
      `;
      optList.appendChild(div);
    });
  }

  // Render math expressions if KaTeX auto-render is available
  if (window.renderMathInElement) {
    try {
      renderMathInElement(document.getElementById('questionText'), {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false }
        ], throwOnError: false
      });
      optList.querySelectorAll('.option-text').forEach(el => {
        renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$',  right: '$',  display: false }
          ], throwOnError: false
        });
      });
    } catch(e) {}
  }

  const prevBtn = document.getElementById('prevBtn');
  if (prevBtn) {
    if (!examSettings.allow_prev_question) {
      prevBtn.style.display = 'none';
    } else {
      prevBtn.style.display = '';
      prevBtn.disabled      = index === 0;
    }
  }

  document.getElementById('nextBtn').textContent = index === questions.length - 1 ? 'Submit' : 'Next →';
  document.getElementById('nextBtn').onclick     = index === questions.length - 1 ? confirmSubmit : nextQuestion;
  document.getElementById('flagBtn').textContent = flagged.has(qid) ? 'Flagged' : 'Flag';

  updateQGrid();
}

function selectAnswer(questionId, answer) {
  answers[questionId] = answer;
  renderQuestion(currentQ);
  saveProgress();
}

function nextQuestion()      { if (currentQ < questions.length - 1) renderQuestion(currentQ + 1); }
function prevQuestion()      { if (!examSettings.allow_prev_question) return; if (currentQ > 0) renderQuestion(currentQ - 1); }
function goToQuestion(index) { renderQuestion(index); }

function flagQuestion() {
  const qid = questions[currentQ]?.id;
  if (!qid) return;
  if (flagged.has(qid)) flagged.delete(qid);
  else flagged.add(qid);
  renderQuestion(currentQ);
}

function buildQGrid() {
  ['sideQGrid', 'mobileQGrid'].forEach(id => {
    const grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = '';
    questions.forEach((q, i) => {
      const btn       = document.createElement('button');
      btn.className   = 'q-btn';
      btn.textContent = i + 1;
      btn.id          = `qbtn-${id}-${i}`;
      btn.onclick     = () => goToQuestion(i);
      grid.appendChild(btn);
    });
  });
}

function updateQGrid() {
  questions.forEach((q, i) => {
    const qid = q.id;
    ['sideQGrid', 'mobileQGrid'].forEach(id => {
      const btn = document.getElementById(`qbtn-${id}-${i}`);
      if (!btn) return;
      btn.className = 'q-btn' +
        (answers[qid] ? ' answered' : '') +
        (flagged.has(qid) ? ' flagged' : '') +
        (i === currentQ ? ' current' : '');
      btn.title = flagged.has(qid) ? 'Flagged for review' : '';
    });
  });
  const answeredCount = Object.keys(answers).length;
  const flaggedCount  = flagged.size;
  const mobileCount   = document.getElementById('mobileAnsweredCount');
  if (mobileCount) mobileCount.textContent = `${answeredCount} of ${questions.length} answered`;
  const mobileFlagged = document.getElementById('mobileFlaggedCount');
  const mobileFlagNum = document.getElementById('mobileFlaggedNum');
  if (mobileFlagged && mobileFlagNum) {
    mobileFlagNum.textContent = flaggedCount;
    mobileFlagged.style.display = flaggedCount > 0 ? 'block' : 'none';
  }
}

function startTimer(seconds) {
  timeRemaining = seconds;
  updateTimerDisplay();
  let warned10 = false;
  let warned5  = false;
  timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay();

    // ── Timer warnings ─────────────────────────────────────
    if (!warned10 && timeRemaining <= 600 && timeRemaining > 599) {
      warned10 = true;
      showTimerWarning('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> 10 minutes remaining!', 'warning');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
    if (!warned5 && timeRemaining <= 300 && timeRemaining > 299) {
      warned5 = true;
      showTimerWarning('Only 5 minutes left! Wrap up now.', 'danger');
      if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
    }

    if (timeRemaining <= 0) {
      clearInterval(timerInterval);
      autoSubmit('Time is up!');
    }
  }, 1000);
}

function showTimerWarning(msg, level) {
  // Remove any existing timer warning
  const existing = document.getElementById('timerWarnBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'timerWarnBanner';
  const bg = level === 'danger' ? 'linear-gradient(135deg,#7f1d1d,#dc2626)' : 'linear-gradient(135deg,#78350f,#d97706)';
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;z-index:100001;
    background:${bg};color:#fff;
    padding:12px 20px;text-align:center;
    font-family:'DM Sans',system-ui,sans-serif;
    font-size:15px;font-weight:800;
    box-shadow:0 4px 20px rgba(0,0,0,.3);
    animation:slideDown .3s ease;
  `;
  banner.textContent = msg;
  document.body.appendChild(banner);
  // Auto-dismiss after 6s
  setTimeout(() => {
    if (banner.parentNode) {
      banner.style.animation = 'slideUp .3s ease forwards';
      setTimeout(() => banner.remove(), 320);
    }
  }, 6000);
}

function updateTimerDisplay() {
  const m       = Math.floor(timeRemaining / 60).toString().padStart(2, '0');
  const s       = (timeRemaining % 60).toString().padStart(2, '0');
  const display = document.getElementById('timerDisplay');
  if (!display) return;
  display.textContent = `${m}:${s}`;
  display.className   = 'timer-display';
  if      (timeRemaining <= 60)  display.classList.add('danger');
  else if (timeRemaining <= 300) display.classList.add('warning');
}

function setupAntiCheat() {
  // Tab switch detection (handled in setupStrictFullscreen for fullscreen)
  if (!examSettings.fullscreen_enabled) {
    // * FIX: Same debounce for mobile in the non-fullscreen path
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !examSubmitted) {
        if (isMobile) {
          visibilityHideAt = Date.now();
          setTimeout(() => {
            if (document.hidden && !examSubmitted && visibilityHideAt) {
              visibilityHideAt = null;
              recordViolation('Tab switch detected', 'rule_violation', 'tab_switch');
            }
          }, 1500);
        } else {
          recordViolation('Tab switch detected', 'rule_violation', 'tab_switch');
        }
      } else if (!document.hidden) {
        visibilityHideAt = null;
      }
    });
  }

  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (examSubmitted) return;
    const blocked = (
      (e.ctrlKey && ['c','v','u','a','s'].includes(e.key.toLowerCase())) ||
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && ['i','j','c'].includes(e.key.toLowerCase()))
    );
    if (blocked) { e.preventDefault(); }
  });

  document.addEventListener('copy',  e => e.preventDefault());
  document.addEventListener('paste', e => e.preventDefault());
  document.addEventListener('cut',   e => e.preventDefault());

  // ─── Real-time network monitoring ───────────────────────────────
  setupNetworkMonitoring();
}

// ── helpers ──────────────────────────────────────────────────────────
function setNetPill(state, label) {
  const pill  = document.getElementById('netPillTopbar');
  const dot   = document.getElementById('netPillDot');
  const lbl   = document.getElementById('netPillLabel');
  if (!pill) return;

  const styles = {
    online:  { bg:'#14532d', color:'#bbf7d0', dotColor:'#4ade80', anim:'none' },
    offline: { bg:'#7f1d1d', color:'#fecaca', dotColor:'#f87171', anim:'netDotPulse 1s infinite' },
    syncing: { bg:'#14163f', color:'#cfd1fa', dotColor:'#9ea2f0', anim:'netDotPulse .6s infinite' },
  };
  const s = styles[state] || styles.online;
  pill.style.background = s.bg;
  pill.style.color      = s.color;
  dot.style.background  = s.dotColor;
  dot.style.animation   = s.anim;
  if (lbl) lbl.textContent = label;
}

function showOfflineSubmitBanner() {
  const banner = document.getElementById('offlineSubmitBanner');
  if (banner) banner.style.display = 'block';
  // Push topbar down so it doesn't overlap
  const topbar = document.getElementById('examTopbar');
  if (topbar) topbar.style.marginTop = '80px';
}

function hideOfflineSubmitBanner() {
  const banner = document.getElementById('offlineSubmitBanner');
  if (banner) banner.style.display = 'none';
  const topbar = document.getElementById('examTopbar');
  if (topbar) topbar.style.marginTop = '';
}

async function checkSyncStatus() {
  const btn        = document.getElementById('checkSyncBtn');
  const statusText = document.getElementById('syncStatusText');
  const progressWrap = document.getElementById('syncProgressWrap');
  const progressBar  = document.getElementById('syncProgressBar');

  if (!sessionId) {
    if (statusText) statusText.textContent = 'No active session.';
    return;
  }

  if (!navigator.onLine) {
    if (statusText) statusText.textContent = 'Still offline';
    setNetPill('offline', 'Offline');
    return;
  }

  btn.textContent = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/></svg> Checking…';
  btn.disabled    = true;
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressBar)  progressBar.style.width = '30%';

  try {
    // Check server if this session has a result already
    const res  = await fetch(`/api/check-submission?session_id=${sessionId}`);
    const data = await res.json();

    if (progressBar) progressBar.style.width = '70%';

    if (data.submitted) {
      // Already on server — done
      if (progressBar) progressBar.style.width = '100%';
      if (statusText) statusText.textContent = 'Synced & submitted!';
      try { localStorage.removeItem(`exam_progress_${sessionId}`); } catch(e) {}
      setTimeout(() => {
        hideOfflineSubmitBanner();
        if (data.result) {
          sessionStorage.setItem('examResult', JSON.stringify(data.result));
          window.location.href = 'results.html';
        }
      }, 1500);
    } else {
      // Not yet on server — attempt sync now
      if (statusText) statusText.textContent = 'Syncing answers…';
      setNetPill('syncing', 'Syncing…');

      const stored = localStorage.getItem(`exam_progress_${sessionId}`);
      if (stored) {
        const saved = JSON.parse(stored);
        const answersToSync = saved.answers || answers;
        const timeTaken = saved.time_taken || saved.timeTaken || (examData ? (examData.duration * 60) - timeRemaining : 0);

        const submitRes  = await fetch('/api/submit-exam', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            session_id: sessionId,
            student_id: student.id,
            exam_id:    getExamId(),
            answers:    answersToSync,
            time_taken: timeTaken
          })
        });
        const submitData = await submitRes.json();

        if (progressBar) progressBar.style.width = '100%';

        if (submitData.success) {
          if (statusText) statusText.textContent = 'Synced & submitted!';
          setNetPill('online', 'Online');
          try { localStorage.removeItem(`exam_progress_${sessionId}`); } catch(e) {}
          offlineSyncPending = false;
          setTimeout(() => {
            hideOfflineSubmitBanner();
            sessionStorage.setItem('examResult', JSON.stringify(submitData.result));
            window.location.href = 'results.html';
          }, 1500);
        } else {
          if (statusText) statusText.textContent = 'Sync failed — try again';
        }
      } else {
        if (statusText) statusText.textContent = 'No saved answers found';
      }
    }
  } catch(e) {
    if (statusText) statusText.textContent = 'Could not reach server';
  }

  btn.textContent = 'Check Sync Status';
  btn.disabled    = false;
  setTimeout(() => { if (progressWrap) progressWrap.style.display = 'none'; }, 2000);
}

function setupNetworkMonitoring() {
  // Set initial state
  if (navigator.onLine) {
    setNetPill('online', 'Online');
  } else {
    setNetPill('offline', 'Offline');
    networkOfflineAt = Date.now();
    isOffline        = true;
    offlineSyncPending = true;
  }

  let _lastNetworkViolationAt = 0; // * FIX: cooldown for network violation log spam
  window.addEventListener('offline', () => {
    if (examSubmitted) {
      // Exam already submitted offline — show banner
      showOfflineSubmitBanner();
      return;
    }
    isOffline        = true;
    networkOfflineAt = Date.now();
    offlineSyncPending = true;
    setNetPill('offline', 'Offline');
    // * FIX: Throttle network violation logging — only log once per 30s to prevent
    // flapping connections from piling up fake violations in the admin panel.
    const now = Date.now();
    if (now - _lastNetworkViolationAt > 30000) {
      _lastNetworkViolationAt = now;
      recordViolation('Network disconnected during exam', 'network_error');
    }
  });

  window.addEventListener('online', async () => {
    const duration = networkOfflineAt ? Math.round((Date.now() - networkOfflineAt) / 1000) : 0;
    networkOfflineAt = null;
    isOffline = false;
    networkReconnectedAt = Date.now(); // * FIX: record reconnect time — AI violations suppressed for 5s

    setNetPill('syncing', 'Syncing…');

    // If exam was submitted offline, auto-retry submit now
    if (sessionId) {
      try {
        const stored = localStorage.getItem(`exam_progress_${sessionId}`);
        if (stored) {
          const saved = JSON.parse(stored);
          if (saved.pendingSubmit) {
            setNetPill('syncing', 'Submitting…');
            examSubmitted = false; // allow re-attempt
            await submitExam();
            return;
          }
        }
      } catch(e) {}
    }

    await syncOfflineProgress();

    // Flush any violations that were queued while offline
    if (pendingViolations.length > 0) {
      const toFlush = [...pendingViolations];
      pendingViolations = [];
      try { localStorage.removeItem(`pending_violations_${sessionId}`); } catch(_) {}
      for (const v of toFlush) {
        try {
          await fetch('/api/record-violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(v)
          });
        } catch(_) { pendingViolations.push(v); } // re-queue if still offline
      }
    }

    setNetPill('online', duration > 0 ? `Back online` : 'Online');
    if (duration > 0) recordViolation(`Network reconnected after ${duration}s offline`, 'network_error');
  });

  // Show offline warning inside submit modal when offline
  const submitModal = document.getElementById('submitModal');
  if (submitModal) {
    const observer = new MutationObserver(() => {
      const warn = document.getElementById('submitOfflineWarn');
      if (warn) warn.style.display = !navigator.onLine ? 'block' : 'none';
    });
    observer.observe(submitModal, { attributes: true, attributeFilter: ['class'] });
  }
}

// Capture current webcam frame as base64 JPEG — used as violation evidence
async function captureViolationSnapshot() {
  try {
    const v = document.getElementById('webcamPreview') || document.getElementById('webcamSide');
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = v.videoWidth  || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95); // high quality for evidence
  } catch(e) { return null; }
}

// Synchronous frame grab — call this AT the exact detection moment so the
// image shows the student mid-violation (head turned, mouth open, etc.)
// Returns base64 JPEG string or null. No await needed.
function captureFrameNow() {
  try {
    const v = document.getElementById('webcamPreview') || document.getElementById('webcamSide');
    if (!v || !v.videoWidth || v.readyState < 2) return null;
    const canvas = document.createElement('canvas');
    canvas.width  = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.95); // high quality for face evidence
  } catch(e) { return null; }
}

async function recordViolation(reason, violation_type = 'rule_violation', sub_type = null, preCapture = null, videoClip = null) {
  if (examSubmitted || autoSubmitTriggered) return; // block during countdown too

  // Network errors don't count toward the auto-submit limit
  if (violation_type !== 'network_error') {
    violationCount++;
  }
  const maxV = examSettings.max_violations || 3;

  // Update violation counter pill in topbar
  const violPill  = document.getElementById('violPill');
  const violCount = document.getElementById('violPillCount');
  if (violCount) violCount.textContent = violationCount;
  if (violPill && violation_type !== 'network_error') {
    // Colour-code by severity
    if (violationCount === 0) {
      violPill.style.background = 'rgba(255,255,255,0.1)';
      violPill.style.color      = 'rgba(255,255,255,0.7)';
      violPill.style.borderColor = 'rgba(255,255,255,0.15)';
    } else if (violationCount < maxV) {
      violPill.style.background  = 'rgba(234,179,8,0.25)';
      violPill.style.color       = '#fef08a';
      violPill.style.borderColor = 'rgba(234,179,8,0.5)';
    } else {
      violPill.style.background  = 'rgba(220,38,38,0.35)';
      violPill.style.color       = '#fca5a5';
      violPill.style.borderColor = 'rgba(220,38,38,0.6)';
    }
    // Flash animation
    violPill.style.transform = 'scale(1.15)';
    setTimeout(() => { violPill.style.transform = 'scale(1)'; }, 300);
  }

  console.warn(`VIOLATION [${violation_type}${sub_type ? '/' + sub_type : ''}] #${violationCount}: ${reason}`);

  // Show modern violation banner with count + remaining
  showViolationBanner(reason, violation_type);

  // Use pre-captured frame if provided (face/side-look/voice — grabbed at exact detection moment)
  // Otherwise fall back to async snapshot (tab switch, fullscreen, etc.)
  const capture_data = preCapture || await captureViolationSnapshot();

  // Send to server (with capture and optional video clip attached)
  if (sessionId) {
    const violationPayload = { session_id: sessionId, reason, count: violationCount, violation_type, sub_type, capture_data, video_clip_data: videoClip || null };
    try {
      await fetch('/api/record-violation', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(violationPayload)
      });
    } catch(e) {
      // Offline — queue for retry on reconnect
      pendingViolations.push(violationPayload);
      try { localStorage.setItem(`pending_violations_${sessionId}`, JSON.stringify(pendingViolations)); } catch(_) {}
    }
  }

  // Reshuffle questions after violation if setting is on
  if (examSettings.reshuffle_on_violation && !examSubmitted && questions.length > 1) {
    setTimeout(() => {
      if (!examSubmitted) {
        reshuffleQuestions();
        showViolationBanner('Questions reshuffled due to violation', 'system_error');
      }
    }, 1500);
  }

  // Auto-submit if max violations reached
  if (violationCount >= maxV) {
    autoSubmit(`Maximum violations (${maxV}) reached.`);
  }
}

function autoSubmit(reason) {
  // Double guard: block if already submitted OR if auto-submit already triggered.
  // autoSubmitTriggered prevents duplicate calls during the 2.5s countdown.
  if (examSubmitted || autoSubmitTriggered) return;
  autoSubmitTriggered = true;

  // Stop all monitoring immediately so no new violations fire during countdown
  clearInterval(timerInterval);
  stopFaceAntiCheat();
  if (webcamInterval) { clearInterval(webcamInterval); webcamInterval = null; }

  // Guaranteed fullscreen overlay — no HTML element dependency
  const existing = document.getElementById('autoSubmitOverlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'autoSubmitOverlay';

  // Inject keyframe if not already present
  if (!document.getElementById('autoSubmitStyle')) {
    const st = document.createElement('style');
    st.id = 'autoSubmitStyle';
    st.textContent = `
      @keyframes asPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.12)} }
      @keyframes asFlash  { 0%,100%{opacity:1} 50%{opacity:.5} }
    `;
    document.head.appendChild(st);
  }

  overlay.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:rgba(127,29,29,0.97);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:18px;padding:32px;text-align:center;
    animation:asFlash .25s ease 3;
  `;
  overlay.innerHTML = `
    <div style="display:flex;justify-content:center;margin-bottom:8px;"><svg width="60" height="60" viewBox="0 0 24 24" fill="#dc2626" stroke="none" style="animation:asPulse 1s ease-in-out infinite;"><circle cx="12" cy="12" r="10"/></svg></div>
    <div style="color:#fff;font-size:24px;font-weight:900;max-width:360px;line-height:1.3;
      text-shadow:0 2px 12px rgba(0,0,0,.5);">
      Exam Auto-Submitted
    </div>
    <div style="color:rgba(255,255,255,.85);font-size:14px;font-weight:700;
      background:rgba(0,0,0,.3);padding:10px 24px;border-radius:999px;">
      Maximum violations reached
    </div>
    <div style="color:rgba(255,255,255,.6);font-size:13px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"/></svg> Uploading your answers…
    </div>
  `;
  document.body.appendChild(overlay);

  // Countdown bar inside overlay
  const bar = document.createElement('div');
  bar.style.cssText = `
    position:absolute;bottom:0;left:0;right:0;height:4px;
    background:rgba(255,255,255,.2);overflow:hidden;
  `;
  const fill = document.createElement('div');
  fill.style.cssText = `
    height:100%;background:rgba(255,255,255,.7);width:100%;
    transition:width 2.5s linear;
  `;
  bar.appendChild(fill);
  overlay.appendChild(bar);
  // Trigger the shrink animation on next frame
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = '0%'; }));

  // Submit after countdown — async guard ensures examSubmitted wasn't set elsewhere
  setTimeout(async () => {
    autoSubmitTriggered = false;
    if (!examSubmitted) {
      await submitExam();
    }
  }, 2500);
}

function showSaveIndicator(state) {
  // state: 'saving' | 'saved' | 'offline'
  let pill = document.getElementById('autoSavePill');
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'autoSavePill';
    pill.style.cssText = `
      position:fixed;bottom:16px;left:16px;z-index:9000;
      display:flex;align-items:center;gap:6px;
      padding:6px 12px;border-radius:999px;font-size:11px;font-weight:700;
      letter-spacing:.3px;transition:all .3s;pointer-events:none;
      font-family:'DM Sans',system-ui,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,.18);
    `;
    document.body.appendChild(pill);
  }
  if (state === 'saving') {
    pill.style.background = '#14163f'; pill.style.color = '#cfd1fa';
    pill.style.display = 'flex';
    pill.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#9ea2f0;animation:netDotPulse .6s infinite;flex-shrink:0;display:inline-block;"></span> Saving…';
  } else if (state === 'saved') {
    pill.style.background = '#14532d'; pill.style.color = '#bbf7d0';
    pill.style.display = 'flex';
    const now = Date.now();
    pill._lastSavedAt = now;
    pill.innerHTML = `Saved just now`;
    // Update "X seconds ago" every second
    if (pill._savedInterval) clearInterval(pill._savedInterval);
    pill._savedInterval = setInterval(() => {
      if (!pill.parentNode || state !== 'saved') { clearInterval(pill._savedInterval); return; }
      const elapsed = Math.floor((Date.now() - now) / 1000);
      if (elapsed < 60) pill.innerHTML = `Saved ${elapsed}s ago`;
      else pill.innerHTML = `Saved ${Math.floor(elapsed/60)}m ago`;
    }, 1000);
    setTimeout(() => { if (pill.parentNode) pill.style.opacity = '0'; }, 3500);
    setTimeout(() => { if (pill.parentNode) { pill.style.opacity = '1'; pill.style.display = 'none'; if (pill._savedInterval) clearInterval(pill._savedInterval); } }, 4000);
  } else if (state === 'offline') {
    pill.style.background = '#7f1d1d'; pill.style.color = '#fecaca';
    pill.innerHTML = 'Saved offline';
    pill.style.display = 'flex';
  }
  pill.style.display = 'flex';
}

async function saveProgress() {
  if (!sessionId) return;

  // Always persist to localStorage as offline fallback
  try {
    localStorage.setItem(`exam_progress_${sessionId}`, JSON.stringify({ answers, savedAt: Date.now() }));
  } catch(e) {}

  if (!navigator.onLine) {
    offlineSyncPending = true;
    showSaveIndicator('offline');
    return; // skip server save — will sync on reconnect
  }

  showSaveIndicator('saving');
  try {
    await fetch('/api/save-progress', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, answers })
    });
    offlineSyncPending = false;
    showSaveIndicator('saved');
  } catch(e) {
    offlineSyncPending = true;
    showSaveIndicator('offline');
  }
}

async function syncOfflineProgress() {
  if (!sessionId || !offlineSyncPending) return;
  try {
    // Try restoring from localStorage if current answers are empty
    const stored = localStorage.getItem(`exam_progress_${sessionId}`);
    const savedAnswers = stored ? JSON.parse(stored).answers : answers;
    await fetch('/api/save-progress', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ session_id: sessionId, answers: savedAnswers })
    });
    offlineSyncPending = false;
    Object.assign(answers, savedAnswers);
  } catch(e) {}
}

async function initWebcam() {
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    ['webcamPreview', 'webcamSide'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.srcObject = webcamStream;
        el.play().catch(() => {});
      }
    });

    // Periodic snapshot every 60s
    webcamInterval = setInterval(async () => {
      if (examSubmitted) return;
      try {
        const canvas = document.createElement('canvas');
        const v      = document.getElementById('webcamPreview') ||
                       document.getElementById('webcamSide');
        if (!v) return;
        canvas.width  = v.videoWidth  || 320;
        canvas.height = v.videoHeight || 240;
        canvas.getContext('2d').drawImage(v, 0, 0);
        canvas.toBlob(async blob => {
          if (!blob) return;
          const fd = new FormData();
          fd.append('snapshot', blob, 'snap.jpg');
          await fetch('/api/save-snapshot', { method: 'POST', body: fd });
        }, 'image/jpeg', 0.6);
      } catch(e) {}
    }, 60000);
  } catch(e) {
    console.warn('Webcam not available:', e);
    const isDenied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError';
    if (isDenied) {
      // Block exam — show fullscreen camera required overlay
      document.body.insertAdjacentHTML('beforeend', `
        <div id="camDeniedOverlay" style="
          position:fixed;inset:0;z-index:99999;
          background:#0f1230;display:flex;align-items:center;justify-content:center;
          font-family:'DM Sans',sans-serif;padding:24px;
        ">
          <div style="
            background:#1b1e45;border:1px solid rgba(239,68,68,.4);border-radius:20px;
            padding:36px 28px;max-width:380px;width:100%;text-align:center;
          ">
            <div style="display:flex;justify-content:center;margin-bottom:16px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#5b5f80" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
            <div style="color:#ef4444;font-size:20px;font-weight:800;margin-bottom:12px;">
              Camera Access Required
            </div>
            <div style="color:#8e92b3;font-size:14px;line-height:1.8;margin-bottom:24px;">
              This exam requires camera access for face verification.<br>
              You cannot continue without it.<br><br>
              <strong style="color:#e6e8f3;">To fix on your phone:</strong><br>
              1. Tap the lock or info icon in your browser address bar<br>
              2. Tap <strong>Permissions → Camera → Allow</strong><br>
              3. Reload the page
            </div>
            <button onclick="location.reload()" style="
              width:100%;padding:14px;background:#ef4444;border:none;border-radius:12px;
              color:#fff;font-size:15px;font-weight:700;cursor:pointer;
            ">I've allowed it — Reload</button>
          </div>
        </div>
      `);
    } else {
      ['webcamPreview', 'webcamSide'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
    }
  }
}

function confirmSubmit() {
  const answered    = Object.keys(answers).length;
  const unanswered  = questions.length - answered;
  const submitStats = document.getElementById('submitStats');
  if (submitStats) {
    submitStats.innerHTML = `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e4e4e7;">
        <span style="color:#71717a;font-weight:600;">Total Questions</span>
        <span style="font-weight:700;color:#1b1e45;">${questions.length}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e4e4e7;">
        <span style="color:#71717a;font-weight:600;">Answered</span>
        <span style="font-weight:700;color:#22c55e;">${answered}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;">
        <span style="color:#71717a;font-weight:600;">Unanswered</span>
        <span style="font-weight:700;color:${unanswered > 0 ? '#ef4444' : '#22c55e'};">${unanswered}</span>
      </div>
    `;
  }
  openModal('submitModal');
}

function openModal(id)  { const m = document.getElementById(id); if (m) m.classList.add('active'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('active'); }

let submitRetryTimer = null;
let submitRetryCount = 0;

// Result saved on the server: clean up this device's copies and go to the results page
function finishSubmitSuccess(data) {
  if (submitRetryTimer) { clearTimeout(submitRetryTimer); submitRetryTimer = null; }
  if (sessionId) {
    try { localStorage.removeItem(`exam_progress_${sessionId}`); } catch(e) {}
    try { localStorage.removeItem(`pending_exam_submit_${sessionId}`); } catch(e) {}
  }
  sessionStorage.setItem('examResult', JSON.stringify(data.result));
  const examKey = examData?.id || examData?._id;
  if (examKey) sessionStorage.setItem('examSessionSubmitted_' + examKey, '1');
  history.replaceState(null, '', 'results.html');
  window.location.replace('results.html');
}

// Keep retrying the submit (5s, 10s, 20s, 40s, then every 60s) until MongoDB confirms the result
function queueSubmitRetry(payload) {
  offlineSyncPending = true;
  if (submitRetryTimer) return;
  const delay = Math.min(60, 5 * Math.pow(2, submitRetryCount)) * 1000;
  submitRetryCount++;
  submitRetryTimer = setTimeout(async () => {
    submitRetryTimer = null;
    try {
      const res  = await fetch('/api/submit-exam', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) { finishSubmitSuccess(data); return; }
    } catch(e) {}
    queueSubmitRetry(payload);
  }, delay);
}

async function submitExam() {
  if (examSubmitted) return; // strict guard — prevents any double submission

  // Guard: session must be established before submit can proceed
  if (!sessionId) {
    alert('Exam session not found. Please go back, reload, and try again.');
    examSubmitted = false;
    closeModal('submitModal');
    return;
  }

  // * FIX: Immediately disable every element that could trigger submitExam again.
  // The examSubmitted flag above catches same-tick calls; this catches button re-taps
  // during the async fetch (e.g. user taps "Submit" again while server is responding).
  examSubmitted = true;
  document.querySelectorAll('[onclick*="submitExam"], [onclick*="confirmSubmit"]').forEach(el => {
    el.disabled = true;
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
  });
  closeModal('submitModal');
  clearInterval(timerInterval);
  stopFaceAntiCheat();
  if (webcamInterval) { clearInterval(webcamInterval); webcamInterval = null; }

  // Merge any localStorage-saved answers in case of offline period.
  // * FIX: { ...saved, ...answers } — in-memory answers always win over stale localStorage.
  if (sessionId) {
    try {
      const stored = localStorage.getItem(`exam_progress_${sessionId}`);
      if (stored) {
        const saved = JSON.parse(stored).answers || {};
        answers = { ...saved, ...answers };
      }
    } catch(e) {}
  }

  const examId    = getExamId();
  const timeTaken = examData ? (examData.duration * 60) - timeRemaining : 0;
  console.log('[SUBMIT-CLIENT] answers being sent:', JSON.stringify(answers));
  console.log('[SUBMIT-CLIENT] sessionId:', sessionId, 'examId:', examId);

  const payload = { session_id: sessionId, student_id: student.id, exam_id: examId, answers, time_taken: timeTaken };
  // Keep a copy on this device BEFORE sending, so a failed or lost request can always be retried
  try { localStorage.setItem(`pending_exam_submit_${sessionId}`, JSON.stringify(payload)); } catch(e) {}
  if (submitRetryTimer) { clearTimeout(submitRetryTimer); submitRetryTimer = null; }

  try {
    const res  = await fetch('/api/submit-exam', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      finishSubmitSuccess(data);
    } else {
      // Server could not record the result yet - answers are saved, keep retrying automatically
      examSubmitted = true;
      showOfflineSubmitBanner();
      queueSubmitRetry(payload);
    }
  } catch(e) {
    // Offline submit — save to localStorage with pendingSubmit flag
    offlineSyncPending = true;
    examSubmitted = true;
    if (sessionId) {
      try {
        localStorage.setItem(`exam_progress_${sessionId}`, JSON.stringify({
          answers, savedAt: Date.now(), pendingSubmit: true, time_taken: timeTaken
        }));
      } catch(ee) {}
    }
    // Show persistent offline submit banner with Check Sync Status button
    showOfflineSubmitBanner();
    setNetPill('offline', 'Offline');
    // The window 'online' event listener in setupNetworkMonitoring()
    // will automatically detect the pendingSubmit flag and retry.
    queueSubmitRetry(payload);
  }
}

document.addEventListener('DOMContentLoaded', initExam);