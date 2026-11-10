/* ════════════════════════════════════════════════════════
   MARGMOCOTH CBT  —  Service Worker  v1.0
   Strategy:
     • App shell (HTML/CSS/JS/icons) → Cache-First
     • API calls (/api/*)             → Network-First (never cache)
     • Everything else                → Stale-While-Revalidate
════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'margmocoth-cbt-v1';
const SHELL_ASSETS  = [
  '/',
  '/index.html',
  '/login.html',
  '/school-logo.png',
  '/admin-login.html',
  '/admin-dashboard.html',

  '/css/style.css',
  '/js/admin.js',
  '/js/ai-assistant.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json'
  // NOTE: exam-page.html, exam-access.html, exam.js intentionally excluded
  // They must ALWAYS load fresh from network — never serve stale cached versions
];

// Pages and scripts that must NEVER be cached — always network-only
const NEVER_CACHE = [
  '/exam-page.html',
  '/exam-access.html',
  '/exam-review.html',
  '/js/exam.js',
];

function isNeverCache(pathname) {
  return NEVER_CACHE.some(p => pathname === p || pathname.startsWith(p));
}

// External CDN scripts (TF.js, BlazeFace, KaTeX) — never cache, always network
function isCdnScript(url) {
  return url.hostname.includes('cdn.jsdelivr.net') ||
         url.hostname.includes('cdnjs.cloudflare.com') ||
         url.hostname.includes('fonts.googleapis.com') ||
         url.hostname.includes('fonts.gstatic.com');
}

/* ── INSTALL: pre-cache shell ── */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
});

/* ── ACTIVATE: remove old caches ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  /* 1. EXAM & CDN pages/scripts — ALWAYS network, NEVER cache
        Stale exam content could break AI proctoring or serve wrong questions */
  if (isNeverCache(url.pathname) || isCdnScript(url)) {
    e.respondWith(fetch(e.request));
    return;
  }

  /* 2. API calls → always go to network, never cache */
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => {
        // For portal settings specifically, return portal_open:true so a
        // network failure never triggers the maintenance screen on the client.
        // Bad network ≠ maintenance mode.
        if (url.pathname === '/api/settings/portal') {
          return new Response(
            JSON.stringify({ portal_open: true, _offline: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ error: 'offline', message: 'No network connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  /* 3. Navigation requests (HTML) → Network-first, fallback to cache */
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('/login.html')))
    );
    return;
  }

  /* 4. Static assets → Cache-first, update in background */
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

/* ── Push notifications (future use) ── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'MARGMOCOTH CBT', body: 'You have a new notification.' };
  e.waitUntil(
    self.registration.showNotification(data.title || 'MARGMOCOTH CBT', {
      body:    data.body    || '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-96.png',
      vibrate: [200, 100, 200],
      data:    data.url ? { url: data.url } : {}
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/notifications.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(target) && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(target);
    })
  );
});