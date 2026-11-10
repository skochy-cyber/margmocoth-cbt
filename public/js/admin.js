// ===== MARGMOCOTH CBT ADMIN SHARED JS =====
'use strict';

function checkAdmin() {
 const admin = JSON.parse(sessionStorage.getItem('admin') || 'null');
 if (!admin) { window.location.href = 'admin-login.html'; return null; }
 const el = document.getElementById('adminName');
 if (el) el.textContent = admin.display_name || admin.username;
 return admin;
}

// Returns true if the logged-in account is the super admin
function isSuper() {
 const admin = JSON.parse(sessionStorage.getItem('admin') || 'null');
 return !!(admin && admin.role === 'super');
}

// Returns true if super admin OR lecturer has the given permission key
function hasPermission(perm) {
 const admin = JSON.parse(sessionStorage.getItem('admin') || 'null');
 if (!admin) return false;
 if (admin.role === 'super') return true;
 return Array.isArray(admin.permissions) && admin.permissions.includes(perm);
}

// Redirect to dashboard if the current user lacks a permission
function requirePermission(perm) {
 if (!hasPermission(perm)) { window.location.href = 'admin-dashboard.html'; return false; }
 return true;
}

// Redirect to dashboard if the current user is not super admin
function requireSuper() {
 if (!isSuper()) { window.location.href = 'admin-dashboard.html'; return false; }
 return true;
}

function adminLogout() {
 sessionStorage.removeItem('admin');
 window.location.href = 'admin-login.html';
}

function toggleSidebar() {
 document.querySelector('.sidebar').classList.toggle('open');
 document.querySelector('.sidebar-overlay').classList.toggle('active');
}
function closeSidebar() {
 document.querySelector('.sidebar')?.classList.remove('open');
 document.querySelector('.sidebar-overlay')?.classList.remove('active');
}

function showAlert(msg, type = 'success', containerId = 'alertBox') {
 const el = document.getElementById(containerId);
 if (!el) return;
 el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
 setTimeout(() => { if (el) el.innerHTML = ''; }, 5000);
}

function getAdminToken() {
 return sessionStorage.getItem('adminToken') || '';
}
async function apiGet(url) {
 const res = await fetch(url, {
 headers: { 'X-Admin-Token': getAdminToken() }
 });
 return res.json();
}
async function apiPost(url, data) {
 const res = await fetch(url, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() },
 body: JSON.stringify(data)
 });
 return res.json();
}
async function apiPut(url, data) {
 const res = await fetch(url, {
 method: 'PUT',
 headers: { 'Content-Type': 'application/json', 'X-Admin-Token': getAdminToken() },
 body: JSON.stringify(data)
 });
 return res.json();
}
async function apiDelete(url) {
 const res = await fetch(url, {
 method: 'DELETE',
 headers: { 'X-Admin-Token': getAdminToken() }
 });
 return res.json();
}

function formatDate(d) {
 if (!d) return '-';
 return new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}
function confirmDelete(msg) {
 return confirm(' ' + msg + '\n\nThis action cannot be undone.');
}

