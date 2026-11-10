// ===== MARGMOCOTH CBT AI ADMIN ASSISTANT =====
// Drop this script into any admin page and it injects a floating AI button.
// The AI understands every system API and can perform real actions on command.
'use strict';

(function () {

  // ─── CONFIG ─────────────────────────────────────────────────
  const GROQ_KEY   = window.GROQ_API_KEY || '';   // set via <script>window.GROQ_API_KEY='...'</script> before this file
  const GROQ_MODEL = 'llama-3.3-70b-versatile';
  const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

  // ─── STATE ──────────────────────────────────────────────────
  let isOpen       = false;
  let isThinking   = false;
  let chatHistory  = [];          // {role, content}[]
  let cachedData   = {};          // departments, levels, courses, exams — fetched once

  // ─── INJECT STYLES ──────────────────────────────────────────
  const STYLE = document.createElement('style');
  STYLE.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap');

    #ai-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: linear-gradient(135deg, #0f6b30 0%, #166534 50%, #14532d 100%);
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(15,107,48,0.45), 0 0 0 0 rgba(15,107,48,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s;
      animation: fabPulse 3s ease-in-out infinite;
    }
    #ai-fab:hover {
      transform: scale(1.08) rotate(-3deg);
      box-shadow: 0 8px 32px rgba(15,107,48,0.55), 0 0 0 6px rgba(15,107,48,0.12);
    }
    #ai-fab:active { transform: scale(0.95); }
    @keyframes fabPulse {
      0%,100% { box-shadow: 0 4px 20px rgba(15,107,48,0.45), 0 0 0 0 rgba(15,107,48,0.3); }
      50%      { box-shadow: 0 4px 20px rgba(15,107,48,0.45), 0 0 0 8px rgba(15,107,48,0); }
    }
    #ai-fab svg { width: 26px; height: 26px; transition: transform 0.3s; }
    #ai-fab.open svg { transform: rotate(45deg); }

    /* ─── PANEL ─────────────────────────────────────────── */
    #ai-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      z-index: 99998;
      width: min(320px, 90vw);
      height: 500px;
      max-height: 70vh;
      background: #0a0f0c;
      border: 1px solid rgba(15,107,48,0.35);
      border-radius: 20px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04) inset;
      transform: scale(0.92) translateY(16px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.22s ease;
    }
    #ai-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    /* ─── PANEL HEADER ──────────────────────────────────── */
    #ai-panel-header {
      padding: 14px 18px;
      background: linear-gradient(135deg, #0f6b30 0%, #14532d 100%);
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #ai-panel-header .ai-avatar {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: rgba(255,255,255,0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }
    #ai-panel-header .ai-title {
      flex: 1;
    }
    #ai-panel-header .ai-title h4 {
      font-family: 'Sora', sans-serif;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      margin: 0;
      letter-spacing: 0.3px;
    }
    #ai-panel-header .ai-title p {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: rgba(255,255,255,0.65);
      margin: 2px 0 0;
    }
    #ai-panel-header .ai-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 6px #4ade80;
      animation: statusPulse 2s ease-in-out infinite;
      flex-shrink: 0;
    }
    @keyframes statusPulse {
      0%,100% { opacity:1; } 50% { opacity:0.5; }
    }
    #ai-clear-btn {
      background: rgba(255,255,255,0.1);
      border: none;
      border-radius: 6px;
      color: rgba(255,255,255,0.7);
      font-size: 10px;
      font-family: 'Sora', sans-serif;
      font-weight: 600;
      padding: 4px 8px;
      cursor: pointer;
      transition: background 0.15s;
      flex-shrink: 0;
    }
    #ai-clear-btn:hover { background: rgba(255,255,255,0.2); color:#fff; }

    /* ─── QUICK ACTIONS ─────────────────────────────────── */
    #ai-quick-actions {
      display: flex;
      gap: 6px;
      padding: 10px 14px 0;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .ai-quick-btn {
      font-family: 'Sora', sans-serif;
      font-size: 10.5px;
      font-weight: 600;
      color: rgba(255,255,255,0.7);
      background: rgba(15,107,48,0.18);
      border: 1px solid rgba(15,107,48,0.3);
      border-radius: 8px;
      padding: 5px 10px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .ai-quick-btn:hover {
      background: rgba(15,107,48,0.38);
      border-color: rgba(15,107,48,0.6);
      color: #fff;
    }

    /* ─── MESSAGES ──────────────────────────────────────── */
    #ai-messages {
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: rgba(15,107,48,0.3) transparent;
    }
    #ai-messages::-webkit-scrollbar { width: 4px; }
    #ai-messages::-webkit-scrollbar-track { background: transparent; }
    #ai-messages::-webkit-scrollbar-thumb { background: rgba(15,107,48,0.35); border-radius: 4px; }

    .ai-msg {
      max-width: 88%;
      animation: msgIn 0.2s ease;
    }
    @keyframes msgIn {
      from { opacity:0; transform:translateY(6px); }
      to   { opacity:1; transform:translateY(0); }
    }
    .ai-msg.user {
      align-self: flex-end;
    }
    .ai-msg.assistant {
      align-self: flex-start;
    }
    .ai-msg-bubble {
      font-family: 'Sora', sans-serif;
      font-size: 12.5px;
      line-height: 1.6;
      padding: 10px 13px;
      border-radius: 13px;
      word-break: break-word;
    }
    .ai-msg.user .ai-msg-bubble {
      background: linear-gradient(135deg, #0f6b30, #166534);
      color: #fff;
      border-bottom-right-radius: 4px;
    }
    .ai-msg.assistant .ai-msg-bubble {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      color: #d1fae5;
      border-bottom-left-radius: 4px;
    }
    .ai-msg.assistant .ai-msg-bubble.success {
      background: rgba(15,107,48,0.2);
      border-color: rgba(74,222,128,0.3);
      color: #bbf7d0;
    }
    .ai-msg.assistant .ai-msg-bubble.error {
      background: rgba(220,38,38,0.15);
      border-color: rgba(248,113,113,0.3);
      color: #fecaca;
    }

    /* thinking dots */
    .ai-thinking .ai-msg-bubble {
      padding: 12px 16px;
    }
    .ai-dots { display: flex; gap: 4px; align-items: center; }
    .ai-dots span {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #4ade80;
      animation: dotBounce 1.2s ease-in-out infinite;
    }
    .ai-dots span:nth-child(2) { animation-delay: 0.2s; }
    .ai-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes dotBounce {
      0%,60%,100% { transform:translateY(0); opacity:0.4; }
      30%          { transform:translateY(-5px); opacity:1; }
    }

    /* ─── ACTION CONFIRMATION CARD ──────────────────────── */
    .ai-action-card {
      background: rgba(15,107,48,0.12);
      border: 1px solid rgba(15,107,48,0.35);
      border-radius: 10px;
      padding: 10px 12px;
      margin-top: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10.5px;
      color: #86efac;
    }
    .ai-action-card .action-label {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 1px;
      color: #4ade80;
      margin-bottom: 4px;
      text-transform: uppercase;
    }

    /* ─── INPUT AREA ────────────────────────────────────── */
    #ai-input-area {
      padding: 10px 14px 14px;
      flex-shrink: 0;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      border-top: 1px solid rgba(255,255,255,0.05);
    }
    #ai-input {
      flex: 1;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 9px 13px;
      font-family: 'Sora', sans-serif;
      font-size: 12.5px;
      color: #fff;
      outline: none;
      resize: none;
      max-height: 100px;
      transition: border-color 0.15s;
      line-height: 1.5;
    }
    #ai-input::placeholder { color: rgba(255,255,255,0.3); }
    #ai-input:focus { border-color: rgba(15,107,48,0.6); background: rgba(255,255,255,0.08); }
    #ai-send-btn {
      width: 38px;
      height: 38px;
      border-radius: 11px;
      background: linear-gradient(135deg, #0f6b30, #14532d);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.15s, opacity 0.15s;
    }
    #ai-send-btn:hover  { transform: scale(1.08); }
    #ai-send-btn:active { transform: scale(0.93); }
    #ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #ai-send-btn svg { width: 16px; height: 16px; }
  `;
  document.head.appendChild(STYLE);

  // ─── INJECT HTML ────────────────────────────────────────────
  const CONTAINER = document.createElement('div');
  CONTAINER.innerHTML = `
    <!-- FAB -->
    <button id="ai-fab" title="AI Admin Assistant" onclick="aiToggle()">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-1v1a4 4 0 0 1-8 0v-1H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3h1V6a4 4 0 0 1 4-4z"/>
        <circle cx="9" cy="11" r="1" fill="#fff" stroke="none"/>
        <circle cx="15" cy="11" r="1" fill="#fff" stroke="none"/>
      </svg>
    </button>

    <!-- PANEL -->
    <div id="ai-panel">
      <div id="ai-panel-header">
        <div class="ai-avatar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="8" rx="2"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/><circle cx="9" cy="15" r="1" fill="#fff"/><circle cx="15" cy="15" r="1" fill="#fff"/></svg></div>
        <div class="ai-title">
          <h4>MARGMOCOTH CBT AI Assistant</h4>
          <p>Powered by Groq · llama-3.3-70b</p>
        </div>
        <div class="ai-status-dot"></div>
        <button id="ai-clear-btn" onclick="aiClear()">Clear</button>
      </div>
      <div id="ai-quick-actions">
        <button class="ai-quick-btn" onclick="aiQuick('List all students')">Students</button>
        <button class="ai-quick-btn" onclick="aiQuick('List all exams')">Exams</button>
        <button class="ai-quick-btn" onclick="aiQuick('Show system stats')">Stats</button>
        <button class="ai-quick-btn" onclick="aiQuick('List all questions')">Questions</button>
        <button class="ai-quick-btn" onclick="aiQuick('What can you do?')">Help</button>
      </div>
      <div id="ai-messages"></div>
      <div id="ai-input-area">
        <textarea id="ai-input" rows="1" placeholder="Add student, delete exam, set question…"
          onkeydown="aiKeydown(event)" oninput="aiAutoResize(this)"></textarea>
        <button id="ai-send-btn" onclick="aiSend()" title="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(CONTAINER);

  // ─── TOGGLE ─────────────────────────────────────────────────
  window.aiToggle = function () {
    isOpen = !isOpen;
    document.getElementById('ai-panel').classList.toggle('open', isOpen);
    document.getElementById('ai-fab').classList.toggle('open', isOpen);
    if (isOpen) {
      prefetchData();
      if (chatHistory.length === 0) aiGreet();
      setTimeout(() => document.getElementById('ai-input')?.focus(), 320);
    }
  };

  window.aiClear = function () {
    chatHistory = [];
    document.getElementById('ai-messages').innerHTML = '';
    aiGreet();
  };

  window.aiQuick = function (text) {
    document.getElementById('ai-input').value = text;
    aiSend();
  };

  window.aiKeydown = function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(); }
  };

  window.aiAutoResize = function (el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 100) + 'px';
  };

  // ─── GREETING ───────────────────────────────────────────────
  function aiGreet() {
    const admin = JSON.parse(sessionStorage.getItem('admin') || '{}');
    const name  = admin.display_name || admin.username || 'Admin';
    appendMsg('assistant',
      `Hi <strong>${name}</strong>! I'm your MARGMOCOTH CBT assistant.<br><br>` +
      `I can <strong>add or delete students</strong>, <strong>manage exams</strong>, ` +
      `<strong>add or delete questions</strong>, <strong>show stats</strong>, and more.<br><br>` +
      `Just tell me what to do in plain language.`
    );
  }

  // ─── PRE-FETCH REFERENCE DATA ───────────────────────────────
  async function prefetchData() {
    try {
      const [depts, levels, courses, exams] = await Promise.all([
        fetch('/api/departments').then(r => r.json()),
        fetch('/api/levels').then(r => r.json()),
        fetch('/api/courses').then(r => r.json()),
        fetch('/api/admin/exams').then(r => r.json()),
      ]);
      cachedData.departments = depts.departments || depts || [];
      cachedData.levels      = levels.levels      || levels      || [];
      cachedData.courses     = courses.courses    || courses     || [];
      cachedData.exams       = exams.exams        || exams       || [];
    } catch(e) { /* silent */ }
  }

  // ─── SEND ────────────────────────────────────────────────────
  window.aiSend = async function () {
    const input = document.getElementById('ai-input');
    const text  = input.value.trim();
    if (!text || isThinking) return;

    input.value = '';
    input.style.height = 'auto';
    appendMsg('user', escHtml(text));
    chatHistory.push({ role: 'user', content: text });

    isThinking = true;
    document.getElementById('ai-send-btn').disabled = true;
    const thinkEl = appendThinking();

    try {
      const reply = await callGroq(text);
      thinkEl.remove();
      await handleReply(reply);
    } catch(e) {
      thinkEl.remove();
      appendMsg('assistant', `Error: ${escHtml(e.message)}`, 'error');
    }

    isThinking = false;
    document.getElementById('ai-send-btn').disabled = false;
    document.getElementById('ai-input').focus();
  };

  // ─── GROQ CALL ───────────────────────────────────────────────
  async function callGroq(userText) {
    const admin = JSON.parse(sessionStorage.getItem('admin') || '{}');

    const systemPrompt = buildSystemPrompt(admin);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-12),  // keep last 12 turns for context
    ];

    // Use server-side proxy if no key is set client-side
    const useProxy = !GROQ_KEY;

    let res;
    if (useProxy) {
      res = await fetch('/api/ai-assistant', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages, model: GROQ_MODEL })
      });
    } else {
      res = await fetch(GROQ_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model:       GROQ_MODEL,
          max_tokens:  1024,
          temperature: 0.2,
          messages
        })
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq API error ${res.status}: ${err.slice(0,200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    chatHistory.push({ role: 'assistant', content });
    return content;
  }

  // ─── SYSTEM PROMPT ──────────────────────────────────────────
  function buildSystemPrompt(admin) {
    const deptsStr   = (cachedData.departments || []).map(d => `${d.name} (id:${d._id||d.id})`).join(', ') || 'not loaded';
    const levelsStr  = (cachedData.levels      || []).map(l => `${l.name} (id:${l._id||l.id})`).join(', ') || 'not loaded';
    const coursesStr = (cachedData.courses     || []).map(c => `${c.name} (id:${c._id||c.id})`).join(', ') || 'not loaded';
    const examsStr   = (cachedData.exams       || []).slice(0,15).map(e => `"${e.title}" (id:${e._id||e.id}, code:${e.access_code})`).join('; ') || 'none';

    return `You are the AI assistant for MARGMOCOTH CBT (MARGMOCOTH CBT Computer-Based Testing system). You help the admin manage the system via a chat interface.

ADMIN: ${admin.display_name || admin.username || 'Admin'} | Role: ${admin.role || 'super'}
CURRENT PAGE: ${window.location.pathname.split('/').pop()}

AVAILABLE REFERENCE DATA:
- Departments: ${deptsStr}
- Levels: ${levelsStr}
- Courses: ${coursesStr}
- Recent Exams: ${examsStr}

YOU CAN PERFORM THESE ACTIONS. When you need to take an action, respond with a JSON block in this EXACT format (nothing else outside of it):

ACTION TYPES & JSON FORMATS:

1. Add student:
{"action":"add_student","name":"FULL NAME","matric":"MATRIC/2024/001","department_id":"<id>","level_id":"<id>"}

2. Delete student (by matric or ID):
{"action":"delete_student","matric":"MATRIC/2024/001"}
OR: {"action":"delete_student","id":"<mongodb_id>"}

3. Add a question to an exam:
{"action":"add_question","exam_id":"<id>","question":"Question text?","optionA":"A","optionB":"B","optionC":"C","optionD":"D","answer":"A"}

4. Delete a question (by ID):
{"action":"delete_question","id":"<question_id>"}

5. Delete an exam:
{"action":"delete_exam","id":"<exam_id>"}

6. Create an exam:
{"action":"create_exam","title":"Exam Title","course_id":"<id>","department_id":"<id>","level_id":"<id>","duration":60,"access_code":"CODE123","instructions":"Optional instructions"}

7. Fetch students (list/search):
{"action":"fetch_students","search":"optional name or matric filter"}

8. Fetch exams:
{"action":"fetch_exams"}

9. Fetch questions for an exam:
{"action":"fetch_questions","exam_id":"<id>"}

10. Fetch system stats:
{"action":"fetch_stats"}

RULES:
- When admin gives a command that maps to an action, respond ONLY with the JSON block, no extra text.
- When you need more info to complete an action (e.g. missing department), ASK for it conversationally.
- When the request is ambiguous (e.g. "delete John" — which John?), fetch first, then confirm.
- For conversational questions (not actions), respond in plain friendly English, concise.
- NEVER invent IDs. Use only the IDs provided in the reference data above.
- ALWAYS confirm destructive actions (delete) with a short warning before executing.
- Format lists nicely using line breaks and emoji where appropriate.
- If you cannot find an ID in the reference data, say so and suggest the admin refresh or tell you the ID.`;
  }

  // ─── HANDLE REPLY ────────────────────────────────────────────
  async function handleReply(content) {
    // Try to extract a JSON action block
    const jsonMatch = content.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+?"[\s\S]*?\}/);
    if (jsonMatch) {
      let action;
      try { action = JSON.parse(jsonMatch[0]); } catch(e) { /* not valid JSON */ }
      if (action?.action) {
        await executeAction(action);
        return;
      }
    }

    // Plain conversational reply
    appendMsg('assistant', mdToHtml(content));
  }

  // ─── EXECUTE ACTION ──────────────────────────────────────────
  async function executeAction(action) {
    const type = action.action;
    appendMsg('assistant', `<div class="ai-action-card"><div class="action-label">Executing</div>${escHtml(JSON.stringify(action, null, 2))}</div>`);

    try {
      let result, text, cls;

      switch (type) {

        // ── FETCH STATS ──────────────────────────────────
        case 'fetch_stats': {
          const data = await apiGet('/api/admin/stats');
          const s = data.stats || data;
          text = `<strong>System Stats</strong><br>
Students: <strong>${s.students ?? '—'}</strong><br>
Exams: <strong>${s.exams ?? '—'}</strong><br>
Questions: <strong>${s.questions ?? '—'}</strong><br>
Submissions: <strong>${s.results ?? '—'}</strong><br>
Violations: <strong>${s.violations ?? '—'}</strong>`;
          cls = 'success';
          break;
        }

        // ── FETCH STUDENTS ───────────────────────────────
        case 'fetch_students': {
          const params = action.search ? `?search=${encodeURIComponent(action.search)}` : '';
          const data   = await apiGet('/api/admin/students' + params);
          const list   = data.students || [];
          if (!list.length) { text = 'No students found.'; break; }
          text = `<strong>${list.length} student(s):</strong><br>` +
            list.slice(0, 20).map(s =>
              `• <strong>${escHtml(s.name)}</strong> — ${escHtml(s.matric)} (${escHtml(s.department_name || '—')} / ${escHtml(s.level_name || '—')})`
            ).join('<br>') +
            (list.length > 20 ? `<br><em>…and ${list.length - 20} more</em>` : '');
          break;
        }

        // ── FETCH EXAMS ──────────────────────────────────
        case 'fetch_exams': {
          await prefetchData();
          const list = cachedData.exams || [];
          if (!list.length) { text = 'No exams found.'; break; }
          text = `<strong>${list.length} exam(s):</strong><br>` +
            list.map(e =>
              `• <strong>${escHtml(e.title)}</strong> — Code: <code>${escHtml(e.access_code)}</code> | ${e.duration}min`
            ).join('<br>');
          break;
        }

        // ── FETCH QUESTIONS ──────────────────────────────
        case 'fetch_questions': {
          const data = await apiGet(`/api/admin/questions?exam_id=${action.exam_id}`);
          const list = data.questions || [];
          if (!list.length) { text = 'No questions found for this exam.'; break; }
          text = `<strong>${list.length} question(s):</strong><br>` +
            list.slice(0, 15).map((q, i) =>
              `${i+1}. ${escHtml(q.question.slice(0,80))}${q.question.length>80?'…':''} <em>(Ans: ${q.answer})</em>`
            ).join('<br>') +
            (list.length > 15 ? `<br><em>…and ${list.length - 15} more</em>` : '');
          break;
        }

        // ── ADD STUDENT ──────────────────────────────────
        case 'add_student': {
          if (!action.name || !action.matric || !action.department_id || !action.level_id) {
            text = 'Missing required fields: name, matric, department_id, level_id.'; cls = 'error'; break;
          }
          result = await apiPost('/api/admin/add-student', {
            name:          action.name,
            matric:        action.matric,
            department_id: action.department_id,
            level_id:      action.level_id
          });
          if (result.success) {
            text = `Student <strong>${escHtml(action.name)}</strong> (${escHtml(action.matric)}) added successfully!`;
            cls  = 'success';
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        // ── DELETE STUDENT ───────────────────────────────
        case 'delete_student': {
          let studentId = action.id;
          if (!studentId && action.matric) {
            // Look up by matric
            const data = await apiGet(`/api/admin/students?search=${encodeURIComponent(action.matric)}`);
            const found = (data.students || []).find(s => s.matric === action.matric);
            if (!found) { text = `No student found with matric <strong>${escHtml(action.matric)}</strong>.`; cls='error'; break; }
            studentId = found._id || found.id;
          }
          result = await apiDelete(`/api/admin/students/${studentId}`);
          if (result.success) {
            text = `Student deleted successfully.`; cls = 'success';
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        // ── ADD QUESTION ─────────────────────────────────
        case 'add_question': {
          const required = ['exam_id','question','optionA','optionB','optionC','optionD','answer'];
          const missing  = required.filter(k => !action[k]);
          if (missing.length) { text = `Missing fields: ${missing.join(', ')}`; cls='error'; break; }
          result = await apiPost('/api/admin/add-question', {
            exam_id:  action.exam_id,
            question: action.question,
            optionA:  action.optionA,
            optionB:  action.optionB,
            optionC:  action.optionC,
            optionD:  action.optionD,
            answer:   action.answer.toUpperCase()
          });
          if (result.success) {
            text = `Question added to exam successfully!`; cls = 'success';
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        // ── DELETE QUESTION ──────────────────────────────
        case 'delete_question': {
          if (!action.id) { text = 'Question ID required.'; cls='error'; break; }
          result = await apiDelete(`/api/admin/questions/${action.id}`);
          if (result.success) {
            text = `Question deleted.`; cls = 'success';
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        // ── CREATE EXAM ──────────────────────────────────
        case 'create_exam': {
          const req = ['title','course_id','department_id','level_id','access_code'];
          const mis = req.filter(k => !action[k]);
          if (mis.length) { text = `Missing fields: ${mis.join(', ')}`; cls='error'; break; }
          result = await apiPost('/api/admin/create-exam', {
            title:         action.title,
            course_id:     action.course_id,
            department_id: action.department_id,
            level_id:      action.level_id,
            duration:      action.duration || 60,
            access_code:   action.access_code,
            instructions:  action.instructions || ''
          });
          if (result.success) {
            text = `Exam <strong>${escHtml(action.title)}</strong> created! Access code: <code>${escHtml(action.access_code)}</code>`;
            cls  = 'success';
            await prefetchData(); // refresh exam list
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        // ── DELETE EXAM ──────────────────────────────────
        case 'delete_exam': {
          if (!action.id) { text = 'Exam ID required.'; cls='error'; break; }
          result = await apiDelete(`/api/admin/exams/${action.id}`);
          if (result.success) {
            text = `Exam and all its questions deleted.`; cls = 'success';
            await prefetchData();
          } else {
            text = `Failed: ${escHtml(result.message)}`; cls = 'error';
          }
          break;
        }

        default:
          text = `Unknown action type: <strong>${escHtml(type)}</strong>. Please try rephrasing.`;
          cls  = 'error';
      }

      if (text) appendMsg('assistant', text, cls);

    } catch(e) {
      appendMsg('assistant', `Action failed: ${escHtml(e.message)}`, 'error');
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────
  function appendMsg(role, html, cls = '') {
    const box = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.innerHTML = `<div class="ai-msg-bubble ${cls}">${html}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function appendThinking() {
    const box = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = 'ai-msg assistant ai-thinking';
    div.innerHTML = `<div class="ai-msg-bubble"><div class="ai-dots"><span></span><span></span><span></span></div></div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function escHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function mdToHtml(md) {
    return md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code>$1</code>')
      .replace(/\n/g,'<br>');
  }

  // Use same token as admin.js (already loaded on every admin page before this script)
  function _token() {
    return (typeof getAdminToken === 'function' ? getAdminToken() : null)
      || sessionStorage.getItem('adminToken')
      || '';
  }
  async function apiGet(url)     { const r = await fetch(url, { headers: { 'X-Admin-Token': _token() } }); return r.json(); }
  async function apiPost(url, d) { const r = await fetch(url, { method:'POST', headers: { 'Content-Type':'application/json', 'X-Admin-Token': _token() }, body:JSON.stringify(d) }); return r.json(); }
  async function apiDelete(url)  { const r = await fetch(url, { method:'DELETE', headers: { 'X-Admin-Token': _token() } }); return r.json(); }

})();
