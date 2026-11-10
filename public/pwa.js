/* ════════════════════════════════════════════════════════
   MARGMOCOTH CBT  —  PWA Install Prompt  (pwa.js)
   Include this script on EVERY page after admin.js
════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. Register Service Worker ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          // Check for updates every 60 s (catches re-deploys on Render)
          setInterval(() => reg.update(), 60000);
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  /* ── 2. Install Banner ── */
  let deferredPrompt = null;

  // Inject banner HTML + styles once DOM is ready
  function injectBanner() {
    if (document.getElementById('pwaInstallBanner')) return;

    const style = document.createElement('style');
    style.textContent = `
      #pwaInstallBanner {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 9999;
        background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
        color: #fff;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.35);
        transform: translateY(110%);
        transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
        font-family: 'Inter', system-ui, sans-serif;
      }
      #pwaInstallBanner.pwa-visible {
        transform: translateY(0);
      }
      #pwaInstallBanner .pwa-icon {
        width: 48px; height: 48px;
        border-radius: 12px;
        flex-shrink: 0;
        object-fit: cover;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      #pwaInstallBanner .pwa-text {
        flex: 1;
        line-height: 1.3;
      }
      #pwaInstallBanner .pwa-text strong {
        display: block;
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 2px;
      }
      #pwaInstallBanner .pwa-text span {
        font-size: 12px;
        opacity: 0.85;
      }
      #pwaInstallBanner .pwa-install-btn {
        background: #fff;
        color: #1e3a8a;
        border: none;
        border-radius: 8px;
        padding: 9px 16px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        flex-shrink: 0;
        white-space: nowrap;
        transition: background 0.2s;
      }
      #pwaInstallBanner .pwa-install-btn:active { background: #dbeafe; }
      #pwaInstallBanner .pwa-dismiss-btn {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.7);
        font-size: 20px;
        cursor: pointer;
        padding: 4px 6px;
        line-height: 1;
        flex-shrink: 0;
      }
      #pwaInstallBanner .pwa-dismiss-btn:hover { color: #fff; }

      /* iOS banner (shown when no beforeinstallprompt) */
      #pwaIosBanner {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 9999;
        background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
        color: #fff;
        padding: 16px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.6;
        box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
        border-radius: 16px 16px 0 0;
        transform: translateY(110%);
        transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      #pwaIosBanner.pwa-visible { transform: translateY(0); }
      #pwaIosBanner .ios-close {
        float: right;
        background: rgba(255,255,255,0.15);
        border: none;
        color: #fff;
        border-radius: 50%;
        width: 26px; height: 26px;
        font-size: 16px;
        cursor: pointer;
        margin-left: 8px;
        line-height: 1;
      }
      #pwaIosBanner .ios-step {
        display: flex; align-items: flex-start; gap: 8px; margin: 6px 0;
      }
      #pwaIosBanner .ios-step-num {
        background: #1e40af;
        border-radius: 50%;
        width: 22px; height: 22px;
        display: flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 700; flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);

    // Android / Chrome banner
    const banner = document.createElement('div');
    banner.id = 'pwaInstallBanner';
    banner.innerHTML = `
      <img src="/icons/icon-192.png" class="pwa-icon" alt="MARGMOCOTH CBT">
      <div class="pwa-text">
        <strong>Install MARGMOCOTH CBT</strong>
        <span>Add to Home Screen for quick access</span>
      </div>
      <button class="pwa-install-btn" id="pwaInstallBtn"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Install</button>
      <button class="pwa-dismiss-btn" id="pwaDismissBtn" title="Dismiss"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
    `;
    document.body.appendChild(banner);

    // iOS Safari banner
    const iosBanner = document.createElement('div');
    iosBanner.id = 'pwaIosBanner';
    iosBanner.innerHTML = `
      <button class="ios-close" id="pwaIosClose"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
      <strong style="display:block;font-size:15px;margin-bottom:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg> Install MARGMOCOTH CBT</strong>
      <div class="ios-step">
        <span class="ios-step-num">1</span>
        <span>Tap the <strong>Share</strong> button <span style="font-size:16px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="display:inline-block;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg></span> in Safari's toolbar</span>
      </div>
      <div class="ios-step">
        <span class="ios-step-num">2</span>
        <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
      </div>
      <div class="ios-step">
        <span class="ios-step-num">3</span>
        <span>Tap <strong>Add</strong> — the app will appear on your home screen</span>
      </div>
    `;
    document.body.appendChild(iosBanner);

    // Wire buttons
    document.getElementById('pwaInstallBtn').addEventListener('click', () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(choice => {
        if (choice.outcome === 'accepted') hideBanner();
        deferredPrompt = null;
      });
    });
    document.getElementById('pwaDismissBtn').addEventListener('click', () => {
      hideBanner();
      // Don't show again for 7 days
      localStorage.setItem('pwa_dismissed', Date.now().toString());
    });
    document.getElementById('pwaIosClose').addEventListener('click', () => {
      hideIosBanner();
      localStorage.setItem('pwa_dismissed', Date.now().toString());
    });
  }

  function showBanner()    { document.getElementById('pwaInstallBanner')?.classList.add('pwa-visible'); }
  function hideBanner()    { document.getElementById('pwaInstallBanner')?.classList.remove('pwa-visible'); }
  function showIosBanner() { document.getElementById('pwaIosBanner')?.classList.add('pwa-visible'); }
  function hideIosBanner() { document.getElementById('pwaIosBanner')?.classList.remove('pwa-visible'); }

  function wasDismissedRecently() {
    const ts = parseInt(localStorage.getItem('pwa_dismissed') || '0', 10);
    return ts && (Date.now() - ts) < 7 * 24 * 60 * 60 * 1000;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  // CRITICAL: Never show install prompt on exam pages — it triggers visibilitychange
  // which the anti-cheat engine records as a violation
  function isExamPage() {
    const p = window.location.pathname;
    return p.includes('exam-page') ||
           p.includes('exam-access') ||
           p.includes('face-capture') ||
           p.includes('exam-review');
  }

  // Listen for the browser's install prompt (Android/Chrome/Edge)
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    // NEVER show on exam pages — install prompt causes visibilitychange → violation
    if (isExamPage() || isStandalone() || wasDismissedRecently()) return;
    injectBanner();
    // Short delay so page finishes painting first
    setTimeout(showBanner, 2500);
  });

  // iOS Safari: no beforeinstallprompt event — show manual instructions
  window.addEventListener('load', () => {
    // NEVER show on exam pages
    if (isExamPage()) return;
    if (isIos() && !isStandalone() && !wasDismissedRecently()) {
      injectBanner();
      setTimeout(showIosBanner, 3000);
    }
  });

  // If already installed, hide banner if somehow visible
  window.addEventListener('appinstalled', () => {
    hideBanner();
    hideIosBanner();
    deferredPrompt = null;
  });

})();