// ─── SIDEBAR HTML ─────────────────────────────────────────────
function getSidebarHTML(activePage) {
 const admin = JSON.parse(sessionStorage.getItem('admin') || '{}');
 const super_ = admin.role === 'super';
 const perms = Array.isArray(admin.permissions) ? admin.permissions : [];
 const can = (p) => super_ || perms.includes(p);

 const groups = [
 {
 items: [
 { href: 'admin-dashboard.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="1" y="9" width="3" height="6" rx="1" fill="currentColor" opacity=".7"/><rect x="6" y="5" width="3" height="10" rx="1" fill="currentColor"/><rect x="11" y="2" width="3" height="13" rx="1" fill="currentColor" opacity=".85"/></svg>', label: 'Dashboard', show: true }
 ]
 },
 {
 title: 'EXAM MANAGEMENT',
 items: [
 { href: 'create-exam.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="2" y="2" width="10" height="12" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Create Exam', show: can('manage_exams') },
 { href: 'exam-access-codes.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="5.5" cy="8.5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M7.5 8.5H14M12 8.5v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Access Codes', show: can('manage_exams') },
 { href: 'add-question.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5C6.5 5.67 7.17 5 8 5s1.5.67 1.5 1.5c0 1-1.5 1.5-1.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.5" r=".75" fill="currentColor"/></svg>', label: 'Add Questions', show: can('manage_questions') },
 { href: 'upload-questions.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M8 2v8M5 5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11v2h10v-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Upload Questions CSV', show: can('manage_questions') },
 { href: 'upload-questions-text.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 2v4h4M5 9h6M5 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Import from Text/Word', show: can('manage_questions') },
 { href: 'bulk-exams.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 2v12M2 5l6 3 6-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Bulk Exam Actions', show: can('manage_exams') },
 { href: 'view-results.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M2 12l4-4 3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 5h3v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: 'Results & Export', show: can('view_results') },
 { href: 'analytics.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M2 5l4 4 3-3 5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 11h3v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: 'Analytics', show: super_ },
 { href: 'lecturer-monitor.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>', label: 'Monitoring Hub', show: can('view_violations') || admin.role === 'lecturer' },
 { href: 'admin-retake.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M13 8A5 5 0 113 8M3 8l2-2M3 8l2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>', label: 'Retake Requests', show: can('manage_exams') },
 { href: 'exam-access-list.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/></svg>', label: 'Access Code Restrictions', show: super_ },
 { href: 'live-exam.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="4" fill="currentColor"/><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" opacity=".4"/></svg>', label: 'Live Exam Monitor', show: can('view_violations') },
 ]
 },
 {
 title: 'PROCTORING',
 items: [
 { href: 'admin-capturing.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M1 5a1 1 0 011-1h1l1-1h6l1 1h1a1 1 0 011 1v7a1 1 0 01-1 1H2a1 1 0 01-1-1V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8.5" r="2" stroke="currentColor" stroke-width="1.5"/></svg>', label: 'Face Captures', show: can('view_captures') },
 { href: 'student-profiles.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="1" y="4" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="8.5" r="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M9 7h4M9 9.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Student Profiles', show: can('view_captures') },
 ]
 },
 {
 title: 'STUDENTS',
 items: [
 { href: 'upload-students.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 14c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="1.2" opacity=".6"/><path d="M15 14c0-2.21-1.34-4.1-3.26-4.74" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".6"/></svg>', label: 'Manage Students', show: can('manage_students') },
 { href: 'generated-passwords.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="3" y="7" width="10" height="7" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/></svg>', label: 'Batch Passwords', show: can('manage_students') },
 ]
 },
 {
 title: 'CONFIGURATION',
 items: [
 { href: 'manage-courses.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M3 2h8a1 1 0 011 1v10a1 1 0 01-1 1H3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 2a1 1 0 00-1 1v10a1 1 0 001 1h1" stroke="currentColor" stroke-width="1.5"/><path d="M7 6h4M7 9h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Courses', show: can('manage_config') },
 { href: 'manage-departments.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="2" y="2" width="12" height="13" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h2M9 5h2M5 8h2M9 8h2M5 11h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 15v-3h2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Departments', show: can('manage_config') },
 { href: 'manage-levels.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>', label: 'Levels', show: can('manage_config') },
 { href: 'manage-semesters.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5.5" cy="10.5" r="1" fill="currentColor"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/></svg>', label: 'Semesters', show: can('manage_config') },
 ]
 },
 {
 title: 'SUPPORT',
 items: [
 { href: 'admin-messages.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 2V3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>', label: 'MARGMOCOTH Support Messages', show: super_ || can('manage_students') },
 { href: 'admin-complaints.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.5h4v2H6v-2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 7h6M5 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Student Complaints', show: super_ || can('manage_students') },
 { href: 'admin-name-requests.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M11 2l3 3-9 9H2v-3l9-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 4l3 3" stroke="currentColor" stroke-width="1.5"/></svg>', label: 'Name/Matric Changes', show: super_ || can('manage_students') },
 { href: 'admin-broadcast.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M13 3L5 6H2a1 1 0 00-1 1v2a1 1 0 001 1h3l8 3V3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5 10l1 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Broadcast Center', show: super_ },
 ]
 },
 {
 title: 'SYSTEM',
 items: [
 { href: 'settings.html', icon: '<svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.41 1.41M11.37 11.37l1.41 1.41M3.22 12.78l1.41-1.41M11.37 4.63l1.41-1.41" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', label: 'Settings', show: super_ },
 ]
 }
 ];

 let navHTML = '';
 groups.forEach(g => {
 const visibleItems = g.items.filter(link => link.show !== false);
 if (!visibleItems.length) return;
 if (g.title) navHTML += `<div class="nav-section-title">${g.title}</div>`;
 visibleItems.forEach(link => {
 const active = activePage === link.href ? ' active' : '';
 navHTML += `<a href="${link.href}" class="nav-link${active}" onclick="closeSidebar()">
 <span class="nav-icon">${link.icon}</span>${link.label}
 </a>`;
 });
 });

 return `
 <div class="sidebar-overlay" onclick="closeSidebar()"></div>
 <div class="sidebar">
 <div class="sidebar-brand">
 <div class="sidebar-logo">
 <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
 <rect width="36" height="36" rx="10" fill="#2e3192"/>
 <path d="M10 26V14l8-4 8 4v12" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
 <rect x="15" y="20" width="6" height="6" rx="1" fill="#fff"/>
 <path d="M13 14h10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
 </svg>
 </div>
 <div class="school-name">MARGMOCOTH CBT</div>
 <p class="role">${super_ ? 'Director Panel' : 'Lecturer Portal'}</p>
 </div>
 <nav class="sidebar-nav">${navHTML}</nav>
 <div class="sidebar-footer">
 <button onclick="adminLogout()" class="btn btn-secondary btn-full btn-sm"><svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="3" y="1" width="10" height="14" rx="1" stroke="currentColor" stroke-width="1.5"/><circle cx="10.5" cy="8" r="1" fill="currentColor"/></svg> Logout</button>
 </div>
 </div>`;
}

// ─── TOPBAR HTML ─────────────────────────────────────────────
function getTopbarHTML(title) {
 const admin = JSON.parse(sessionStorage.getItem('admin') || '{}');
 const deptBadge = (admin.role === 'lecturer' && admin.department_name)
 ? `<span style="background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:600;padding:3px 8px;border-radius:12px;margin-left:8px;"><svg viewBox="0 0 16 16" fill="none" width="16" height="16"><rect x="2" y="2" width="12" height="13" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M5 5h2M9 5h2M5 8h2M9 8h2M5 11h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 15v-3h2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> ${admin.department_name}</span>`
 : '';
 return `
 <div class="topbar">
 <div class="topbar-left">
 <button class="hamburger" onclick="toggleSidebar()"><svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
 <h2 class="topbar-title">${title}</h2>
 </div>
 <div class="topbar-right">
 <div class="topbar-user">
 <div class="topbar-avatar"><svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="5.5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 14c0-3.31 2.69-6 6-6s6 2.69 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
 <span id="adminName">Admin</span>${deptBadge}
 </div>
 </div>
 </div>`;
}

// ─── FOOTER HTML ─────────────────────────────────────────────
function getFooterHTML() {
 return `
 <footer class="footer-marquee">
 <div class="marquee-content">
 <span> Powered by Tribal Tech Powered by Tribal Tech Powered by Tribal Tech</span>
 </div>
 </footer>`;
}
