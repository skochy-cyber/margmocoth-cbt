const fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const SRC = fs.readFileSync(process.argv[2] || require('path').join(__dirname, '../server.js'), 'utf8');

function slice(startRe, endRe) {
  const a = SRC.search(startRe); if (a < 0) throw new Error('start not found ' + startRe);
  const rest = SRC.slice(a); const b = rest.search(endRe); if (b < 0) throw new Error('end not found ' + endRe);
  return rest.slice(0, b);
}
const code = [
  slice(/function toOID\(id\)/, /async function logActivity/),
  slice(/async function getSetting\(/, /function generateRandomPassword/),
  slice(/async function fullResultPayload\(/, /\/\/ =+\s*\n\/\/ ===== LECTURER ACCOUNTS/),
].join('\n') + '\n;globalThis.submitLocks = submitLocks;';

// ---------- fake ObjectId ----------
class OID {
  constructor(v) {
    if (v === undefined || v === null) throw new Error('bad oid');
    const s = String(v);
    if (!/^[0-9a-f]{24}$/i.test(s)) throw new Error('Argument passed in must be a string of 24 hex characters');
    this.s = s.toLowerCase();
  }
  toString() { return this.s; }
  toJSON() { return this.s; }
  static gen() { return new OID(crypto.randomBytes(12).toString('hex')); }
}
const idStr = v => (v === null || v === undefined) ? null : String(v);

// ---------- fake DB with failure injection ----------
const fail = {};            // 'Model.op' -> remaining failures (Infinity = always)
function maybeFail(key) {
  if (fail[key] > 0) { fail[key]--; throw new Error('INJECTED ' + key); }
}
function match(doc, q) {
  return Object.entries(q || {}).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof OID) && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === '$ne') return idStr(v) !== idStr(x);
        if (op === '$lt') return v !== undefined && v < x;
        if (op === '$in') return x.map(idStr).includes(idStr(v));
        throw new Error('unsupported op ' + op);
      });
    }
    // Mongo semantics: null matches missing/null
    if (cond === null) return v === null || v === undefined;
    return idStr(v) === idStr(cond);
  });
}
function makeModel(name, defaults = () => ({})) {
  const rows = [];
  const M = {
    name, rows,
    async create(d) { maybeFail(name + '.create'); const r = { _id: OID.gen(), ...defaults(), ...d }; rows.push(r); return r; },
    async findOne(q) { maybeFail(name + '.findOne'); return rows.find(r => match(r, q)) || null; },
    async findById(id) { maybeFail(name + '.findById'); return rows.find(r => idStr(r._id) === idStr(id)) || null; },
    find(q) { const run = n => { maybeFail(name + '.find'); const out = rows.filter(r => match(r, q)); return n ? out.slice(0, n) : out; };
      return { limit: n => Promise.resolve().then(() => run(n)), then: (a, b) => Promise.resolve().then(() => run()).then(a, b) }; },
    async updateOne(q, u) { maybeFail(name + '.updateOne'); const r = rows.find(r => match(r, q)); if (r && u.$set) Object.assign(r, u.$set); return { matchedCount: r ? 1 : 0 }; },
    async findByIdAndUpdate(id, u) { maybeFail(name + '.findByIdAndUpdate'); const r = rows.find(r => idStr(r._id) === idStr(id)); if (r) Object.assign(r, u.$set || u); return r; },
    async findOneAndDelete(q) { maybeFail(name + '.findOneAndDelete'); const i = rows.findIndex(r => match(r, q)); return i >= 0 ? rows.splice(i, 1)[0] : null; },
    async countDocuments(q) { return rows.filter(r => match(r, q)).length; },
  };
  return M;
}
const DB = {};
function reset() {
  for (const k of Object.keys(fail)) delete fail[k];
  DB.ExamSession = makeModel('ExamSession', () => ({ answers: {}, shuffled_answer_map: {}, status: 'active', submit_requested: false, submit_time_taken: 0, started_at: new Date() }));
  DB.ExamResult = makeModel('ExamResult');
  DB.Question = makeModel('Question');
  DB.Exam = makeModel('Exam');
  DB.Student = makeModel('Student');
  DB.Setting = makeModel('Setting');
  DB.RetakeGrant = makeModel('RetakeGrant');
  DB.ExamReview = makeModel('ExamReview');
  Object.assign(ctx, DB);
}

// ---------- context ----------
const routes = {}; const intervals = []; const mails = [];
const logs = [];
const ctx = {
  OID, Date, Promise, Object, String, Set, Map, JSON, Math, Array, Number, Error,
  console: { log() {}, warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]) },
  app: { post: (p, h) => { routes['POST ' + p] = h; }, get: (p, h) => { routes['GET ' + p] = h; }, put() {}, delete() {} },
  mongoose: { connection: { readyState: 1 } },
  setInterval: (fn, ms) => { intervals.push(fn); },
  sendMail: async m => { mails.push(m); },
};
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'server-extract.js' });
reset();

// ---------- helpers ----------
async function post(body) {
  let out; const res = { json: o => { out = o; return o; } };
  await routes['POST /api/submit-exam']({ body }, res);
  return out;
}
const sweep = () => ctx.finalizeStrandedSubmissions();

function seed({ nq = 4, shuffled = true } = {}) {
  const exam = { _id: OID.gen(), title: 'Anatomy 101', retake_request_allowed: true };
  DB.Exam.rows.push(exam);
  const qs = [];
  for (let i = 0; i < nq; i++) {
    const q = { _id: OID.gen(), exam_id: exam._id, question: 'Q' + i, optionA: 'a', optionB: 'b', optionC: 'c', optionD: 'd', answer: 'A' };
    DB.Question.rows.push(q); qs.push(q);
  }
  const student = { _id: OID.gen(), name: 'Ada', email: 'ada@example.com' };
  DB.Student.rows.push(student);
  const map = {}; if (shuffled) qs.forEach((q, i) => { map[String(q._id)] = 'BCDA'[i % 4]; });
  const sess = { _id: OID.gen(), student_id: student._id, exam_id: exam._id, status: 'active', answers: {}, shuffled_answer_map: map, submit_requested: false, submit_time_taken: 0 };
  DB.ExamSession.rows.push(sess);
  const allRight = {}; qs.forEach(q => { allRight[String(q._id)] = shuffled ? map[String(q._id)] : 'A'; });
  return { exam, qs, student, sess, map, allRight, body: (extra = {}) => ({ session_id: String(sess._id), student_id: String(student._id), exam_id: String(exam._id), answers: allRight, time_taken: 120, ...extra }) };
}

// ---------- tiny test runner ----------
let pass = 0, failN = 0; const failures = [];
function ok(name, cond, extra) { if (cond) { pass++; console.info('  PASS', name); } else { failN++; failures.push(name); console.info('  FAIL', name, extra !== undefined ? '-> ' + JSON.stringify(extra) : ''); } }
async function t(title, fn) { console.info('\n# ' + title); reset(); mails.length = 0; logs.length = 0; try { await fn(); } catch (e) { failN++; failures.push(title + ' (threw)'); console.info('  FAIL threw:', e.stack.split('\n').slice(0, 3).join(' | ')); } }
const results = () => DB.ExamResult.rows;

module.exports = { t, ok, seed, post, sweep, fail, DB, ctx, OID, results, mails, logs, routes, summary: () => { console.info(`\n==== ${pass} passed, ${failN} failed ====`); if (failures.length) console.info('FAILED:', failures); return failN; } };
