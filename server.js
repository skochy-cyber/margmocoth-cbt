// ===== MARGMOCOTH CBT SERVER — Enhanced Edition =====
require('dotenv').config();
const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const crypto     = require('crypto');
const https      = require('https');
const session    = require('express-session');
const MongoStore = require('connect-mongo');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');

const cloudinary = require('cloudinary').v2;
// (email/Mailjet/Resend removed — MARGMOCOTH CBT does not send mail)

const app  = express();
const PORT = process.env.PORT || 3000;
// Used only if SESSION_SECRET is missing; random per boot (sessions reset on restart). Set SESSION_SECRET in production.
const SESSION_FALLBACK = require('crypto').randomBytes(32).toString('hex');
const OID  = mongoose.Types.ObjectId;

// ===== CLOUDINARY CONFIGURATION =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ===== MONGODB CONNECTION =====
const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('[FATAL] MONGODB_URI is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => { console.log('[OK] MongoDB Connected'); initDB(); })
  .catch(err => console.error('[ERROR] MongoDB Error:', err));

// ===== SCHEMAS =====
const AdminSchema = new mongoose.Schema({
  username:      { type: String, unique: true, required: true },
  password:      { type: String, required: true },
  activeToken:   { type: String, default: null },
  display_name:  { type: String, default: '' },
  role:          { type: String, enum: ['super', 'admin', 'moderator', 'lecturer'], default: 'super' },
  permissions:   { type: [String], default: [] },
  department_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  created_at:    { type: Date, default: Date.now }
});

const CourseSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  code:          String,
  department_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  level_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Level',      default: null },
  created_at:    { type: Date, default: Date.now }
});

const DepartmentSchema = new mongoose.Schema({
  name:            { type: String, unique: true, required: true },
  description:     String,
  sub_departments: [{ type: String }],   // e.g. ['Owo Campus', 'Ondo Campus']
  created_at:      { type: Date, default: Date.now }
});

const LevelSchema = new mongoose.Schema({
  name:       { type: String, unique: true, required: true },
  created_at: { type: Date, default: Date.now }
});

const SemesterSchema = new mongoose.Schema({
  name:       { type: String, required: true },          // e.g. "First Semester 2024/2025"
  session:    { type: String, required: true },          // e.g. "2024/2025"
  type:       { type: String, enum: ['first','second','third'], default: 'first' },
  is_active:  { type: Boolean, default: false },
  started_at: { type: Date, default: Date.now },
  ended_at:   { type: Date, default: null },
  created_at: { type: Date, default: Date.now }
});

const StudentSchema = new mongoose.Schema({
  name:            { type: String, required: true },
  matric:          { type: String, unique: true, sparse: true }, // matric number — can be used (with password) to sign in
  department_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Department' }, // student's department
  sub_department:  { type: String, default: null },
  level_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Level' },       // student's level (100L-400L)
  password:        { type: String, required: true },
  phone:           { type: String, default: null },
  email:           { type: String, default: null },
  self_registered: { type: Boolean, default: false },
  last_login:      { type: Date, default: null },
  profile_photo_url:       { type: String, default: null },
  profile_photo_public_id: { type: String, default: null },
  capture_locked:          { type: Boolean, default: false },
  created_at:      { type: Date, default: Date.now }
});

const ExamSchema = new mongoose.Schema({
  title:              { type: String, required: true },
  course_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  department_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  level_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Level' },
  semester_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', default: null },
  duration:           { type: Number, default: 60 },
  access_code:        { type: String, unique: true, sparse: true },
  start_date:         Date,
  end_date:           Date,
  allow_retake:           { type: Boolean, default: false },
  retake_request_allowed: { type: Boolean, default: true },
  shuffle_questions:  { type: Boolean, default: true },
  shuffle_answers:    { type: Boolean, default: false },
  question_pool_size: { type: Number, default: 0 }, // 0 = use all questions
  instructions:       String,
  created_by:         { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
  assigned_to:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }], // lecturers allowed to add questions
  assigned_to_all:    { type: Boolean, default: false }, // true = every lecturer can work on this exam
  allowed_students:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }], // if set, only these students can use the access code
  access_restrictions_saved: { type: Boolean, default: false }, // true once admin has explicitly saved the access list
  created_at:         { type: Date, default: Date.now }
});

const QuestionSchema = new mongoose.Schema({
  exam_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  question:      { type: String, required: true },
  question_type: { type: String, enum: ['multiple_choice', 'true_false'], default: 'multiple_choice' },
  optionA:       { type: String, required: true },
  optionB:       { type: String, required: true },
  optionC:       { type: String, default: '' },
  optionD:       { type: String, default: '' },
  answer:        { type: String, enum: ['A','B','C','D'], required: true },
  created_at:    { type: Date, default: Date.now }
});

const ExamSessionSchema = new mongoose.Schema({
  student_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  exam_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  answers:             { type: mongoose.Schema.Types.Mixed, default: {} },
  violations:          { type: Number, default: 0 },
  shuffled_answer_map: { type: mongoose.Schema.Types.Mixed, default: {} }, // per-student shuffled answer keys
  shuffled_options_map: { type: mongoose.Schema.Types.Mixed, default: {} }, // per-student shuffled option order { qid: ['text_A','text_B','text_C','text_D'] }
  started_at:          { type: Date, default: Date.now },
  submitted_at:        Date,
  status:              { type: String, enum: ['active','submitted'], default: 'active' },
  submit_requested:    { type: Boolean, default: false },   // set the moment a submit reaches the server
  submit_requested_at: Date,
  submit_time_taken:   { type: Number, default: 0 }
});

const ExamResultSchema = new mongoose.Schema({
  student_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  exam_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  session_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSession' },
  total:             Number,
  correct:           Number,
  wrong:             Number,
  percentage:        Number,
  time_taken:        Number,
  submitted_at:      { type: Date, default: Date.now },
  score_edited:      { type: Boolean, default: false },
  score_edited_by:   { type: String, default: null },
  score_edited_at:   { type: Date,   default: null },
  score_edit_reason: { type: String, default: null }
});

// Enhanced Violation Schema — tracks type: rule_violation | network_error | system_error
const ViolationSchema = new mongoose.Schema({
  session_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'ExamSession' },
  reason:         String,
  count:          Number,
  violation_type: {
    type:    String,
    enum:    ['rule_violation', 'network_error', 'system_error'],
    default: 'rule_violation'
  },
  sub_type: {
    type:    String,
    enum:    ['tab_switch', 'focus_loss', 'duplicate_ip', 'fullscreen_exit', 'back_nav',
              'face', 'side_look', 'voice', 'screenshot', 'multiple_faces', 'no_face', 'identity', 'other'],
    default: 'other'
  },
  capture_url:    { type: String, default: null }, // Cloudinary URL of webcam capture at violation moment
  clip_url:       { type: String, default: null }, // Cloudinary URL of mouth-movement video clip
  created_at:     { type: Date, default: Date.now }
});

const SettingSchema = new mongoose.Schema({
  key:   { type: String, unique: true, required: true },
  value: { type: mongoose.Schema.Types.Mixed }
});

const RetakeGrantSchema = new mongoose.Schema({
  student_id: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Student',
    unique:   true,
    required: true
  },
  granted_at: { type: Date, default: Date.now }
});

const FaceCaptureSchema = new mongoose.Schema({
  student_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  exam_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  student_name:   String,
  matric:         String,
  exam_title:     String,
  cloudinary_url: String,
  public_id:      String,
  face_verified:  { type: Boolean, default: false },
  match_score:    { type: Number,  default: 0 },
  flagged:        { type: Boolean, default: false },
  flag_reason:    { type: String,  default: null },
  captured_at:    { type: Date, default: Date.now }
});

// Generated Password Schema — for batch student login passwords
const GeneratedPasswordSchema = new mongoose.Schema({
  plain_password: String,
  label:          String,
  scope:          { type: String, default: 'general' },
  expires_at:     { type: Date, default: null },
  use_once:       { type: Boolean, default: false },
  used_by:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }],
  created_by:     String,
  created_at:     { type: Date, default: Date.now },
  is_active:      { type: Boolean, default: true }
});

// Password Audit Log — tracks who generated passwords and when
const PasswordAuditLogSchema = new mongoose.Schema({
  action:      String,
  admin:       String,
  details:     String,
  created_at:  { type: Date, default: Date.now }
});

// Activity Log — tracks actions performed by lecturers (visible to super admin)
const ActivityLogSchema = new mongoose.Schema({
  admin_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  admin_name:  { type: String, required: true },
  action:      { type: String, required: true },
  detail:      { type: String, default: '' },
  created_at:  { type: Date, default: Date.now }
});

// ExamReview: per-question answer snapshot stored after submission for review
const ExamReviewSchema = new mongoose.Schema({
  result_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'ExamResult', required: true },
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  exam_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam' },
  questions:  [{
    question_id:    String,
    question:       String,
    optionA: String, optionB: String, optionC: String, optionD: String,
    student_answer: String,
    correct_answer: String,
    is_correct:     Boolean
  }],
  created_at: { type: Date, default: Date.now }
});

// LoginAudit: tracks student login IPs to detect concurrent sessions
const LoginAuditSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  matric:     String,
  ip:         String,
  user_agent: String,
  exam_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null },
  created_at: { type: Date, default: Date.now }
});


const RetakeRequestSchema = new mongoose.Schema({
  student_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Exam',    required: true },
  result_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'ExamResult', default: null },
  reason:       { type: String, default: '' },
  status:       { type: String, enum: ['pending','approved','declined'], default: 'pending' },
  admin_note:   { type: String, default: '' },
  requested_at: { type: Date, default: Date.now },
  reviewed_at:  { type: Date, default: null }
});


// ===== MODELS =====
const Admin             = mongoose.model('Admin',             AdminSchema);
const Course            = mongoose.model('Course',            CourseSchema);
const Department        = mongoose.model('Department',        DepartmentSchema);
const Level             = mongoose.model('Level',             LevelSchema);
const Semester          = mongoose.model('Semester',          SemesterSchema);
const Student           = mongoose.model('Student',           StudentSchema);
const Exam              = mongoose.model('Exam',              ExamSchema);
const Question          = mongoose.model('Question',          QuestionSchema);
const ExamSession       = mongoose.model('ExamSession',       ExamSessionSchema);
const ExamResult        = mongoose.model('ExamResult',        ExamResultSchema);
const Violation         = mongoose.model('Violation',         ViolationSchema);
const Setting           = mongoose.model('Setting',           SettingSchema);
const RetakeGrant       = mongoose.model('RetakeGrant',       RetakeGrantSchema);
const FaceCapture       = mongoose.model('FaceCapture',       FaceCaptureSchema);
const GeneratedPassword = mongoose.model('GeneratedPassword', GeneratedPasswordSchema);
const PasswordAuditLog  = mongoose.model('PasswordAuditLog',  PasswordAuditLogSchema);
const ActivityLog       = mongoose.model('ActivityLog',       ActivityLogSchema);
const ExamReview        = mongoose.model('ExamReview',        ExamReviewSchema);
const LoginAudit        = mongoose.model('LoginAudit',        LoginAuditSchema);
const RetakeRequest     = mongoose.model('RetakeRequest',     RetakeRequestSchema);

// ===== NAME / MATRIC CHANGE REQUESTS =====
const NameChangeRequestSchema = new mongoose.Schema({
  student_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  request_type: { type: String, enum: ['name', 'matric'], required: true },
  current_value:{ type: String, required: true },
  new_value:    { type: String, required: true },
  reason:       { type: String, default: '' },
  status:       { type: String, enum: ['pending','approved','declined'], default: 'pending' },
  admin_note:   { type: String, default: '' },
  reviewed_by:  { type: String, default: null },
  reviewed_at:  { type: Date, default: null },
  requested_at: { type: Date, default: Date.now }
});
const NameChangeRequest = mongoose.model('NameChangeRequest', NameChangeRequestSchema);


// ===== SUPPORT CONVERSATIONS (MARGMOCOTH Support) =====
const SupportMsgSchema = new mongoose.Schema({
  role:       { type: String, enum: ['student','support','admin'], required: true },
  content:    { type: String, required: true },
  is_ai:      { type: Boolean, default: false },
  created_at: { type: Date,   default: Date.now }
});
const SupportConversationSchema = new mongoose.Schema({
  student_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, unique: true },
  messages:        [SupportMsgSchema],
  admin_unread:    { type: Boolean, default: true },
  updated_at:      { type: Date, default: Date.now }
});

const AnnouncementSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  body:       { type: String, required: true },
  type:       { type: String, enum: ['info','warning','success'], default: 'info' },
  target:     { type: String, enum: ['all','department'], default: 'all' },
  dept_ids:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  active:     { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now }
});
const SupportConversation = mongoose.model('SupportConversation', SupportConversationSchema);

// Login page assistant conversations (guest — no student auth required)
const LoginMsgSchema = new mongoose.Schema({
  role:       { type: String, enum: ['user', 'assistant'], required: true },
  content:    { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});
const LoginConversationSchema = new mongoose.Schema({
  session_key:  { type: String, required: true, unique: true },
  student_name: { type: String, default: '' },   // filled in once a name lookup succeeds
  messages:     [LoginMsgSchema],
  updated_at:   { type: Date, default: Date.now }
});
const LoginConversation = mongoose.model('LoginConversation', LoginConversationSchema);

// Broadcast history log
const BroadcastLogSchema = new mongoose.Schema({
  type:       { type: String, enum: ['push', 'email'], required: true },
  title:      { type: String, default: '' },
  body:       { type: String, required: true },
  target:     { type: String, default: 'All Students' },
  sent:       { type: Number, default: 0 },
  failed:     { type: Number, default: 0 },
  total:      { type: Number, default: 0 },
  status:     { type: String, enum: ['sending', 'completed'], default: 'completed' },
  created_at: { type: Date, default: Date.now }
});
const BroadcastLog = mongoose.model('BroadcastLog', BroadcastLogSchema);
const Announcement = mongoose.model('Announcement', AnnouncementSchema);

// ===== SETUP =====
const uploadsDir = path.join(__dirname, 'public', 'uploads', 'webcam');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 }
});

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || SESSION_FALLBACK,
  resave:            false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl:    MONGO_URI,
    collectionName: 'sessions',
    ttl:         24 * 60 * 60 // sessions expire after 24 hours
  }),
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000 // 24 hours in ms
  }
}));
app.use(express.static(path.join(__dirname, 'public')));
// PWA: serve icons and sw.js from project root
app.use('/icons', express.static(path.join(__dirname, 'public/icons')));
app.get('/sw.js',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'sw.js')));
app.get('/manifest.json',(req,res) => res.sendFile(path.join(__dirname, 'public', 'manifest.json')));

// Serve login.html at /login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve register.html at /register (used by dept registration links)
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// ===== EMAIL REMOVED =====
// MARGMOCOTH CBT does not send email. Password resets are handled by an admin
// directly in the admin panel. This stub keeps existing call sites from crashing.
async function sendMail({ to, subject, html }) {
  console.warn('[Mail] Email sending is disabled in MARGMOCOTH CBT.');
  return false;
}

// ===== ADMIN AUTH MIDDLEWARE =====
// Simple token passed as X-Admin-Token header or query param
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query._t;
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });
  // Check session first, then fall back to DB lookup
  if (req.session && req.session.adminToken === token) return next();
  // Session may have been lost (server restart) — verify token against DB
  Admin.findOne({ activeToken: token }).then(admin => {
    if (!admin) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    next();
  }).catch(() => res.status(401).json({ success: false, message: 'Unauthorized' }));
}

// ===== HELPERS =====
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toOID(id) {
  try {
    if (id && typeof id === 'object' && id.$oid) return new OID(id.$oid);
    return new OID(id.toString());
  } catch(e) { return null; }
}

async function logActivity(admin_id, admin_name, action, detail = '') {
  try { await ActivityLog.create({ admin_id, admin_name, action, detail }); } catch(e) {}
}

async function getSetting(key, defaultVal = null) {
  try {
    const s = await Setting.findOne({ key });
    return s ? s.value : defaultVal;
  } catch(e) { return defaultVal; }
}

function generateRandomPassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ===== SEED DATA =====
async function initDB() {
  // Ensure super admin exists; sub-accounts (lecturers) are never deleted on restart
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'Margmocoth.examinationsmedia@gmail.com';
  const superAdmin = await Admin.findOne({ username: ADMIN_EMAIL });
  if (!superAdmin) {
    // Password comes from ADMIN_PASSWORD; if unset, a random one is generated and printed ONCE below.
    let adminPass = process.env.ADMIN_PASSWORD;
    const generated = !adminPass;
    if (generated) adminPass = require('crypto').randomBytes(9).toString('base64url');
    await Admin.deleteMany({ role: { $ne: 'lecturer' } }); // clear stale supers only
    await Admin.create({
      username:     ADMIN_EMAIL,
      password:     bcrypt.hashSync(adminPass, 10),
      display_name: 'Super Admin',
      role:         'super',
      permissions:  []
    });
    console.log('[OK] Super admin account created: ' + ADMIN_EMAIL);
    if (generated) console.log('[IMPORTANT] Generated admin password (shown once, change it after login): ' + adminPass);
  } else if (!superAdmin.role || superAdmin.role !== 'super') {
    // Migrate legacy admin record
    await Admin.updateOne({ username: ADMIN_EMAIL },
      { role: 'super', display_name: superAdmin.display_name || 'Super Admin', permissions: [] });
    console.log('[OK] Super admin record migrated');
  }

  // Departments and Levels for Margaret Mosunmola College of Health Science and Technology
  for (const name of ['Community Health','Public Health','HIM','Medical Laboratory']) {
    await Department.findOneAndUpdate({ name }, { name }, { upsert: true });
  }
  for (const name of ['100L','200L','300L','400L']) {
    await Level.findOneAndUpdate({ name }, { name }, { upsert: true });
  }

  const defaults = [
    { key: 'portal_open',             value: true  },
    { key: 'maintenance_msg',         value: 'The exam portal is currently closed. Please check back later.' },
    { key: 'show_results',            value: false },
    { key: 'show_percentage',         value: true  },
    { key: 'show_score_breakdown',    value: true  },
    { key: 'show_grade',              value: true  },
    { key: 'allow_prev_question',     value: true  },
    { key: 'show_instructions',       value: true  },
    { key: 'max_violations',          value: 3     },
    { key: 'exam_rules',              value: ''    },
    { key: 'webcam_enabled',          value: false },
    { key: 'fullscreen_enabled',      value: true  },
    { key: 'anticheat_enabled',       value: true  },
    { key: 'face_anticheat_enabled',  value: false },
    { key: 'face_verify_required',    value: false },
    { key: 'student_capture_enabled', value: false },
    { key: 'restrict_side_look',      value: false },
    { key: 'reshuffle_on_violation',  value: false },
    { key: 'restrict_voice',          value: false },
    { key: 'violation_volume',        value: 50    },
    { key: 'global_allow_retake',     value: false },
    { key: 'school_name',             value: 'Margaret Mosunmola College of Health Science and Technology' },
    { key: 'school_short',            value: 'MARGMOCOTH'             },
    { key: 'contact_email',           value: 'Margmocoth.examinationsmedia@gmail.com'},
    { key: 'contact_phone',           value: ''      },
    { key: 'marquee_text',            value: 'MARGMOCOTH CBT System | Powered by Tribal Tech' },
  ];

  for (const s of defaults) {
    await Setting.findOneAndUpdate(
      { key: s.key },
      { $setOnInsert: { key: s.key, value: s.value } },
      { upsert: true }
    );
  }
  console.log('[OK] Database seeded');

  // NOTE: Migration block removed — it was forcing face_anticheat_enabled / restrict_side_look /
  // restrict_voice back to true on every server reboot, overriding admin toggle saves.
  // Seeds above use $setOnInsert so they only write on first boot; subsequent admin changes
  // are now respected across restarts.

  // REBRAND MIGRATION — force-overwrite old school name/short if they still contain
  // the previous institution name, so the database is always up to date after redeployment.
  const oldNames = ['MARGMOCOTH CBT','MARGARET MOSUNMOLA COLLEGE OF HEALTH SCIENCE AND TECHNOLOGY'];
  const currentName = await Setting.findOne({ key: 'school_name' });
  if (currentName && oldNames.includes(currentName.value)) {
    await Setting.updateOne({ key: 'school_name' },  { $set: { value: 'Margaret Mosunmola College of Health Science and Technology' } });
    await Setting.updateOne({ key: 'school_short' }, { $set: { value: 'MARGMOCOTH' } });
    console.log('[MIGRATION] school_name and school_short set for Margaret Mosunmola College');
  }
}

// ===========================
// ===== PUBLIC API ROUTES ===
// ===========================

app.get('/api/courses', async (req, res) => {
  const filter = {};
  if (req.query.dept_id) filter.department_id = req.query.dept_id;
  const courses = await Course.find(filter).sort({ name: 1 }).populate('department_id').populate('level_id');
  res.json(courses.map(c => ({
    id: c._id, name: c.name, code: c.code,
    department_id:   c.department_id?._id?.toString() || null,
    department_name: c.department_id?.name || null,
    level_id:        c.level_id?._id?.toString() || null,
    level_name:      c.level_id?.name || null
  })));
});

app.get('/api/departments', async (req, res) => {
  const depts  = await Department.find().sort({ name: 1 });
  const result = await Promise.all(depts.map(async d => ({
    id: d._id, name: d.name, description: d.description,
    sub_departments: d.sub_departments || [],
    student_count: await Student.countDocuments({ department_id: d._id })
  })));
  res.json(result);
});

app.get('/api/levels', async (req, res) => {
  const levels = await Level.find().sort({ name: 1 });
  const result = await Promise.all(levels.map(async l => ({
    id: l._id, name: l.name,
    student_count: await Student.countDocuments({ level_id: l._id })
  })));
  res.json(result);
});

app.get('/api/settings/portal', async (req, res) => {
  try {
    const keys     = ['portal_open','maintenance_msg','school_name','school_short',
                      'marquee_text','contact_email','contact_phone','registration_open','dept_reg_settings'];
    const settings = await Setting.find({ key: { $in: keys } });
    const obj      = Object.fromEntries(settings.map(s => [s.key, s.value]));
    res.json({ ...obj, registration_open: obj.registration_open !== undefined ? obj.registration_open : false });
  } catch(e) {
    res.json({ portal_open: true, registration_open: false });
  }
});

// Public endpoint: validate dept registration token & return dept info
app.get('/api/dept-reg-check', async (req, res) => {
  try {
    const { dept_id, token } = req.query;
    if (!dept_id || !token) return res.json({ valid: false, message: 'Missing parameters.' });

    const drs  = await getSetting('dept_reg_settings', {});
    const cfg  = drs[dept_id];
    if (!cfg || cfg.token !== token) return res.json({ valid: false, message: 'Invalid registration link.' });
    if (!cfg.enabled) return res.json({ valid: false, message: 'Registration for this department is currently closed.' });
    if (cfg.closes_at && new Date(cfg.closes_at) < new Date()) return res.json({ valid: false, message: 'Registration for this department has closed.' });

    const dept = await Department.findById(dept_id);
    if (!dept) return res.json({ valid: false, message: 'Department not found.' });

    res.json({ valid: true, dept_id: dept._id.toString(), dept_name: dept.name, closes_at: cfg.closes_at || null });
  } catch(e) { res.json({ valid: false, message: e.message }); }
});

// * DEBUG — visit /api/debug/anticheat in browser to confirm live DB values. Remove after confirming.
app.get('/api/debug/anticheat', async (req, res) => {
  try {
    const keys = ['face_anticheat_enabled','restrict_side_look','restrict_voice','anticheat_enabled','webcam_enabled'];
    const settings = await Setting.find({ key: { $in: keys } });
    res.json(Object.fromEntries(settings.map(s => [s.key, s.value])));
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/settings/exam-engine', async (req, res) => {
  try {
    const keys = [
      'allow_prev_question','show_instructions','max_violations','exam_rules',
      'webcam_enabled','fullscreen_enabled','anticheat_enabled','face_anticheat_enabled',
      'restrict_side_look','reshuffle_on_violation','restrict_voice','global_allow_retake',
      'show_results','show_percentage','show_score_breakdown','show_grade','face_verify_required',
      'calculator_enabled','violation_volume'
    ];
    const settings = await Setting.find({ key: { $in: keys } });
    const obj      = Object.fromEntries(settings.map(s => [s.key, s.value]));
    res.json({
      allow_prev_question:    obj.allow_prev_question    !== undefined ? obj.allow_prev_question    : true,
      show_instructions:      obj.show_instructions      !== undefined ? obj.show_instructions      : true,
      max_violations:         obj.max_violations         !== undefined ? obj.max_violations         : 3,
      exam_rules:             obj.exam_rules             || '',
      webcam_enabled:         obj.webcam_enabled         !== undefined ? obj.webcam_enabled         : true,
      fullscreen_enabled:     obj.fullscreen_enabled     !== undefined ? obj.fullscreen_enabled     : true,
      anticheat_enabled:      true,  // basic tab-switch / fullscreen-exit warning only — no AI proctoring
      face_anticheat_enabled: obj.face_anticheat_enabled === true,
      restrict_side_look:     obj.restrict_side_look     === true,
      reshuffle_on_violation: obj.reshuffle_on_violation === true,
      restrict_voice:         obj.restrict_voice         === true,
      // 1 = AI captures slowly / leniently, 100 = very sharp monitoring
      violation_volume:       Math.min(100, Math.max(1, Math.round(Number(obj.violation_volume)) || 50)),
      global_allow_retake:    obj.global_allow_retake    !== undefined ? obj.global_allow_retake    : false,
      show_results:           obj.show_results           !== undefined ? obj.show_results           : false,
      show_percentage:        obj.show_percentage        !== undefined ? obj.show_percentage        : true,
      show_score_breakdown:   obj.show_score_breakdown   !== undefined ? obj.show_score_breakdown   : true,
      show_grade:             obj.show_grade             !== undefined ? obj.show_grade             : true,
      face_verify_required:   false, // AI face verification removed
      calculator_enabled:     obj.calculator_enabled     !== undefined ? obj.calculator_enabled     : false,
    });
  } catch(e) {
    // IMPORTANT: on error, default ALL anticheat features to OFF (safe side).
    // Previously this block defaulted restrict_voice/face_anticheat/restrict_side_look to true,
    // which caused violations to fire even when admin had disabled them — because a transient
    // DB error at exam start would return this hardcoded response instead of saved settings.
    res.json({
      allow_prev_question: true, show_instructions: true, max_violations: 3, exam_rules: '',
      webcam_enabled: true, fullscreen_enabled: true, anticheat_enabled: true,
      face_anticheat_enabled: false, restrict_side_look: false,
      reshuffle_on_violation: false, restrict_voice: false, global_allow_retake: false,
      show_results: false, show_percentage: true, show_score_breakdown: true, show_grade: true,
      face_verify_required: false, violation_volume: 50
    });
  }
});

// ===== LOGIN / REGISTRATION HELPERS =====
function escapeRegex(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function cleanSpaces(str) { return String(str || '').trim().replace(/\s+/g, ' '); }
function normalizeMatric(str) { return cleanSpaces(str).toUpperCase(); }

// Find every student whose name, matric number or email equals the identifier
// (case-insensitive, extra spaces ignored).
async function findStudentsByIdentifier(identifier) {
  const id = cleanSpaces(identifier);
  if (!id) return [];
  const exact = { $regex: `^${escapeRegex(id)}$`, $options: 'i' };
  const or = [{ name: exact }, { matric: exact }];
  if (id.includes('@')) or.push({ email: exact });
  return Student.find({ $or: or }).populate('department_id').populate('level_id');
}

// A student password is valid if it matches their own hash, or the currently
// active generated password for their department (given out by the exam office).
async function studentPasswordMatches(student, plain) {
  if (!plain) return false;
  try { if (student.password && bcrypt.compareSync(plain, student.password)) return true; } catch(e) {}
  const deptName = student.department_id?.name || '';
  if (!deptName) return false;
  const genPw = await GeneratedPassword.findOne({
    scope: deptName, is_active: true,
    $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }]
  }).sort({ created_at: -1 });
  return !!(genPw && genPw.plain_password === plain);
}

// Very small in-memory brute-force guard: 8 failed attempts / 10 min per IP + identifier.
const _loginFails = new Map();
function loginThrottleKey(req, identifier) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  return ip + '|' + cleanSpaces(identifier).toLowerCase();
}
function loginIsBlocked(key) {
  const e = _loginFails.get(key);
  if (!e) return false;
  if (Date.now() - e.first > 10 * 60 * 1000) { _loginFails.delete(key); return false; }
  return e.count >= 8;
}
function loginRecordFail(key) {
  const e = _loginFails.get(key);
  if (!e || Date.now() - e.first > 10 * 60 * 1000) _loginFails.set(key, { count: 1, first: Date.now() });
  else e.count++;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _loginFails) if (now - e.first > 10 * 60 * 1000) _loginFails.delete(k);
}, 10 * 60 * 1000).unref();

// Self-registration — only works if registration_open setting is true OR valid dept token link
app.post('/api/student-register', async (req, res) => {
  try {
    const { name, matric, phone, email, department_id, level_id, password, dept_token } = req.body;
    if (!name || !name.trim()) return res.json({ success: false, message: 'Full name is required.' });
    if (!matric || !matric.trim()) return res.json({ success: false, message: 'Matric number is required.' });
    if (matric.trim().length < 3 || matric.trim().length > 40) return res.json({ success: false, message: 'Please enter a valid matric number.' });
    if (!phone && !email) return res.json({ success: false, message: 'Please provide at least a phone number or email.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.json({ success: false, message: 'Please enter a valid email address.' });
    if (!level_id) return res.json({ success: false, message: 'Please select your level.' });
    if (!department_id) return res.json({ success: false, message: 'Please select your department.' });
    if (!password || password.length < 6) return res.json({ success: false, message: 'Password must be at least 6 characters.' });

    // Check registration permission: global toggle OR valid dept token
    const drs = await getSetting('dept_reg_settings', {});
    const cfg = drs[department_id];
    const hasDeptToken = dept_token && cfg && cfg.token === dept_token && cfg.enabled &&
      (!cfg.closes_at || new Date(cfg.closes_at) > new Date());

    if (!hasDeptToken) {
      const regOpen = await getSetting('registration_open', false);
      if (!regOpen) return res.json({ success: false, message: 'Student self-registration is currently disabled.' });
    }

    const cleanName    = cleanSpaces(name);
    const cleanMatric  = normalizeMatric(matric);

    // Duplicate matric number (case-insensitive)
    const existingMatric = await Student.findOne({ matric: { $regex: `^${escapeRegex(cleanMatric)}$`, $options: 'i' } });
    if (existingMatric) return res.json({ success: false, message: 'This matric number is already registered. If it is yours, sign in instead or contact the examination office.' });

    // Duplicate name within same level + department
    const existingName = await Student.findOne({
      name:          { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' },
      department_id: toOID(department_id),
      level_id:      toOID(level_id)
    });
    if (existingName) return res.json({ success: false, message: `A student named "${cleanName}" is already registered in this level and department. Contact your administrator — do not create a duplicate account.` });

    // Duplicate phone
    if (phone && phone.trim()) {
      const existingPhone = await Student.findOne({ phone: phone.trim() });
      if (existingPhone) return res.json({ success: false, message: 'This phone number is already linked to an existing account.' });
    }

    // Duplicate email
    if (email && email.trim()) {
      const existingEmail = await Student.findOne({ email: { $regex: `^${escapeRegex(email.trim())}$`, $options: 'i' } });
      if (existingEmail) return res.json({ success: false, message: 'This email address is already linked to an existing account.' });
    }

    await Student.create({
      name:            cleanName,
      matric:          cleanMatric,
      department_id:   toOID(department_id),
      level_id:        toOID(level_id),
      phone:           phone ? phone.trim() : null,
      email:           email ? email.trim().toLowerCase() : null,
      password:        bcrypt.hashSync(password, 10),
      self_registered: true
    });
    res.json({ success: true, message: 'Registration successful! You can now sign in with your name, matric number or email and your password.' });
  } catch(e) {
    if (e.code === 11000) return res.json({ success: false, message: 'This matric number is already registered.' });
    res.json({ success: false, message: e.message });
  }
});

// Student login: ONE identifier (full name OR matric number OR email) + password.
app.post('/api/student-login', async (req, res) => {
  try {
    const body = req.body || {};
    const identifier = cleanSpaces(body.identifier || body.matric || body.email || body.name || '');
    const password   = typeof body.password === 'string' ? body.password : '';

    const portalOpen = await getSetting('portal_open', true);
    if (!portalOpen) {
      const msg = await getSetting('maintenance_msg', 'The exam portal is currently closed.');
      return res.json({ success: false, message: msg });
    }
    if (!identifier) return res.json({ success: false, message: 'Please enter your name, matric number or email.' });
    if (!password)   return res.json({ success: false, message: 'Please enter your password.' });

    const throttleKey = loginThrottleKey(req, identifier);
    if (loginIsBlocked(throttleKey))
      return res.json({ success: false, message: 'Too many failed attempts. Please wait 10 minutes and try again, or ask the examination office to reset your password.' });

    const candidates = await findStudentsByIdentifier(identifier);
    if (!candidates.length) {
      loginRecordFail(throttleKey);
      return res.json({ success: false, message: 'No account found with that name, matric number or email.' });
    }

    const matched = [];
    for (const c of candidates) { if (await studentPasswordMatches(c, password)) matched.push(c); }

    if (!matched.length) {
      loginRecordFail(throttleKey);
      return res.json({ success: false, message: 'Incorrect password. Please try again.' });
    }
    if (matched.length > 1) {
      return res.json({ success: false, message: 'More than one student has that name. Please sign in with your matric number or email instead.' });
    }
    const student = matched[0];
    _loginFails.delete(throttleKey);

    // Log login IP for concurrent session detection
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const ua = req.headers['user-agent'] || '';
    await LoginAudit.create({ student_id: student._id, matric: student.matric || student.name, ip, user_agent: ua });
    const previousLastLogin = student.last_login;
    await Student.findByIdAndUpdate(student._id, { last_login: new Date() });

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentLogins = await LoginAudit.find({
      student_id: student._id,
      created_at: { $gte: fiveMinAgo }
    }).sort({ created_at: -1 }).limit(10);
    const otherIPs = [...new Set(recentLogins.map(l => l.ip))].filter(l => l !== ip);
    const concurrentWarning = otherIPs.length > 0;

    res.json({
      success: true,
      concurrent_warning: concurrentWarning,
      student: {
        id:            student._id.toString(),
        name:          student.name,
        matric:        student.matric || null,
        department:    student.department_id?.name,
        department_id: student.department_id?._id.toString(),
        level:         student.level_id?.name,
        level_id:      student.level_id?._id.toString(),
        phone:         student.phone   || null,
        email:         student.email   || null,
        last_login:    previousLastLogin ? previousLastLogin.toISOString() : null
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// ===== ADMIN LOGIN =====
app.post('/api/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.json({ success: false, message: 'Email and password are required.' });

    const admin = await Admin.findOne({ username });
    if (!admin)
      return res.json({ success: false, message: 'Admin account not found.' });

    const match = bcrypt.compareSync(password, admin.password);
    if (!match)
      return res.json({ success: false, message: 'Incorrect password.' });

    // Generate a session token and store in session
    const token = require('crypto').randomBytes(32).toString('hex');
    req.session.adminToken = token;
    // Persist token in DB so it survives server restarts
    await Admin.updateOne({ _id: admin._id }, { $set: { activeToken: token } });

    await logActivity(admin._id, admin.display_name || admin.username, 'LOGIN', 'Admin logged in');

    res.json({
      success: true,
      token,
      admin: {
        id:           admin._id.toString(),
        username:     admin.username,
        display_name: admin.display_name || admin.username,
        role:         admin.role,
        permissions:  admin.permissions || []
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// ===== ADMIN: CHANGE OWN PASSWORD =====
// Body: { current_password, new_password }. Works for the super admin and for lecturer accounts.
app.post('/api/admin/change-password', adminAuth, async (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.query._t;
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password)
      return res.json({ success: false, message: 'Current password and new password are required.' });
    if (new_password.length < 8)
      return res.json({ success: false, message: 'New password must be at least 8 characters.' });
    if (new_password === current_password)
      return res.json({ success: false, message: 'New password must be different from the current password.' });

    const admin = await Admin.findOne({ activeToken: token });
    if (!admin) return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    if (!bcrypt.compareSync(current_password, admin.password))
      return res.json({ success: false, message: 'Current password is incorrect.' });

    admin.password = bcrypt.hashSync(new_password, 10);
    await admin.save();
    await logActivity(admin._id, admin.display_name || admin.username, 'CHANGE_PASSWORD', 'Admin changed own password');
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// ===== STUDENT DASHBOARD ROUTES =====

app.get('/api/student/available-exams', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json([]);
    const student = await Student.findById(toOID(student_id));
    if (!student) return res.json([]);
    const now = new Date();
    const noStart = { $or: [{ start_date: null }, { start_date: { $exists: false } }] };
    const noEnd   = { $or: [{ end_date: null },   { end_date:   { $exists: false } }] };
    const query = {
      $or: [
        { ...noStart, ...noEnd },
        { start_date: { $lte: now }, ...noEnd },
        { ...noStart, end_date: { $gte: now } },
        { start_date: { $lte: now }, end_date: { $gte: now } }
      ]
    };
    const exams = await Exam.find(query).populate('course_id').populate('department_id').populate('level_id').sort({ created_at: -1 });
    const results = await ExamResult.find({ student_id: toOID(student_id) });
    const doneIds = new Set(results.map(r => r.exam_id.toString()));
    // Also mark exams as done if a submitted/auto-submitted session exists (covers the
    // race where ExamResult creation is still in-flight after autoSubmit).\
    const submittedSessions = await ExamSession.find({ student_id: toOID(student_id), status: 'submitted' }, { exam_id: 1 });
    submittedSessions.forEach(s => doneIds.add(s.exam_id.toString()));

    // Check global retake setting and individual grant once for this student
    const globalRetake    = await getSetting('global_allow_retake', false);
    const individualGrant = await RetakeGrant.findOne({ student_id: toOID(student_id) });
    const hasRetakePrivilege = globalRetake || !!individualGrant;

    const available = exams.filter(e => {
      if (e.department_id && e.department_id._id.toString() !== student.department_id?.toString()) return false;
      if (e.level_id && e.level_id._id.toString() !== student.level_id?.toString()) return false;
      // Hide done exam only if no retake privilege of any kind applies
      if (doneIds.has(e._id.toString()) && !e.allow_retake && !hasRetakePrivilege) return false;
      // Hide exam if access restriction is set and student IS in the restricted list
      if (e.allowed_students && e.allowed_students.length > 0) {
        const sid = student._id.toString();
        if (e.allowed_students.some(id => id.toString() === sid)) return false;
      }
      return true;
    });
    res.json(available.map(e => ({
      id: e._id.toString(), title: e.title,
      course: e.course_id?.name || null, course_code: e.course_id?.code || null,
      duration: e.duration, start_date: e.start_date || null, end_date: e.end_date || null,
      allow_retake: e.allow_retake || hasRetakePrivilege,
      already_done: doneIds.has(e._id.toString()),
      instructions: e.instructions || null
    })));
  } catch(e) { console.error(e); res.json([]); }
});

app.get('/api/student/upcoming-exams', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json([]);
    const student = await Student.findById(toOID(student_id));
    if (!student) return res.json([]);
    const now = new Date();
    const exams = await Exam.find({ start_date: { $gt: now } })
      .populate('course_id').populate('department_id').populate('level_id')
      .sort({ start_date: 1 }).limit(10);
    const filtered = exams.filter(e => {
      if (e.department_id && e.department_id._id.toString() !== student.department_id?.toString()) return false;
      if (e.level_id && e.level_id._id.toString() !== student.level_id?.toString()) return false;
      return true;
    });

    res.json(filtered.map(e => ({
      id: e._id.toString(), title: e.title,
      course: e.course_id?.name || null, duration: e.duration,
      start_date: e.start_date, end_date: e.end_date || null
    })));
  } catch(e) { res.json([]); }
});

app.get('/api/student/announcements', async (req, res) => {
  try {
    const { student_id } = req.query;
    const student = student_id ? await Student.findById(toOID(student_id)) : null;
    const all = await Announcement.find({ active: true }).sort({ created_at: -1 }).limit(10);
    const relevant = all.filter(a => {
      if (a.target === 'all') return true;
      if (a.target === 'department' && student)
        return a.dept_ids.map(d => d.toString()).includes(student.department_id?.toString());
      return false;
    });
    res.json(relevant.map(a => ({ id: a._id.toString(), title: a.title, body: a.body, type: a.type, created_at: a.created_at })));
  } catch(e) { res.json([]); }
});

app.get('/api/admin/announcements', async (req, res) => {
  try {
    const list = await Announcement.find().sort({ created_at: -1 }).populate('dept_ids');
    res.json(list.map(a => ({ id: a._id.toString(), title: a.title, body: a.body, type: a.type, target: a.target, dept_ids: a.dept_ids.map(d => d._id?.toString()), active: a.active, created_at: a.created_at })));
  } catch(e) { res.json([]); }
});
app.post('/api/admin/announcements', adminAuth, async (req, res) => {
  try { const a = await Announcement.create(req.body); res.json({ success: true, id: a._id.toString() }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});
app.put('/api/admin/announcements/:id', adminAuth, async (req, res) => {
  try { await Announcement.findByIdAndUpdate(req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/admin/announcements/:id', adminAuth, async (req, res) => {
  try { await Announcement.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/verify-access-code', async (req, res) => {
  try {
    const { code, student_id } = req.body;
    if (!code || !code.trim())
      return res.json({ success: false, message: 'Please enter an access code.' });
    const exam = await Exam.findOne({
      access_code: { $regex: new RegExp(`^${code.trim()}$`, 'i') }
    }).populate('course_id');
    if (!exam)
      return res.json({ success: false, message: 'Invalid access code. Please check and try again.' });
    // Reject if exam has no code set (shouldn't happen via this route, but guard anyway)
    if (!exam.access_code)
      return res.json({ success: false, message: 'This exam does not have an access code yet.' });

    // ── Scheduling enforcement ──
    const now = new Date();
    if (exam.start_date && now < new Date(exam.start_date)) {
      const opens = new Date(exam.start_date).toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short', timeZone:'Africa/Lagos' });
      return res.json({ success: false, message: `This exam has not started yet. It opens at ${opens}.` });
    }
    if (exam.end_date && now > new Date(exam.end_date)) {
      return res.json({ success: false, message: 'This exam has closed and is no longer accepting submissions.' });
    }

    const qCount = await Question.countDocuments({ exam_id: exam._id });
    if (!qCount)
      return res.json({ success: false, message: 'This exam has no questions yet. Contact your administrator.' });

    // ── Face photo verification requirement ──
    if (student_id) {
      const faceVerifyRequired = await getSetting('face_verify_required', false);
      if (faceVerifyRequired) {
        const student = await Student.findById(toOID(student_id));
        if (student && !student.profile_photo_url) {
          return res.json({
            success: false,
            face_photo_missing: true,
            message: 'You must register your face photo before taking any exam. Please go to your dashboard and complete face capture first.'
          });
        }
      }
    }
    // ── Allowed-students restriction (list = restricted/blocked students) ──
    if (exam.allowed_students && exam.allowed_students.length > 0 && student_id) {
      const sid = toOID(student_id);
      const isRestricted = exam.allowed_students.some(id => id.equals(sid));
      if (isRestricted) {
        return res.json({ success: false, message: 'You are restricted from this exam. Contact your administrator.' });
      }
    }

    const globalRetake    = await getSetting('global_allow_retake', false);
    const individualGrant = student_id
      ? await RetakeGrant.findOne({ student_id: toOID(student_id) })
      : null;
    const allowRetake = globalRetake || !!individualGrant || exam.allow_retake;
    if (!allowRetake && student_id) {
      const existing = await ExamResult.findOne({ student_id: toOID(student_id), exam_id: exam._id });
      if (existing)
        return res.json({ success: false, message: 'You have already completed this exam and retakes are not allowed.' });
    }
    // NOTE: Do NOT delete the individualGrant here. The grant must survive until
    // /api/exam-questions loads the session — deleting it here means the grant
    // is gone by the time that endpoint checks it, causing a false "retakes not allowed" block.
    // The grant is consumed (deleted) in /api/submit-exam instead.
    const poolSize = exam.question_pool_size || 0;
    const servedCount = poolSize > 0 && poolSize < qCount ? poolSize : qCount;
    res.json({
      success: true,
      exam: {
        id: exam._id.toString(), title: exam.title, duration: exam.duration,
        instructions: exam.instructions, question_count: servedCount,
        course_name: exam.course_id?.name, shuffle_questions: exam.shuffle_questions,
        shuffle_answers: exam.shuffle_answers, allow_retake: allowRetake,
        start_date: exam.start_date, end_date: exam.end_date
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// POST /api/student/exam-start-check — validate exam by ID from dashboard (no access code needed)
// Runs the same checks as verify-access-code: scheduling, face photo, retake
app.post('/api/student/exam-start-check', async (req, res) => {
  try {
    const { exam_id, student_id } = req.body;
    if (!exam_id) return res.json({ success: false, message: 'Missing exam ID.' });

    const exam = await Exam.findById(toOID(exam_id)).populate('course_id');
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });

    const now = new Date();
    if (exam.start_date && now < new Date(exam.start_date)) {
      const opens = new Date(exam.start_date).toLocaleString('en-NG', { dateStyle:'medium', timeStyle:'short', timeZone:'Africa/Lagos' });
      return res.json({ success: false, message: `This exam has not started yet. It opens at ${opens}.` });
    }
    if (exam.end_date && now > new Date(exam.end_date))
      return res.json({ success: false, message: 'This exam has closed and is no longer accepting submissions.' });

    const qCount = await Question.countDocuments({ exam_id: exam._id });
    if (!qCount)
      return res.json({ success: false, message: 'This exam has no questions yet. Contact your administrator.' });

    if (student_id) {
      // Face photo check
      const faceVerifyRequired = await getSetting('face_verify_required', false);
      if (faceVerifyRequired) {
        const student = await Student.findById(toOID(student_id));
        if (student && !student.profile_photo_url)
          return res.json({ success: false, face_photo_missing: true, message: 'You must register your face photo before taking any exam. Please go to your dashboard and complete face capture first.' });
      }
      // Allowed students check (list = restricted/blocked students)
      if (exam.allowed_students && exam.allowed_students.length > 0) {
        const sid = toOID(student_id);
        if (exam.allowed_students.some(id => id.equals(sid)))
          return res.json({ success: false, message: 'You are restricted from this exam. Contact your administrator.' });
      }
      // Retake check
      const globalRetake    = await getSetting('global_allow_retake', false);
      const individualGrant = await RetakeGrant.findOne({ student_id: toOID(student_id) });
      const allowRetake     = globalRetake || !!individualGrant || exam.allow_retake;
      if (!allowRetake) {
        const existing = await ExamResult.findOne({ student_id: toOID(student_id), exam_id: exam._id });
        if (existing)
          return res.json({ success: false, message: 'You have already completed this exam and retakes are not allowed.' });
      }
      // Grant consumed in /api/submit-exam, not here — keeps it alive for /api/exam-questions check
    }

    const poolSize   = exam.question_pool_size || 0;
    const servedCount = poolSize > 0 && poolSize < qCount ? poolSize : qCount;
    res.json({
      success: true,
      exam: {
        id: exam._id.toString(), title: exam.title, duration: exam.duration,
        instructions: exam.instructions, question_count: servedCount,
        course_name: exam.course_id?.name, shuffle_questions: exam.shuffle_questions,
        shuffle_answers: exam.shuffle_answers, allow_retake: exam.allow_retake,
        start_date: exam.start_date, end_date: exam.end_date
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/exam-questions', async (req, res) => {
  try {
    const { exam_id, student_id, face_token } = req.query;
    const examOID = toOID(exam_id);
    if (!examOID) return res.json({ success: false, message: 'Invalid exam ID' });
    const exam = await Exam.findById(examOID);
    if (!exam) return res.json({ success: false, message: 'Exam not found' });

    // ── Face verification gate ────────────────────────────────────────────────
    // If face verification is enabled, require a valid server-issued face token.
    // This prevents a different student from bypassing face-capture.html entirely.
    if (student_id) {
      const faceVerifyRequired = await getSetting('face_verify_required', false);
      const aiMonitoring = exam.webcam_enabled || exam.face_anticheat_enabled ||
                           exam.restrict_side_look || exam.restrict_voice;
      if (faceVerifyRequired && aiMonitoring) {
        const key   = `${student_id}:${exam_id}`;
        const entry = faceTokenStore.get(key);
        if (!entry || entry.token !== face_token || Date.now() > entry.expires) {
          return res.json({
            success: false,
            message: 'Identity verification required. Please complete face verification before entering this exam.',
            face_verify_required: false
          });
        }
        faceTokenStore.delete(key); // one-use token — consumed on first question load
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // * FIX: Check for an existing active session FIRST — before any shuffling or pool slicing.
    // This ensures session reuse is always consistent; we never accidentally generate a different
    // question pool that doesn't match what's stored in the session's shuffled_answer_map.
    // RETAKE FIX: If a result already exists for the active session, the student is starting fresh —
    // close the old session and force a new one so stale answers never bleed into the new attempt.
    let activeSession = null;
    if (student_id) {
      const candidateSession = await ExamSession.findOne(
        { student_id: toOID(student_id), exam_id: examOID, status: 'active' },
        null,
        { sort: { started_at: -1 } }
      );
      if (candidateSession) {
        const alreadySubmitted = await ExamResult.findOne({ session_id: candidateSession._id });
        if (alreadySubmitted) {
          // Result exists → student finished this session already. Close it and start fresh.
          await ExamSession.findByIdAndUpdate(candidateSession._id, { status: 'submitted' });
          console.log(`[SESSION] Closed stale active session=${candidateSession._id} (result existed) — will create new session`);
        } else {
          activeSession = candidateSession;
        }
      }
    }

    // * FIX: Prevent back-button retake after auto-submit/manual submit.
    // If a result already exists for this student+exam and retake is not allowed,
    // reject the request outright — even if the client managed to reload the exam page.
    if (student_id) {
      const existingResult = await ExamResult.findOne({ student_id: toOID(student_id), exam_id: examOID });
      if (existingResult) {
        const globalRetake    = await getSetting('global_allow_retake', false);
        const individualGrant = await RetakeGrant.findOne({ student_id: toOID(student_id) });
        const allowRetake     = globalRetake || !!individualGrant || exam.allow_retake;
        if (!allowRetake) {
          return res.json({ success: false, message: 'You have already completed this exam and retakes are not allowed.' });
        }
      }
    }

    // Fetch ALL questions from DB (needed for both new session creation and session-reuse qMap lookup)
    const allQuestionsFromDB = await Question.find({ exam_id: examOID });
    if (!allQuestionsFromDB.length) return res.json({ success: false, message: 'No questions found for this exam' });

    let session;
    let savedAnswers = {};
    let mapped = [];

    if (activeSession) {
      // ── REUSE EXISTING SESSION ────────────────────────────────────────────────
      // The shuffled_answer_map and question pool are already fixed in the session.
      // Serve questions in exactly the same order and with exactly the same option layout.
      session      = activeSession;
      savedAnswers = activeSession.answers || {};

      const existingMap  = activeSession.shuffled_answer_map || {};
      const existingQids = Object.keys(existingMap);

      // Build a lookup map from ALL DB questions so we can retrieve any qid in the session
      const qMap = {};
      allQuestionsFromDB.forEach(q => { qMap[q._id.toString()] = q; });

      const storedOptsMap = activeSession.shuffled_options_map || {};

      if (existingQids.length) {
        // Reconstruct the question list in the original session order
        mapped = existingQids.map(qid => {
          const q = qMap[qid];
          if (!q) return null; // question deleted from DB after session was created
          const opts = storedOptsMap[qid]; // previously stored shuffled option order
          return {
            id: qid, question: q.question,
            question_type: q.question_type || 'multiple_choice',
            // Serve options in the SAME shuffled order as the original session
            optionA: opts ? opts[0] : q.optionA,
            optionB: opts ? opts[1] : q.optionB,
            optionC: opts ? opts[2] : q.optionC,
            optionD: opts ? opts[3] : q.optionD
          };
        }).filter(Boolean);
      }

      // Safeguard: if mapped is empty (e.g. session had no map keys), fall through and create a new one
      if (!mapped.length) {
        console.warn(`[SESSION] Reused session=${session._id} had empty map — will rebuild`);
        activeSession = null; // force new session creation below
      } else {
        console.log(`[SESSION] Reusing session=${session._id} student=${student_id} questions=${mapped.length} savedAnswers=${Object.keys(savedAnswers).length}`);
      }
    }

    if (!activeSession) {
      // ── CREATE NEW SESSION ────────────────────────────────────────────────────
      let questions = [...allQuestionsFromDB];
      if (exam.shuffle_questions) questions = shuffle(questions);
      // Question pool: serve only N random questions if pool_size is set
      if (exam.question_pool_size > 0 && exam.question_pool_size < questions.length) {
        questions = questions.slice(0, exam.question_pool_size);
      }

      // Build shuffledAnswerMap and shuffledOptionsMap for the chosen question set
      const shuffledAnswerMap  = {};
      const shuffledOptionsMap = {};

      mapped = questions.map(q => {
        const qid = q._id.toString();
        // answer is intentionally excluded from the client response
        const base = {
          id: qid, question: q.question,
          question_type: q.question_type || 'multiple_choice',
          optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD
        };
        if (exam.shuffle_answers && q.question_type !== 'true_false') {
          const opts = [
            { key:'A', text:q.optionA }, { key:'B', text:q.optionB },
            { key:'C', text:q.optionC }, { key:'D', text:q.optionD }
          ];
          const correctMatch = opts.find(o => o.key === q.answer);
          const correctText  = correctMatch ? correctMatch.text : opts[0].text; // safe fallback
          const shuffled     = shuffle(opts);
          const correctIndex = shuffled.findIndex(o => o.text === correctText);
          const newAnswerKey = ['A', 'B', 'C', 'D'][correctIndex];
          shuffledAnswerMap[qid]  = newAnswerKey;
          shuffledOptionsMap[qid] = [shuffled[0].text, shuffled[1].text, shuffled[2].text, shuffled[3].text];
          return {
            ...base,
            optionA: shuffled[0].text, optionB: shuffled[1].text,
            optionC: shuffled[2].text, optionD: shuffled[3].text
          };
        }
        // No answer shuffle — store original answer key
        shuffledAnswerMap[qid] = q.answer;
        return base;
      });

      // Create session — use new+markModified+save (NOT create()) so Mongoose
      // tracks Mixed fields properly BEFORE the first write to MongoDB.
      session = new ExamSession({
        student_id:           toOID(student_id),
        exam_id:              examOID,
        shuffled_answer_map:  shuffledAnswerMap,
        shuffled_options_map: shuffledOptionsMap
      });
      session.markModified('shuffled_answer_map');
      session.markModified('shuffled_options_map');
      await session.save();
      console.log(`[SESSION] Created session=${session._id} student=${student_id} questions=${mapped.length} mapKeys=${Object.keys(shuffledAnswerMap).length}`);
    }

    res.json({
      success:      true,
      questions:    mapped,
      session_id:   session._id.toString(),
      savedAnswers: Object.keys(savedAnswers).length ? savedAnswers : undefined
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/save-progress', async (req, res) => {
  try {
    const { session_id, answers } = req.body;
    // FIX: Use findById + markModified so Mongoose properly persists the Mixed 'answers' field.
    const sess = await ExamSession.findById(toOID(session_id));
    if (sess && sess.status !== 'submitted') {
      sess.answers = answers;
      sess.markModified('answers');
      await sess.save();
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false }); }
});

// Enhanced: records violation_type (rule_violation | network_error | system_error)
// Check if a session has been submitted — used by offline sync Check Status button
app.get('/api/check-submission', async (req, res) => {
  try {
    const { session_id } = req.query;
    const session = await ExamSession.findById(toOID(session_id));
    if (!session) return res.json({ submitted: false });
    if (session.status === 'submitted') {
      const result = await ExamResult.findOne({ session_id: toOID(session_id) });
      return res.json({ submitted: true, result: result ? { total: result.total, correct: result.correct, wrong: result.wrong, percentage: result.percentage } : null });
    }
    res.json({ submitted: false });
  } catch(e) { res.json({ submitted: false }); }
});

// AI exam-violation / proctoring capture system removed for MARGMOCOTH CBT.
// This endpoint is kept as a harmless no-op so older cached front-end code does not error.
app.post('/api/record-violation', async (req, res) => {
  res.json({ success: true });
});

app.delete('/api/admin/violations/:id', adminAuth, async (req, res) => {
  res.json({ success: true });
});

app.delete('/api/admin/violations/student/:matric', adminAuth, async (req, res) => {
  res.json({ success: true, deleted: 0 });
});

app.post('/api/save-snapshot', upload.single('snapshot'), (req, res) => {
  res.json({ success: true });
});

app.post('/api/save-face-capture', async (req, res) => {
  try {
    const { image_data, student_id, exam_id, student_name, matric, exam_title, face_verified, match_score, flagged, flag_reason } = req.body;
    if (!image_data) return res.json({ success: false, message: 'No image data provided' });

    // * FIX: Unified duplicate guard for ALL capture types (verified + flagged).
    // Old code only blocked face_verified:true, so:
    //   - Re-verification attempts uploaded a second verified photo
    //   - Flagged/mismatch captures had zero duplicate protection
    // New logic: one record per student+exam, updated in-place via upsert.
    // A verified capture always overwrites a previous flagged one (better record wins).
    // If a verified record already exists and this is just a flagged retry, we skip.
    if (student_id && exam_id) {
      const existing = await FaceCapture.findOne({
        student_id: toOID(student_id),
        exam_id:    toOID(exam_id)
      });
      if (existing) {
        // Already have a verified capture — never overwrite it with anything
        if (existing.face_verified) {
          return res.json({ success: true, url: existing.cloudinary_url, duplicate: true });
        }
        // Have an unverified/flagged record and this is also flagged — skip upload, return existing
        if (!face_verified && flagged) {
          return res.json({ success: true, url: existing.cloudinary_url, duplicate: true });
        }
        // Have an unverified record but this is a successful verification — update it in place
        // Delete old cloudinary image first to avoid orphaned files
        try { await cloudinary.uploader.destroy(existing.public_id); } catch(_) {}
      }
    }

    const uploadResult = await cloudinary.uploader.upload(image_data, {
      folder: 'margmocoth_face_captures',
      public_id:     `face_${student_id || 'unknown'}_${exam_id || 'noexam'}`,
      resource_type: 'image',
      overwrite:     true   // same public_id = overwrites on Cloudinary too
    });

    // Upsert — one record per student+exam, updated if it already exists
    await FaceCapture.findOneAndUpdate(
      { student_id: student_id ? toOID(student_id) : null,
        exam_id:    exam_id    ? toOID(exam_id)    : null },
      {
        student_name:   student_name || 'Unknown',
        matric:         matric       || '—',
        exam_title:     exam_title   || '—',
        cloudinary_url: uploadResult.secure_url,
        public_id:      uploadResult.public_id,
        face_verified:  face_verified || false,
        match_score:    match_score   || 0,
        flagged:        flagged       || false,
        flag_reason:    flag_reason   || null,
        captured_at:    new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, url: uploadResult.secure_url });
  } catch(e) {
    console.error('Face capture upload error:', e.message);
    res.json({ success: false, message: e.message });
  }
});

// Scores a session and saves the ExamResult (+ review). Shared by /api/submit-exam and the recovery sweep.
// Full result payload (with display settings) for a saved ExamResult — used when a submit is retried
async function fullResultPayload(r, exam) {
  const [showResults, showPercentage, showScoreBreakdown, showGrade] = await Promise.all([
    getSetting('show_results', false), getSetting('show_percentage', true),
    getSetting('show_score_breakdown', true), getSetting('show_grade', true),
  ]);
  return { total: r.total, correct: r.correct, wrong: r.wrong, percentage: r.percentage,
    time_taken: r.time_taken || 0, exam_title: exam?.title, result_id: r._id.toString(),
    exam_id: (exam?._id || r.exam_id)?.toString() || null, student_id: r.student_id?.toString() || null,
    retake_request_allowed: exam?.retake_request_allowed !== false,
    show_results: showResults, show_percentage: showPercentage, show_score_breakdown: showScoreBreakdown, show_grade: showGrade };
}

const submitLocks = new Set();
async function scoreAndSaveResult({ session, sessionOID, studentOID, examOID, answers, time_taken }) {
    const mapKeys = Object.keys(session?.shuffled_answer_map || {});
    console.log(`[SUBMIT] session=${sessionOID} map_keys=${mapKeys.length} answers_received=${Object.keys(answers||{}).length}`);
    if (mapKeys.length > 0) {
      const sampleQid = mapKeys[0];
      console.log(`[SUBMIT] sample: qid=${sampleQid} correctKey=${session.shuffled_answer_map[sampleQid]} studentAns=${(answers||{})[sampleQid]}`);
    }
    // Use the session's answer map when available. answerMap maps qid -> correct answer key (A/B/C/D).
    const answerMap = (session?.shuffled_answer_map && mapKeys.length)
      ? session.shuffled_answer_map
      : null;

    const allQuestions = await Question.find({ exam_id: examOID });

    const servedQids = answerMap
      ? new Set(Object.keys(answerMap))
      : new Set(allQuestions.map(q => q._id.toString()));

    const servedQuestions = allQuestions.filter(q => servedQids.has(q._id.toString()));
    const total = servedQuestions.length;
    let correct = 0;

    const reviewQuestions = [];
    servedQuestions.forEach(q => {
      const qid        = q._id.toString();
      // FIX: Do NOT fall back to q.answer when answerMap[qid] is present but falsy —
      // use strict null check. If answerMap exists but the qid is missing, use q.answer.
      const correctKey = answerMap
        ? (answerMap[qid] !== undefined ? answerMap[qid] : q.answer)
        : q.answer;
      const studentAns = (answers && answers[qid] !== undefined) ? answers[qid] : null;
      const isCorrect  = studentAns !== null && studentAns === correctKey;
      console.log(`[SCORE] qid=${qid} dbAnswer=${q.answer} mapAnswer=${answerMap?.[qid]} usedKey=${correctKey} studentPicked=${studentAns} match=${isCorrect}`);
      if (isCorrect) correct++;
      reviewQuestions.push({
        question_id: qid, question: q.question,
        optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD,
        student_answer: studentAns, correct_answer: correctKey, is_correct: isCorrect
      });
    });
    const wrong      = total - correct;
    const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
    const result = await ExamResult.create({ student_id: studentOID, exam_id: examOID, session_id: sessionOID, total, correct, wrong, percentage, time_taken: time_taken || 0 });
    await ExamSession.findByIdAndUpdate(sessionOID, { status: 'submitted', submitted_at: new Date() });

    // Consume the individual retake grant now that the exam is fully submitted
    try {
      const globalRetake = await getSetting('global_allow_retake', false);
      if (!globalRetake) {
        await RetakeGrant.findOneAndDelete({ student_id: studentOID });
      }
    } catch(_) {}

    try {
      await ExamReview.create({ result_id: result._id, student_id: studentOID, exam_id: examOID, questions: reviewQuestions });
    } catch (reviewErr) { console.error('[SUBMIT] ExamReview save failed (result already saved):', reviewErr.message); }
    return { result, total, correct, wrong, percentage };
}

app.post('/api/submit-exam', async (req, res) => {
  let lockKey = null;
  try {
    const { session_id, student_id, exam_id, answers, time_taken } = req.body;
    console.log(`[SUBMIT-RAW] answers=${JSON.stringify(answers)} session=${session_id}`);
    const examOID    = toOID(exam_id);
    const sessionOID = toOID(session_id);
    const studentOID = toOID(student_id);
    if (!examOID || !sessionOID || !studentOID) {
      return res.json({ success: false, retryable: false, message: 'Invalid exam session. Please reload the exam page.' });
    }
    lockKey = String(sessionOID);
    if (submitLocks.has(lockKey)) { lockKey = null; return res.json({ success: false, retryable: true, message: 'Your submission is being processed. Retrying…' }); }
    submitLocks.add(lockKey);
    // The ids in the request body are client-supplied: the session must exist and belong to this student and exam
    const ownSession = await ExamSession.findById(sessionOID);
    if (!ownSession || String(ownSession.student_id) !== String(studentOID) || String(ownSession.exam_id) !== String(examOID)) {
      return res.json({ success: false, retryable: false, message: 'This exam session could not be verified. Please reload the exam page.' });
    }
    // Same session already has a result (e.g. the response got lost last time) -> return it, never create a second one
    const dupResult = await ExamResult.findOne({ session_id: sessionOID });
    if (dupResult) {
      await ExamSession.updateOne({ _id: sessionOID, status: { $ne: 'submitted' } }, { $set: { status: 'submitted', submitted_at: new Date() } });
      const dupExam = await Exam.findById(examOID);
      return res.json({ success: true, result: await fullResultPayload(dupResult, dupExam) });
    }
    // Save the answers FIRST so they are in MongoDB even if scoring fails afterwards
    await ExamSession.updateOne({ _id: sessionOID, status: { $ne: 'submitted' } },
      { $set: { ...((answers && Object.keys(answers).length) ? { answers } : {}), submit_requested: true, submit_requested_at: new Date(), submit_time_taken: time_taken || 0 } });
    const existingSession = await ExamSession.findById(sessionOID);
    if (existingSession?.status === 'submitted') {
      const existing = await ExamResult.findOne({ session_id: sessionOID });
      if (existing) {
        const exam = await Exam.findById(examOID);
        return res.json({ success: true, result: await fullResultPayload(existing, exam) });
      }
    }
    // FIX: Reuse already-fetched existingSession instead of fetching session again from DB.
    const session = existingSession;
    const { result, total, correct, wrong, percentage } = await scoreAndSaveResult({ session, sessionOID, studentOID, examOID, answers: (answers && Object.keys(answers).length) ? answers : (session?.answers || {}), time_taken });

    const exam = await Exam.findById(examOID);

    const [showResults, showPercentage, showScoreBreakdown, showGrade] = await Promise.all([
      getSetting('show_results',         false),
      getSetting('show_percentage',      true),
      getSetting('show_score_breakdown', true),
      getSetting('show_grade',           true),
    ]);

    try {
      const student = await Student.findById(studentOID);
      if (student?.email && showResults) {
        const grade = percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : percentage >= 50 ? 'E' : 'F';
        await sendMail({
          to: student.email,
          subject: `Your ${exam?.title || 'Exam'} Result — MARGMOCOTH CBT`,
          html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
            <h2 style="color:#0f6b30;">Exam Result</h2>
            <p>Dear <strong>${student.name}</strong>,</p>
            <p>Your result for <strong>${exam?.title || 'your exam'}</strong> has been recorded.</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;">
              <tr><td style="padding:8px;border:1px solid #e2e8f0;">Score</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${correct}/${total}</td></tr>
              <tr><td style="padding:8px;border:1px solid #e2e8f0;">Percentage</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${percentage}%</td></tr>
              <tr><td style="padding:8px;border:1px solid #e2e8f0;">Grade</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${grade}</td></tr>
            </table>
            <p style="color:#64748b;font-size:12px;">MARGMOCOTH i-CBT System</p>
          </div>`
        });
      }
    } catch(emailErr) { console.warn('Result email failed:', emailErr.message); }

    res.json({ success: true, result: {
      total, correct, wrong, percentage,
      time_taken: time_taken || 0,
      exam_title: exam?.title,
      result_id:  result._id.toString(),
      exam_id:    exam?._id?.toString() || null,
      student_id: studentOID?.toString() || null,
      retake_request_allowed: exam?.retake_request_allowed !== false,
      show_results:         showResults,
      show_percentage:      showPercentage,
      show_score_breakdown: showScoreBreakdown,
      show_grade:           showGrade,
    } });
} catch(e) {
    console.error('Submit error:', e.message);
    res.json({ success: false, retryable: true, message: 'Could not record your result yet. Your answers are saved and will be retried automatically.' });
  } finally { if (lockKey) submitLocks.delete(lockKey); }
});

// Recovery sweep: a submit reached the server but failed before the result was saved.
// Score it from the answers already stored in MongoDB so the result is never lost.
async function finalizeStrandedSubmissions() {
  if (mongoose.connection.readyState !== 1) return;
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    const stuck = await ExamSession.find({ status: 'active', submit_requested: true, submit_requested_at: { $lt: cutoff } }).limit(50);
    for (const session of stuck) {
      const key = String(session._id);
      if (submitLocks.has(key)) continue;
      submitLocks.add(key);
      try {
        const already = await ExamResult.findOne({ session_id: session._id });
        if (already) {
          await ExamSession.updateOne({ _id: session._id }, { $set: { status: 'submitted', submitted_at: new Date() } });
        } else {
          await scoreAndSaveResult({ session, sessionOID: session._id, studentOID: session.student_id, examOID: session.exam_id, answers: session.answers || {}, time_taken: session.submit_time_taken || 0 });
          console.log('[RECOVERY] Saved result for stranded session', key);
        }
      } catch (err) { console.error('[RECOVERY] Failed for session', key, err.message); }
      finally { submitLocks.delete(key); }
    }
  } catch (err) { console.error('[RECOVERY] Sweep error:', err.message); }
}
setInterval(finalizeStrandedSubmissions, 60 * 1000);
// ===========================
// ===== LECTURER ACCOUNTS ===
// ===========================

// Exams a lecturer can work on: ones they created, ones assigned to them, and ones
// assigned to ALL lecturers. Not tied to any department or level.
function lecturerExamQuery(lecturerId) {
  const id = toOID(lecturerId);
  return { $or: [{ created_by: id }, { assigned_to: id }, { assigned_to_all: true }] };
}

app.get("/api/admin/lecturers", async (req, res) => {
  try {
    const lecturers = await Admin.find({ role: { $in: ["lecturer","admin","moderator"] } }, { password: 0 }).sort({ created_at: -1 }).populate('department_id');
    res.json({ success: true, lecturers: lecturers.map(l => ({
      id: l._id.toString(), username: l.username, role: l.role,
      display_name: l.display_name, permissions: l.permissions, created_at: l.created_at,
      department_id:   l.department_id?._id?.toString() || null,
      department_name: l.department_id?.name || null
    }))});
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post("/api/admin/lecturers", async (req, res) => {
  try {
    const { username, password, display_name, permissions, department_id, role } = req.body;
    const assignedRole = ['admin','moderator','lecturer'].includes(role) ? role : 'lecturer';
    if (!username || !password) return res.json({ success: false, message: "Username and password are required." });
    if (password.length < 6) return res.json({ success: false, message: "Password must be at least 6 characters." });
    const exists = await Admin.findOne({ username });
    if (exists) return res.json({ success: false, message: "That username is already taken." });
    // Department is OPTIONAL — a lecturer can teach several departments and levels.
    let dept = null;
    if (department_id) {
      dept = await Department.findById(toOID(department_id));
      if (!dept) return res.json({ success: false, message: "Selected department not found." });
    }
    const lec = await Admin.create({
      username, password: bcrypt.hashSync(password, 10),
      display_name: display_name || username, role: assignedRole,
      permissions: Array.isArray(permissions) ? permissions : [],
      department_id: dept ? dept._id : null
    });
    res.json({ success: true, lecturer: { id: lec._id.toString(), username: lec.username, display_name: lec.display_name, role: lec.role, permissions: lec.permissions, department_id: dept ? dept._id.toString() : null, department_name: dept ? dept.name : null } });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.put("/api/admin/lecturers/:id", async (req, res) => {
  try {
    const { display_name, permissions, password, department_id, role } = req.body;
    const target = await Admin.findById(req.params.id);
    if (!target || target.role === "super") return res.json({ success: false, message: "Account not found." });
    const update = {};
    if (display_name !== undefined) update.display_name = display_name;
    if (['admin','moderator','lecturer'].includes(role)) update.role = role;
    if (Array.isArray(permissions)) update.permissions = permissions;
    if (department_id) {
      const dept = await Department.findById(toOID(department_id));
      if (!dept) return res.json({ success: false, message: "Selected department not found." });
      update.department_id = dept._id;
    } else if (department_id === '' || department_id === null) {
      update.department_id = null; // cleared → works across all departments
    }
    if (password) {
      if (password.length < 6) return res.json({ success: false, message: "Password must be at least 6 characters." });
      update.password = bcrypt.hashSync(password, 10);
    }
    await Admin.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete("/api/admin/lecturers/:id", async (req, res) => {
  try {
    const target = await Admin.findById(req.params.id);
    if (!target || target.role === "super") return res.json({ success: false, message: "Account not found." });
    await Admin.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== ADMIN API ROUTES ====
// ===========================

app.get('/api/admin/stats', async (req, res) => {
  try {
    // lecturer_id passed when a lecturer requests their own scoped stats
    const { lecturer_id } = req.query;
    let lecturerDoc = null;
    let myExamIds   = null;
    let lecturerDeptIds = [];

    if (lecturer_id) {
      lecturerDoc = await Admin.findById(toOID(lecturer_id));
      if (!lecturerDoc || lecturerDoc.role !== 'lecturer')
        return res.json({ error: 'Not a lecturer' });
      const myExams = await Exam.find(lecturerExamQuery(lecturerDoc._id), { _id: 1, department_id: 1 });
      myExamIds = myExams.map(e => e._id);
      lecturerDeptIds = [...new Set(myExams.map(e => e.department_id && e.department_id.toString()).filter(Boolean))].map(toOID);
    }

    // Students a lecturer sees = students in the departments of their exams (or their own
    // department if set and they have no exams yet); no department lock otherwise.
    const deptFilter = !lecturerDoc ? {}
      : lecturerDeptIds.length ? { department_id: { $in: lecturerDeptIds } }
      : lecturerDoc.department_id ? { department_id: lecturerDoc.department_id } : {};
    const examFilter = myExamIds  ? { _id: { $in: myExamIds } }                  : {};
    const resultExamFilter = myExamIds ? { exam_id: { $in: myExamIds } }         : {};

    const [students, exams, questions, results] = await Promise.all([
      Student.countDocuments(deptFilter),
      Exam.countDocuments(examFilter),
      myExamIds ? Question.countDocuments({ exam_id: { $in: myExamIds } }) : Question.countDocuments(),
      ExamResult.countDocuments(resultExamFilter)
    ]);

    const recentExams = await Exam.find(examFilter).sort({ created_at: -1 }).limit(5)
      .populate('course_id').populate('department_id').populate('level_id');
    const recentExamsData = recentExams.map(e => ({
      id: e._id.toString(), title: e.title, access_code: e.access_code,
      duration: e.duration, created_at: e.created_at, course_name: e.course_id?.name
    }));

    const recentResults = await ExamResult.find(resultExamFilter).sort({ submitted_at: -1 }).limit(10)
      .populate('student_id').populate('exam_id');
    const recentResultsData = recentResults.map(r => ({
      id: r._id.toString(), percentage: r.percentage, correct: r.correct,
      total: r.total, submitted_at: r.submitted_at,
      student_name: r.student_id?.name, matric: r.student_id?.matric, exam_title: r.exam_id?.title
    }));

    const examScores = await ExamResult.aggregate([
      ...(myExamIds ? [{ $match: { exam_id: { $in: myExamIds } } }] : []),
      { $group: { _id: '$exam_id', avg_pct: { $avg: '$percentage' } } },
      { $sort: { _id: -1 } }, { $limit: 6 },
      { $lookup: { from: 'exams', localField: '_id', foreignField: '_id', as: 'exam' } }
    ]);

    const scoreDistMatch = myExamIds ? [{ $match: { exam_id: { $in: myExamIds } } }] : [];
    const scoreDistribution = await ExamResult.aggregate([
      ...scoreDistMatch,
      { $group: {
        _id: null,
        a: { $sum: { $cond: [{ $gte: ['$percentage', 90] }, 1, 0] } },
        b: { $sum: { $cond: [{ $and: [{ $gte: ['$percentage', 70] }, { $lt: ['$percentage', 90] }] }, 1, 0] } },
        c: { $sum: { $cond: [{ $and: [{ $gte: ['$percentage', 50] }, { $lt: ['$percentage', 70] }] }, 1, 0] } },
        d: { $sum: { $cond: [{ $lt: ['$percentage', 50] }, 1, 0] } }
      }}
    ]);

    res.json({
      students, exams, questions, results,
      department_name: lecturerDoc ? (await Department.findById(lecturerDoc.department_id))?.name || null : null,
      recentExams: recentExamsData, recentResults: recentResultsData,
      chartData: {
        labels: examScores.map(e => e.exam[0]?.title?.substring(0, 20) || ''),
        scores: examScores.map(e => Math.round(e.avg_pct))
      },
      scoreDistribution: scoreDistribution[0]
        ? [scoreDistribution[0].a, scoreDistribution[0].b, scoreDistribution[0].c, scoreDistribution[0].d]
        : [0,0,0,0]
    });
  } catch(e) { res.json({ error: e.message }); }
});

app.get('/api/admin/exams', async (req, res) => {
  try {
    const { lecturer_id } = req.query;
    // For lecturers: show exams they created OR exams super admin assigned to them
    const filter = lecturer_id ? lecturerExamQuery(lecturer_id) : {};
    const exams = await Exam.find(filter).sort({ created_at: -1 }).populate('course_id');
    const data  = await Promise.all(exams.map(async e => ({
      id: e._id.toString(), title: e.title, access_code: e.access_code,
      duration: e.duration, allow_retake: e.allow_retake, created_at: e.created_at,
      course_name: e.course_id?.name,
      question_count:   await Question.countDocuments({ exam_id: e._id }),
      submission_count: await ExamResult.countDocuments({ exam_id: e._id })
    })));
    res.json(data);
  } catch(e) { res.json([]); }
});

app.post('/api/admin/create-exam', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.course_id)     body.course_id     = toOID(body.course_id);
    if (body.department_id) body.department_id = toOID(body.department_id);
    if (body.level_id)      body.level_id      = toOID(body.level_id);
    if (body.created_by)    body.created_by    = toOID(body.created_by);
    // Auto-attach the currently active semester
    const activeSemester = await Semester.findOne({ is_active: true });
    if (activeSemester) body.semester_id = activeSemester._id;
    delete body.access_code; // sparse unique: must be absent not null
    const exam = await Exam.create(body);
    // Log activity if created by a lecturer
    if (body.created_by) {
      const lec = await Admin.findById(body.created_by);
      if (lec) await logActivity(lec._id, lec.display_name, 'create_exam', `Created exam: "${exam.title}"`);
    }
    res.json({ success: true, exam: { id: exam._id.toString(), ...exam.toObject() } });
  } catch(e) {
    if (e.code === 11000) return res.json({ success: false, message: 'Access code already exists.' });
    res.json({ success: false, message: e.message });
  }
});

// GET a single exam (full details for editing)
app.get('/api/admin/exams/:id', adminAuth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('course_id').populate('department_id').populate('level_id');
    if (!exam) return res.json({ success: false, message: 'Exam not found' });
    res.json({
      success: true,
      exam: {
        id:                 exam._id.toString(),
        title:              exam.title,
        duration:           exam.duration,
        course_id:          exam.course_id?._id?.toString() || '',
        department_id:      exam.department_id?._id?.toString() || '',
        level_id:           exam.level_id?._id?.toString() || '',
        start_date:         exam.start_date || null,
        end_date:           exam.end_date   || null,
        allow_retake:       exam.allow_retake       || false,
        shuffle_questions:  exam.shuffle_questions  || false,
        shuffle_answers:    exam.shuffle_answers    || false,
        question_pool_size: exam.question_pool_size || 0,
        instructions:       exam.instructions       || '',
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/exams/:id', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.course_id)     body.course_id     = toOID(body.course_id);
    if (body.department_id) body.department_id = toOID(body.department_id);
    if (body.level_id)      body.level_id      = toOID(body.level_id);
    await Exam.findByIdAndUpdate(req.params.id, body);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/exams/:id', async (req, res) => {
  try {
    const examOID = toOID(req.params.id);
    await Exam.findByIdAndDelete(examOID);
    await Question.deleteMany({ exam_id: examOID });
    // Clean up all exam-related data to avoid orphaned records
    const sessions = await ExamSession.find({ exam_id: examOID }, { _id: 1 });
    const sessionIds = sessions.map(s => s._id);
    await ExamSession.deleteMany({ exam_id: examOID });
    await ExamResult.deleteMany({ exam_id: examOID });
    await ExamReview.deleteMany({ exam_id: examOID });
    await Violation.deleteMany({ session_id: { $in: sessionIds } });
    await FaceCapture.deleteMany({ exam_id: examOID });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ── Exam Assignment Routes (super admin assigns exams to lecturers) ────────────
// GET /api/admin/exams/:id/assignments  — fetch current assigned lecturers for an exam
app.get('/api/admin/exams/:id/assignments', async (req, res) => {
  try {
    const exam = await Exam.findById(toOID(req.params.id)).populate('assigned_to', 'display_name username department_id');
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true, assigned_to_all: !!exam.assigned_to_all, assigned_to: exam.assigned_to.map(l => ({ id: l._id.toString(), display_name: l.display_name, username: l.username })) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/exam-assignments?department_id=xxx  — get all exams for a dept with their assignments
app.get('/api/admin/exam-assignments', async (req, res) => {
  try {
    const { department_id } = req.query;
    const filter = department_id ? { department_id: toOID(department_id) } : {};
    const exams = await Exam.find(filter).sort({ created_at: -1 }).populate('course_id').populate('assigned_to', 'display_name username');
    const data = exams.map(e => ({
      id: e._id.toString(), title: e.title,
      assigned_to_all: !!e.assigned_to_all,
      course_name: e.course_id?.name || '',
      assigned_to: (e.assigned_to || []).map(l => ({ id: l._id.toString(), display_name: l.display_name, username: l.username }))
    }));
    res.json({ success: true, exams: data });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/exam-assignments  — save assignments {exam_id, lecturer_ids:[]}
app.post('/api/admin/exam-assignments', async (req, res) => {
  try {
    const { exam_id, lecturer_ids, assign_all } = req.body;
    if (!exam_id) return res.json({ success: false, message: 'exam_id required.' });
    const ids = Array.isArray(lecturer_ids) ? lecturer_ids.map(toOID).filter(Boolean) : [];
    const exam = await Exam.findByIdAndUpdate(toOID(exam_id), { assigned_to: ids, assigned_to_all: !!assign_all }, { new: true });
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ── Access Code Routes ────────────────────────────────────────
app.post('/api/admin/exams/:id/generate-code', async (req, res) => {
  try {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let attempts = 0;
    while (attempts < 10) {
      code = '';
      for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
      const existing = await Exam.findOne({ access_code: code });
      if (!existing) break;
      attempts++;
    }
    const exam = await Exam.findByIdAndUpdate(req.params.id, { access_code: code }, { new: true });
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true, access_code: exam.access_code });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/exams/:id/set-code', async (req, res) => {
  try {
    const { access_code } = req.body;
    if (!access_code || access_code.trim().length < 4)
      return res.json({ success: false, message: 'Code must be at least 4 characters.' });
    const code = access_code.trim().toUpperCase();
    const conflict = await Exam.findOne({ access_code: code, _id: { $ne: toOID(req.params.id) } });
    if (conflict) return res.json({ success: false, message: 'This code is already used by another exam.' });
    const exam = await Exam.findByIdAndUpdate(req.params.id, { access_code: code }, { new: true });
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true, access_code: exam.access_code });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/exams/:id/access-code', async (req, res) => {
  try {
    const exam = await Exam.findByIdAndUpdate(req.params.id, { $unset: { access_code: 1 } }, { new: true });
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ── Allowed-students routes ────────────────────────────────────────────────

// GET /api/admin/exams/:id/eligible-students — all students matching exam dept+level
app.get('/api/admin/exams/:id/eligible-students', adminAuth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    const filter = {};
    if (exam.department_id) filter.department_id = exam.department_id;
    if (exam.level_id)      filter.level_id      = exam.level_id;
    const students = await Student.find(filter, { name: 1, matric: 1, department_id: 1, level_id: 1 })
      .sort({ name: 1 }).lean();
    const allowedSet = new Set((exam.allowed_students || []).map(id => id.toString()));
    res.json({
      success: true,
      restrictions_saved: !!exam.access_restrictions_saved,
      students: students.map(s => ({
        id: s._id.toString(),
        name: s.name,
        matric: s.matric,
        allowed: allowedSet.has(s._id.toString())
      }))
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


app.get('/api/admin/exams/:id/allowed-students', adminAuth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('allowed_students', 'name matric department_id level_id')
      .lean();
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    res.json({ success: true, students: exam.allowed_students || [], restricted: (exam.allowed_students || []).length > 0 });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/exams/:id/allowed-students/search  — search students to add
app.post('/api/admin/exams/:id/allowed-students/search', adminAuth, async (req, res) => {
  try {
    const { q } = req.body;
    if (!q || q.trim().length < 1) return res.json({ success: true, results: [] });
    const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const students = await Student.find({
      $or: [{ name: regex }, { matric: regex }]
    }, { name: 1, matric: 1, department_id: 1, level_id: 1 }).limit(20).lean();
    res.json({ success: true, results: students.map(s => ({ id: s._id.toString(), name: s.name, matric: s.matric })) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/exams/:id/allowed-students  — add students (by IDs array or CSV matrics)
app.post('/api/admin/exams/:id/allowed-students', adminAuth, async (req, res) => {
  try {
    const { student_ids, matrics } = req.body;
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });

    let toAdd = [];

    if (student_ids && student_ids.length) {
      toAdd = student_ids.map(id => toOID(id)).filter(Boolean);
    } else if (matrics && matrics.length) {
      // CSV upload path — resolve matric strings OR names to Student IDs
      const foundByMatric = await Student.find({ matric: { $in: matrics } }, { _id: 1, matric: 1, name: 1 }).lean();
      const matchedMatrics = new Set(foundByMatric.map(f => f.matric));
      const unmatched = matrics.filter(m => !matchedMatrics.has(m));

      // For unmatched entries, try matching by name (case-insensitive, word-order flexible)
      let foundByName = [];
      if (unmatched.length) {
        // Pass 1: exact full-name match (case-insensitive)
        const exactQueries = unmatched.map(n => ({ name: { $regex: new RegExp(`^${n.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') } }));
        foundByName = await Student.find({ $or: exactQueries }, { _id: 1, matric: 1, name: 1 }).lean();

        // Pass 2: for still-unmatched, try all-words-present match (handles word order differences)
        const exactMatched = new Set(foundByName.map(f => f.name.trim().toLowerCase()));
        const stillUnmatched = unmatched.filter(m => !exactMatched.has(m.trim().toLowerCase()));
        if (stillUnmatched.length) {
          // Fetch all students from same department if possible, else broad search
          const normalize = str => str.trim().toLowerCase().replace(/[-_.']/g, ' ').replace(/\s+/g, ' ');
          const allStudents = await Student.find({}, { _id: 1, name: 1 }).lean();
          for (const csvName of stillUnmatched) {
            const words = normalize(csvName).split(/\s+/).filter(w => w.length > 1);
            const match = allStudents.find(s => {
              const dbWords = normalize(s.name);
              return words.every(w => dbWords.includes(w));
            });
            if (match && !foundByName.some(f => f._id.equals(match._id))) {
              foundByName.push(match);
            }
          }
        }
      }

      const matchedByNameIds = new Set(foundByName.map(f => f._id.toString()));
      // Build notFound: names that didn't match by matric or name
      const normalize = str => str.trim().toLowerCase().replace(/[-_.']/g, ' ').replace(/\s+/g, ' ');
      const notFound = unmatched.filter(csvName => {
        const words = normalize(csvName).split(/\s+/).filter(w => w.length > 1);
        return !foundByName.some(f => {
          const dbName = normalize(f.name);
          return words.every(w => dbName.includes(w));
        });
      });

      toAdd = [...foundByMatric, ...foundByName].map(s => s._id);

      if (!toAdd.length) {
        return res.json({ success: false, message: 'None of the matric numbers or names matched any student in the database.', not_found: notFound });
      }
      // Proceed with matched students, warn about unmatched
      const existing = (exam.allowed_students || []).map(id => id.toString());
      const newIds = toAdd.filter(id => !existing.includes(id.toString()));
      exam.allowed_students = [...(exam.allowed_students || []), ...newIds];
      exam.access_restrictions_saved = true;
      await exam.save();
      return res.json({ success: true, added: newIds.length, not_found: notFound });
    }

    if (!toAdd.length) return res.json({ success: false, message: 'No valid student IDs provided.' });
    const existing = (exam.allowed_students || []).map(id => id.toString());
    const newIds = toAdd.filter(id => !existing.includes(id.toString()));
    exam.allowed_students = [...(exam.allowed_students || []), ...newIds];
    exam.access_restrictions_saved = true;
    await exam.save();
    res.json({ success: true, added: newIds.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/exams/:id/allowed-students/unrestrict-csv  — remove students by matric/name CSV
app.post('/api/admin/exams/:id/allowed-students/unrestrict-csv', adminAuth, async (req, res) => {
  try {
    const { matrics } = req.body;
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    if (!matrics || !matrics.length) return res.json({ success: false, message: 'No entries provided.' });

    const normalize = str => str.trim().toLowerCase().replace(/[-_.']/g, ' ').replace(/\s+/g, ' ');

    // Pass 1: match by matric
    const foundByMatric = await Student.find({ matric: { $in: matrics } }, { _id: 1, matric: 1, name: 1 }).lean();
    const matchedMatrics = new Set(foundByMatric.map(f => f.matric));
    const unmatched = matrics.filter(m => !matchedMatrics.has(m));

    // Pass 2: match by name (exact, case-insensitive)
    let foundByName = [];
    if (unmatched.length) {
      const exactQueries = unmatched.map(n => ({ name: { $regex: new RegExp('^' + n.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') } }));
      foundByName = await Student.find({ $or: exactQueries }, { _id: 1, matric: 1, name: 1 }).lean();

      // Pass 3: fuzzy word match
      const exactMatched = new Set(foundByName.map(f => f.name.trim().toLowerCase()));
      const stillUnmatched = unmatched.filter(m => !exactMatched.has(m.trim().toLowerCase()));
      if (stillUnmatched.length) {
        const allStudents = await Student.find({}, { _id: 1, name: 1 }).lean();
        for (const csvName of stillUnmatched) {
          const words = normalize(csvName).split(/\s+/).filter(w => w.length > 1);
          const match = allStudents.find(s => {
            const dbWords = normalize(s.name);
            return words.every(w => dbWords.includes(w));
          });
          if (match && !foundByName.some(f => f._id.equals(match._id))) foundByName.push(match);
        }
      }
    }

    const toRemove = new Set([...foundByMatric, ...foundByName].map(s => s._id.toString()));
    const notFound = matrics.filter(csvName => {
      const words = normalize(csvName).split(/\s+/).filter(w => w.length > 1);
      return ![...foundByMatric, ...foundByName].some(f =>
        f.matric === csvName || words.every(w => normalize(f.name).includes(w))
      );
    });

    const before = (exam.allowed_students || []).length;
    exam.allowed_students = (exam.allowed_students || []).filter(id => !toRemove.has(id.toString()));
    const removed = before - exam.allowed_students.length;
    await exam.save();

    res.json({ success: true, added: removed, not_found: notFound });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// DELETE /api/admin/exams/:id/allowed-students/:sid  — remove one student
app.delete('/api/admin/exams/:id/allowed-students/:sid', adminAuth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    exam.allowed_students = (exam.allowed_students || []).filter(id => id.toString() !== req.params.sid);
    await exam.save();
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// DELETE /api/admin/exams/:id/allowed-students  — clear ALL restrictions (open to everyone)
app.delete('/api/admin/exams/:id/allowed-students', adminAuth, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false, message: 'Exam not found' });
    exam.allowed_students = [];
    exam.access_restrictions_saved = true; // mark as explicitly configured (open to all)
    await exam.save();
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});



app.get('/api/admin/questions', async (req, res) => {
  try {
    const { exam_id } = req.query;
    const q = await Question.find({ exam_id: toOID(exam_id) }).sort({ created_at: -1 });
    res.json(q.map(x => ({ id: x._id.toString(), ...x.toObject() })));
  } catch(e) { res.json([]); }
});

app.post('/api/admin/add-question', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.exam_id) body.exam_id = toOID(body.exam_id);
    const q = await Question.create(body);
    res.json({ success: true, question: { id: q._id.toString(), ...q.toObject() } });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.put('/api/admin/questions/:id', async (req, res) => {
  try {
    await Question.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/questions/:id', async (req, res) => {
  try {
    await Question.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/upload-questions', upload.single('csv'), async (req, res) => {
  try {
    const { exam_id } = req.body;
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    const { parse } = require('csv-parse/sync');
    const content   = fs.readFileSync(req.file.path, 'utf8');
    const records   = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const docs = records.map(r => {
      const qt  = (r.question_type || r.type || '').toLowerCase();
      const isTF = qt === 'true_false' || qt === 'truefalse' || qt === 'tf' ||
                   (!(r.optionC || r.OptionC || r.option_c) && !(r.optionD || r.OptionD || r.option_d));
      return {
        exam_id:       toOID(exam_id),
        question:      r.question || r.Question,
        question_type: isTF ? 'true_false' : 'multiple_choice',
        optionA:       r.optionA || r.OptionA || r.option_a || (isTF ? 'True' : ''),
        optionB:       r.optionB || r.OptionB || r.option_b || (isTF ? 'False' : ''),
        optionC:       isTF ? '' : (r.optionC || r.OptionC || r.option_c || ''),
        optionD:       isTF ? '' : (r.optionD || r.OptionD || r.option_d || ''),
        answer:        (r.answer || r.Answer || '').toUpperCase()
      };
    }).filter(d => d.question && d.optionA && d.answer);
    await Question.insertMany(docs);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, count: docs.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/bulk-questions-json — accepts pre-parsed questions array from upload-questions.html
app.post('/api/admin/bulk-questions-json', async (req, res) => {
  try {
    const { exam_id, questions } = req.body;
    if (!exam_id)           return res.json({ success: false, message: 'No exam selected.' });
    if (!questions?.length) return res.json({ success: false, message: 'No questions provided.' });
    const examOID = toOID(exam_id);
    if (!examOID) return res.json({ success: false, message: 'Invalid exam ID.' });
    const docs = questions
      .filter(q => q.question && q.optionA && q.optionB && ['A','B','C','D'].includes((q.answer||'').toUpperCase()))
      .map(q => {
        const isTF = (q.question_type === 'true_false') || (!q.optionC && !q.optionD);
        return {
          exam_id:       examOID,
          question:      q.question,
          question_type: isTF ? 'true_false' : 'multiple_choice',
          optionA:       q.optionA,
          optionB:       q.optionB,
          optionC:       isTF ? '' : (q.optionC || ''),
          optionD:       isTF ? '' : (q.optionD || ''),
          answer:        q.answer.toUpperCase()
        };
      });
    if (!docs.length) return res.json({ success: false, message: 'No valid questions found. Check that each row has a question, four options, and a valid answer (A/B/C/D).' });
    await Question.insertMany(docs);
    res.json({ success: true, count: docs.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/students', async (req, res) => {
  try {
    const { department_id, search } = req.query;
    const filter = department_id ? { department_id: toOID(department_id) } : {};
    if (search) {
      filter.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { matric: { $regex: search, $options: 'i' } }
      ];
    }
    const students = await Student.find(filter).sort({ name: 1 })
      .populate('department_id').populate('level_id');
    res.json(students.map(s => ({
      id: s._id.toString(), name: s.name, matric: s.matric,
      department: s.department_id?.name, level: s.level_id?.name,
      department_id: s.department_id?._id?.toString() || null,
      level_id:      s.level_id?._id?.toString()      || null,
      created_at: s.created_at
    })));
  } catch(e) { res.json([]); }
});

app.post('/api/admin/add-student', async (req, res) => {
  try {
    const { name, matric, email, department_id, level_id, created_by } = req.body;

    // Auto-assign the active generated password for this department
    // Falls back to a placeholder if none exists yet
    const dept = await Department.findById(toOID(department_id));
    const deptName = dept?.name || '';
    const genPw = await GeneratedPassword.findOne({
      scope:     deptName,
      is_active: true,
      $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }]
    }).sort({ created_at: -1 });

    const plainPw  = genPw ? genPw.plain_password : 'changeme';
    const hashedPw = bcrypt.hashSync(plainPw, 10);

    const s = await Student.create({
      name, matric: matric ? normalizeMatric(matric) : undefined,
      email: email ? String(email).trim().toLowerCase() : null,
      department_id: toOID(department_id),
      level_id:      toOID(level_id),
      password:      hashedPw
    });

    // Log activity if done by a lecturer
    if (created_by) {
      const lec = await Admin.findById(toOID(created_by));
      if (lec) await logActivity(lec._id, lec.display_name, 'add_student', `Added student: "${name}" (${matric})`);
    }

    res.json({ success: true, student: { id: s._id.toString(), name: s.name, matric: s.matric } });
  } catch(e) {
    if (e.code === 11000) return res.json({ success: false, message: 'Matric number already exists.' });
    res.json({ success: false, message: e.message });
  }
});

app.put('/api/admin/students/:id', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.department_id) body.department_id = toOID(body.department_id);
    if (body.level_id)      body.level_id      = toOID(body.level_id);
    if (body.password)      body.password      = bcrypt.hashSync(body.password, 10);
    await Student.findByIdAndUpdate(req.params.id, body);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/students/:id', async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/upload-students', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    const { parse } = require('csv-parse/sync');
    const content   = fs.readFileSync(req.file.path, 'utf8');
    const records   = parse(content, { columns: true, skip_empty_lines: true, trim: true });
    const [departments, levels] = await Promise.all([Department.find(), Level.find()]);
    let inserted = 0, skipped = 0, errors = [];
    for (const r of records) {
      try {
        const name  = r.name  || r.Name  || '';
        const dept  = r.arm   || r.department || r.Department || '';
        const level = r.class || r.level      || r.Level      || '';
        const matricIn = r.matric || r.Matric || r.matric_number || r['Matric Number'] || '';
        const emailIn  = r.email  || r.Email  || '';
        if (!name) { skipped++; continue; }
        const deptDoc  = departments.find(d => d.name.toLowerCase() === dept.toLowerCase());
        const levelDoc = levels.find(l => l.name.toLowerCase() === level.toLowerCase());
        const genPw = deptDoc ? await GeneratedPassword.findOne({
          scope: deptDoc.name, is_active: true,
          $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }]
        }).sort({ created_at: -1 }) : null;
        const assignedPw = genPw ? genPw.plain_password : 'changeme';
        const newStudent = { name, password: bcrypt.hashSync(assignedPw, 10) };
        if (matricIn) newStudent.matric = normalizeMatric(matricIn);
        if (emailIn)  newStudent.email  = String(emailIn).trim().toLowerCase();
        if (deptDoc)  newStudent.department_id = deptDoc._id;
        if (levelDoc) newStudent.level_id      = levelDoc._id;
        await Student.create(newStudent);
        inserted++;
      } catch(e2) { errors.push(e2.message); skipped++; }
    }
    fs.unlinkSync(req.file.path);
    res.json({ success: true, inserted, skipped, errors: errors.slice(0, 5) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/bulk-students — JSON array of students (name, optional matric/email)
app.post('/api/admin/bulk-students', adminAuth, async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || !students.length)
      return res.json({ success: false, message: 'No students provided' });
    const [departments, levels] = await Promise.all([Department.find(), Level.find()]);
    let count = 0, skipped = 0, errors = [];
    for (const r of students) {
      try {
        const name  = (r.name  || '').trim();
        const dept  = (r.arm   || r.department || '').trim();
        const level = (r.class || r.level      || '').trim();
        const matricIn = (r.matric || '').toString().trim();
        const emailIn  = (r.email  || '').toString().trim();
        if (!name) { skipped++; continue; }
        const deptDoc  = departments.find(d => d.name.toLowerCase() === dept.toLowerCase());
        const levelDoc = levels.find(l => l.name.toLowerCase() === level.toLowerCase());
        const genPw = deptDoc ? await GeneratedPassword.findOne({
          scope: deptDoc.name, is_active: true,
          $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }]
        }).sort({ created_at: -1 }) : null;
        const assignedPw = genPw ? genPw.plain_password : 'changeme';
        const newStudent = { name, password: bcrypt.hashSync(assignedPw, 10) };
        if (matricIn) newStudent.matric = normalizeMatric(matricIn);
        if (emailIn)  newStudent.email  = emailIn.toLowerCase();
        if (deptDoc)  newStudent.department_id = deptDoc._id;
        if (levelDoc) newStudent.level_id      = levelDoc._id;
        await Student.create(newStudent);
        count++;
      } catch(e2) { errors.push(e2.message); skipped++; }
    }
    res.json({ success: true, count, skipped, errors: errors.slice(0, 5) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== VIOLATIONS ==========
// ===========================

app.get('/api/admin/violations', async (req, res) => {
  try {
    const { type, date_from, date_to, exam_id, matric, lecturer_id } = req.query;

    // If lecturer_id given, restrict to exams they created
    let allowedExamIds = null;
    if (lecturer_id) {
      const myExams = await Exam.find(lecturerExamQuery(lecturer_id), { _id: 1 });
      allowedExamIds = myExams.map(e => e._id);
    }

    const violFilter = {};
    if (type && type !== 'all') violFilter.violation_type = type;
    if (date_from || date_to) {
      violFilter.created_at = {};
      if (date_from) violFilter.created_at.$gte = new Date(date_from);
      if (date_to)   violFilter.created_at.$lte = new Date(new Date(date_to).setHours(23,59,59));
    }
    const violations = await Violation.find(violFilter)
      .sort({ created_at: -1 }).limit(1000)
      .populate({
        path: 'session_id',
        populate: [
          { path: 'student_id', populate: [{ path: 'department_id' }, { path: 'level_id' }] },
          { path: 'exam_id' }
        ]
      });
    let data = violations.map(v => ({
      id:              v._id.toString(),
      reason:          v.reason,
      count:           v.count,
      violation_type:  v.violation_type || 'rule_violation',
      sub_type:        v.sub_type || 'other',
      created_at:      v.created_at,
      capture_url:     v.capture_url || null,
      clip_url:        v.clip_url    || null,
      student_name:    v.session_id?.student_id?.name    || '—',
      matric:          v.session_id?.student_id?.matric  || '—',
      department_name: v.session_id?.student_id?.department_id?.name || '—',
      level_name:      v.session_id?.student_id?.level_id?.name      || '—',
      exam_title:      v.session_id?.exam_id?.title || '—',
      exam_id:         v.session_id?.exam_id?._id?.toString() || ''
    }));
    if (allowedExamIds) data = data.filter(d => allowedExamIds.map(id => id.toString()).includes(d.exam_id));
    if (exam_id && exam_id !== 'all') data = data.filter(d => d.exam_id === exam_id);
    if (matric) data = data.filter(d => d.matric.toLowerCase().includes(matric.toLowerCase()));
    res.json(data);
  } catch(e) { res.json([]); }
});

// Student violation history
app.get('/api/admin/violations/student/:matric', async (req, res) => {
  try {
    const student = await Student.findOne({ matric: req.params.matric })
      .populate('department_id').populate('level_id');
    if (!student) return res.json({ success: false, message: 'Student not found' });
    const sessions    = await ExamSession.find({ student_id: student._id });
    const sessionIds  = sessions.map(s => s._id);
    const violations  = await Violation.find({ session_id: { $in: sessionIds } })
      .sort({ created_at: -1 })
      .populate({ path: 'session_id', populate: { path: 'exam_id' } });
    const summary = {
      total:          violations.length,
      rule_violation: violations.filter(v => (v.violation_type || 'rule_violation') === 'rule_violation').length,
      network_error:  violations.filter(v => v.violation_type === 'network_error').length,
      system_error:   violations.filter(v => v.violation_type === 'system_error').length,
    };
    res.json({
      success: true,
      student: { name: student.name, matric: student.matric, department: student.department_id?.name, level: student.level_id?.name },
      summary,
      violations: violations.map(v => ({
        id: v._id.toString(), reason: v.reason, count: v.count,
        violation_type: v.violation_type || 'rule_violation',
        created_at: v.created_at,
        exam_title: v.session_id?.exam_id?.title || '—'
      }))
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== RESULTS =============
// ===========================

app.get('/api/admin/session-debug', async (req, res) => {
  try {
    const { student_id, exam_id } = req.query;
    const filter = {};
    if (student_id) filter.student_id = toOID(student_id);
    if (exam_id)   filter.exam_id    = toOID(exam_id);
    const sessions = await ExamSession.find(filter).sort({ started_at: -1 }).limit(3);
    const data = await Promise.all(sessions.map(async s => {
      const mapKeys = Object.keys(s.shuffled_answer_map || {});
      const mapSample = mapKeys.slice(0, 3).map(k => ({ qid: k, correctKey: s.shuffled_answer_map[k] }));
      // Also get the actual question answers for comparison
      const qSample = await Promise.all(mapKeys.slice(0, 3).map(async k => {
        const q = await Question.findById(k, 'answer optionA optionB optionC optionD');
        return { qid: k, dbAnswer: q?.answer, mappedAnswer: s.shuffled_answer_map[k] };
      }));
      return {
        session_id:  s._id,
        status:      s.status,
        started_at:  s.started_at,
        map_key_count: mapKeys.length,
        map_sample:  mapSample,
        q_comparison: qSample,
        student_answers: s.answers ? Object.keys(s.answers).slice(0, 3).map(k => ({ qid: k, studentKey: s.answers[k] })) : []
      };
    }));
    res.json({ ok: true, sessions: data });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/admin/results/debug', async (req, res) => {
  try {
    const count = await ExamResult.countDocuments();
    const sample = await ExamResult.findOne().populate('student_id').populate('exam_id');
    res.json({
      ok: true,
      total_results: count,
      sample: sample ? {
        id: sample._id,
        student: sample.student_id?.name,
        exam: sample.exam_id?.title,
        percentage: sample.percentage
      } : null
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/results', async (req, res) => {
  try {
    const { lecturer_id, exam_id, department, sub_department } = req.query;
    let resultFilter = {};
    if (lecturer_id) {
      const myExams = await Exam.find(lecturerExamQuery(lecturer_id), { _id: 1 });
      resultFilter.exam_id = { $in: myExams.map(e => e._id) };
    }
    if (exam_id) {
      const oid = toOID(exam_id);
      if (oid) resultFilter.exam_id = oid;
    }
    const results = await ExamResult.find(resultFilter).sort({ submitted_at: -1 }).limit(500)
      .populate({ path: 'student_id', populate: [{ path: 'department_id' }, { path: 'level_id' }] })
      .populate('exam_id');
    let mapped = results.map(r => ({
      id: r._id.toString(), percentage: r.percentage ?? 0, correct: r.correct ?? 0,
      wrong: r.wrong ?? 0, total: r.total ?? 0, time_taken: r.time_taken ?? 0,
      submitted_at: r.submitted_at,
      student_name: r.student_id?.name || 'Unknown', matric: r.student_id?.matric || '-',
      department_name:  r.student_id?.department_id?.name || '-',
      sub_department:   r.student_id?.sub_department || null,
      level_name:       r.student_id?.level_id?.name || '-',
      exam_title:       r.exam_id?.title || '-'
    }));
    if (department) mapped = mapped.filter(r => r.department_name === department);
    if (sub_department) mapped = mapped.filter(r => r.sub_department === sub_department);
    res.json(mapped);
  } catch(e) { console.error('Results route error:', e); res.status(500).json({ error: e.message }); }
});

// DELETE a single exam result
app.delete('/api/admin/results/:id', adminAuth, async (req, res) => {
  try {
    await ExamResult.findByIdAndDelete(req.params.id);
    await ExamReview.deleteMany({ result_id: toOID(req.params.id) });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ── SUPER ADMIN ONLY: Edit score ──────────────────────────────
app.patch('/api/superadmin/results/:id', adminAuth, async (req, res) => {
  try {
    // Verify caller is super admin
    const token = req.headers['x-admin-token'] || req.query._t;
    const admin = await Admin.findOne({ activeToken: token });
    if (!admin || admin.role !== 'super') {
      return res.status(403).json({ success: false, message: 'Super admin access required.' });
    }

    const { correct, wrong, total, percentage, edit_reason } = req.body;

    // Validate
    if (typeof correct !== 'number' || typeof wrong !== 'number' || typeof total !== 'number') {
      return res.json({ success: false, message: 'correct, wrong, total must be numbers.' });
    }
    if (correct < 0 || wrong < 0 || correct + wrong > total) {
      return res.json({ success: false, message: 'Invalid score values.' });
    }

    const computedPct = total > 0 ? Math.round((correct / total) * 100) : 0;

    const updated = await ExamResult.findByIdAndUpdate(
      req.params.id,
      {
        correct,
        wrong,
        total,
        percentage: typeof percentage === 'number' ? percentage : computedPct,
        score_edited:    true,
        score_edited_by: admin.display_name || admin.username,
        score_edited_at: new Date(),
        score_edit_reason: edit_reason || ''
      },
      { new: true }
    ).populate('student_id', 'name matric').populate('exam_id', 'title');

    if (!updated) return res.json({ success: false, message: 'Result not found.' });

    await logActivity(admin._id, admin.display_name || admin.username, 'SCORE_EDIT',
      `Edited score for ${updated.student_id?.name} — ${updated.exam_id?.title}: ${correct}/${total} (${computedPct}%)`);

    res.json({ success: true, result: updated });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.get('/api/admin/analytics', async (req, res) => {
  try {
    const [totalStudents, totalExams, totalResults, totalViolations] = await Promise.all([
      Student.countDocuments(), Exam.countDocuments(),
      ExamResult.countDocuments(), Violation.countDocuments()
    ]);
    const avgScore = await ExamResult.aggregate([{ $group: { _id: null, avg: { $avg: '$percentage' } } }]);
    const byExam   = await ExamResult.aggregate([
      { $group: { _id: '$exam_id', avg: { $avg: '$percentage' }, count: { $sum: 1 } } },
      { $lookup: { from: 'exams', localField: '_id', foreignField: '_id', as: 'exam' } },
      { $project: { title: { $arrayElemAt: ['$exam.title', 0] }, avg: 1, count: 1 } }
    ]);
    const violsByType = await Violation.aggregate([
      { $group: { _id: '$violation_type', count: { $sum: 1 } } }
    ]);
    res.json({
      totalStudents, totalExams, totalResults, totalViolations,
      avgScore:    Math.round(avgScore[0]?.avg || 0),
      byExam:      byExam.map(e => ({ title: e.title || 'Unknown', avg: Math.round(e.avg), count: e.count })),
      violsByType: violsByType.map(v => ({ type: v._id || 'rule_violation', count: v.count }))
    });
  } catch(e) { res.json({ error: e.message }); }
});

// ===========================
// ===== FACE CAPTURES =======
// ===========================

app.get('/api/admin/face-captures', async (req, res) => {
  try {
    const { lecturer_id } = req.query;
    let captures;
    if (lecturer_id) {
      const myExams = await Exam.find(lecturerExamQuery(lecturer_id), { _id: 1 });
      const myExamIds = myExams.map(e => e._id);
      captures = await FaceCapture.find({ exam_id: { $in: myExamIds } }).sort({ captured_at: -1 }).limit(500);
    } else {
      captures = await FaceCapture.find().sort({ captured_at: -1 }).limit(500);
    }
    res.json(captures.map(c => ({
      id: c._id.toString(), student_name: c.student_name, matric: c.matric,
      exam_title: c.exam_title, cloudinary_url: c.cloudinary_url,
      public_id: c.public_id, captured_at: c.captured_at
    })));
  } catch(e) { res.json([]); }
});

// DELETE duplicate face captures — keeps best capture per student+exam
// * MUST be declared BEFORE /:id or Express will swallow "duplicates" as an ObjectId param
app.delete('/api/admin/face-captures/duplicates', adminAuth, async (req, res) => {
  try {
    const allCaptures = await FaceCapture.find().lean();

    // Group by student_id + exam_id
    const groups = {};
    allCaptures.forEach(c => {
      const key = `${c.student_id}_${c.exam_id}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });

    const toDelete = [];
    Object.values(groups).forEach(group => {
      if (group.length <= 1) return;
      // Priority: verified > not flagged > most recent
      group.sort((a, b) => {
        if (b.face_verified !== a.face_verified) return b.face_verified - a.face_verified;
        if (a.flagged !== b.flagged) return a.flagged - b.flagged;
        return new Date(b.captured_at) - new Date(a.captured_at);
      });
      const [, ...dupes] = group;
      dupes.forEach(d => toDelete.push(d));
    });

    if (toDelete.length === 0) return res.json({ success: true, deleted: 0 });

    // Delete from Cloudinary and DB
    await Promise.allSettled(toDelete.map(d =>
      d.public_id ? cloudinary.uploader.destroy(d.public_id) : Promise.resolve()
    ));
    await FaceCapture.deleteMany({ _id: { $in: toDelete.map(d => d._id) } });
    res.json({ success: true, deleted: toDelete.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// DELETE a single face capture
app.delete('/api/admin/face-captures/:id', async (req, res) => {
  try {
    const capture = await FaceCapture.findById(req.params.id);
    if (!capture) return res.json({ success: false, message: 'Capture not found' });
    if (capture.public_id) {
      try { await cloudinary.uploader.destroy(capture.public_id); } catch(e) {}
    }
    await FaceCapture.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// DELETE all face captures
app.delete('/api/admin/face-captures', async (req, res) => {
  try {
    const captures = await FaceCapture.find({}, { public_id: 1 });
    captures.forEach(c => { if (c.public_id) cloudinary.uploader.destroy(c.public_id).catch(() => {}); });
    await FaceCapture.deleteMany({});
    res.json({ success: true, deleted: captures.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// === GENERATED PASSWORDS ===
// ===========================

app.get('/api/admin/generated-passwords', async (req, res) => {
  try {
    const passwords = await GeneratedPassword.find({ is_active: true }).sort({ created_at: -1 }).limit(200);
    res.json(passwords.map(p => ({
      id: p._id.toString(), plain_password: p.plain_password,
      label: p.label, scope: p.scope, expires_at: p.expires_at,
      use_once: p.use_once, used_count: p.used_by.length,
      created_by: p.created_by, created_at: p.created_at, is_active: p.is_active
    })));
  } catch(e) { res.json([]); }
});

// Generate a batch of login passwords — one shared password per department
app.post('/api/admin/generate-passwords', async (req, res) => {
  try {
    const { label = 'Batch Login', department_id, use_once = false, expires_hours, admin = 'Admin' } = req.body;

    const expires_at = expires_hours ? new Date(Date.now() + parseInt(expires_hours) * 3600000) : null;

    let scope = 'general';
    if (department_id) {
      const dept = await Department.findById(department_id);
      scope = dept ? dept.name : 'general';
    }

    // Generate ONE shared password for the department
    const plain = generateRandomPassword(8);
    const doc   = await GeneratedPassword.create({ plain_password: plain, label, scope, use_once, expires_at, created_by: admin, is_active: true });

    await PasswordAuditLog.create({
      action:  'generate',
      admin,
      details: `Generated shared password for department: "${scope}" — label: "${label}"${expires_hours ? `, expires in ${expires_hours}h` : ''}`
    });

    res.json({ success: true, passwords: [{ id: doc._id.toString(), plain_password: plain, label, scope, expires_at, use_once }] });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Deactivate a generated password
app.delete('/api/admin/generated-passwords/:id', async (req, res) => {
  try {
    await GeneratedPassword.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Password audit log
app.get('/api/admin/password-audit-log', async (req, res) => {
  try {
    const logs = await PasswordAuditLog.find().sort({ created_at: -1 }).limit(500);
    res.json(logs.map(l => ({
      id: l._id.toString(), action: l.action, admin: l.admin,
      details: l.details, created_at: l.created_at
    })));
  } catch(e) { res.json([]); }
});

// ===========================
// ===== ACTIVITY LOG ========
// ===========================

// Get activity log (super admin only — scoped to a specific lecturer if lecturer_id given)
app.get('/api/admin/activity-log', async (req, res) => {
  try {
    const { lecturer_id } = req.query;
    const filter = lecturer_id ? { admin_id: toOID(lecturer_id) } : {};
    const logs = await ActivityLog.find(filter).sort({ created_at: -1 }).limit(500);
    res.json(logs.map(l => ({
      id: l._id.toString(), admin_name: l.admin_name, action: l.action,
      detail: l.detail, created_at: l.created_at
    })));
  } catch(e) { res.json([]); }
});

// ===========================
// ===== DEPARTMENTS =========
// ===========================

app.post('/api/admin/departments', async (req, res) => {
  try {
    const d = await Department.create(req.body);
    res.json({ success: true, department: { id: d._id.toString(), name: d.name } });
  } catch(e) {
    if (e.code === 11000) return res.json({ success: false, message: 'Department already exists.' });
    res.json({ success: false, message: e.message });
  }
});
app.put('/api/admin/departments/:id', async (req, res) => {
  try { await Department.findByIdAndUpdate(req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/admin/departments/:id', async (req, res) => {
  try { await Department.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});

// ===== SUB-DEPARTMENT ROUTES =====
// GET sub-departments for a department
app.get('/api/admin/departments/:id/sub-departments', async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.json({ success: false, message: 'Department not found.' });
    res.json({ success: true, sub_departments: dept.sub_departments || [] });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST add a sub-department
app.post('/api/admin/departments/:id/sub-departments', adminAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.json({ success: false, message: 'Sub-department name required.' });
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.json({ success: false, message: 'Department not found.' });
    const clean = name.trim().toUpperCase();
    if ((dept.sub_departments || []).includes(clean))
      return res.json({ success: false, message: 'Sub-department already exists.' });
    dept.sub_departments = [...(dept.sub_departments || []), clean];
    await dept.save();
    res.json({ success: true, sub_departments: dept.sub_departments });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// DELETE a sub-department
app.delete('/api/admin/departments/:id/sub-departments/:name', adminAuth, async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.json({ success: false, message: 'Department not found.' });
    const target = decodeURIComponent(req.params.name).toUpperCase();
    // Prevent delete if students are using this sub-department
    const count = await Student.countDocuments({ department_id: dept._id, sub_department: target });
    if (count > 0) return res.json({ success: false, message: `Cannot delete — ${count} student(s) are assigned to "${target}".` });
    dept.sub_departments = (dept.sub_departments || []).filter(s => s !== target);
    await dept.save();
    res.json({ success: true, sub_departments: dept.sub_departments });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST student selects their sub-department (student auth)
app.post('/api/student/select-sub-department', async (req, res) => {
  try {
    const { student_id, sub_department } = req.body;
    if (!student_id || !sub_department) return res.json({ success: false, message: 'Missing fields.' });
    const student = await Student.findById(toOID(student_id)).populate('department_id');
    if (!student) return res.json({ success: false, message: 'Student not found.' });
    const dept = student.department_id;
    if (!dept || !(dept.sub_departments || []).includes(sub_department))
      return res.json({ success: false, message: 'Invalid sub-department.' });
    student.sub_department = sub_department;
    await student.save();
    res.json({ success: true, sub_department });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== LEVELS ==============
// ===========================

app.post('/api/admin/levels', async (req, res) => {
  try {
    const l = await Level.create(req.body);
    res.json({ success: true, level: { id: l._id.toString(), name: l.name } });
  } catch(e) {
    if (e.code === 11000) return res.json({ success: false, message: 'Level already exists.' });
    res.json({ success: false, message: e.message });
  }
});
app.put('/api/admin/levels/:id', async (req, res) => {
  try { await Level.findByIdAndUpdate(req.params.id, req.body); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/admin/levels/:id', async (req, res) => {
  try { await Level.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== SEMESTERS ===========
// ===========================

app.get('/api/semesters', async (req, res) => {
  try {
    const semesters = await Semester.find().sort({ created_at: -1 });
    res.json(semesters.map(s => ({
      id: s._id.toString(), name: s.name, session: s.session,
      type: s.type, is_active: s.is_active,
      started_at: s.started_at, ended_at: s.ended_at, created_at: s.created_at
    })));
  } catch(e) { res.json([]); }
});

app.get('/api/semesters/active', async (req, res) => {
  try {
    const s = await Semester.findOne({ is_active: true });
    res.json(s ? { id: s._id.toString(), name: s.name, session: s.session, type: s.type } : null);
  } catch(e) { res.json(null); }
});

app.post('/api/admin/semesters', async (req, res) => {
  try {
    const { name, session, type, set_active } = req.body;
    if (set_active) await Semester.updateMany({}, { is_active: false }); // deactivate all
    const s = await Semester.create({ name, session, type, is_active: !!set_active });
    res.json({ success: true, semester: { id: s._id.toString(), name: s.name } });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Set a semester as the active one
app.put('/api/admin/semesters/:id/activate', async (req, res) => {
  try {
    // Only deactivate currently active semesters (not the one being activated)
    await Semester.updateMany({ is_active: true, _id: { $ne: req.params.id } }, { is_active: false, ended_at: new Date() });
    await Semester.findByIdAndUpdate(req.params.id, { is_active: true, ended_at: null, started_at: new Date() });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/semesters/:id', async (req, res) => {
  try {
    await Semester.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== COURSES =============
// ===========================

app.post('/api/admin/courses', async (req, res) => {
  try {
    const { name, code, department_id, level_id } = req.body;
    const payload = { name, code };
    if (department_id) payload.department_id = toOID(department_id);
    if (level_id)      payload.level_id      = toOID(level_id);
    const c = await Course.create(payload);
    await c.populate('department_id');
    await c.populate('level_id');
    res.json({ success: true, course: {
      id: c._id.toString(), name: c.name, code: c.code,
      department_id:   c.department_id?._id?.toString() || null,
      department_name: c.department_id?.name || null,
      level_id:        c.level_id?._id?.toString() || null,
      level_name:      c.level_id?.name || null
    }});
  } catch(e) { res.json({ success: false, message: e.message }); }
});
app.put('/api/admin/courses/:id', async (req, res) => {
  try {
    const { name, code, department_id, level_id } = req.body;
    const update = { name, code };
    update.department_id = department_id ? toOID(department_id) : null;
    update.level_id      = level_id      ? toOID(level_id)      : null;
    await Course.findByIdAndUpdate(req.params.id, update);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});
app.delete('/api/admin/courses/:id', async (req, res) => {
  try { await Course.findByIdAndDelete(req.params.id); res.json({ success: true }); }
  catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/bulk-courses — JSON array of courses parsed from CSV on the client
// Expected shape: { courses: [{ name, code, department, level }] }
// department/level are matched by name (case-insensitive) against existing records.
app.post('/api/admin/bulk-courses', async (req, res) => {
  try {
    const { courses } = req.body;
    if (!Array.isArray(courses) || !courses.length)
      return res.json({ success: false, message: 'No courses provided' });
    const [departments, levels] = await Promise.all([Department.find(), Level.find()]);
    let count = 0, skipped = 0, errors = [];
    for (const r of courses) {
      try {
        const name  = (r.name  || '').trim();
        const code  = (r.code  || '').trim();
        const dept  = (r.department || '').trim();
        const level = (r.level      || '').trim();
        if (!name) { skipped++; continue; }
        const deptDoc  = dept  ? departments.find(d => d.name.toLowerCase() === dept.toLowerCase())  : null;
        const levelDoc = level ? levels.find(l => l.name.toLowerCase() === level.toLowerCase()) : null;
        const payload = { name };
        if (code) payload.code = code;
        if (deptDoc)  payload.department_id = deptDoc._id;
        if (levelDoc) payload.level_id      = levelDoc._id;
        await Course.create(payload);
        count++;
      } catch(e2) { errors.push(e2.message); skipped++; }
    }
    res.json({ success: true, count, skipped, errors: errors.slice(0, 5) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== SETTINGS ============
// ===========================

app.get('/api/admin/settings', async (req, res) => {
  try {
    const settings = await Setting.find();
    res.json(Object.fromEntries(settings.map(s => [s.key, s.value])));
  } catch(e) { res.json({}); }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const body = req.body;
    // Single key/value save: { key: 'max_violations', value: 3 }
    if (body.key !== undefined && body.value !== undefined && Object.keys(body).length === 2) {
      await Setting.findOneAndUpdate({ key: body.key }, { key: body.key, value: body.value }, { upsert: true });
    } else {
      // Bulk save: { max_violations: 3, portal_open: true, ... }
      for (const [key, value] of Object.entries(body)) {
        await Setting.findOneAndUpdate({ key }, { key, value }, { upsert: true });
      }
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== RETAKE GRANTS =======
// ===========================

app.get('/api/admin/retake-grants', async (req, res) => {
  try {
    const grants = await RetakeGrant.find().populate('student_id');
    res.json(grants.map(g => ({
      id: g._id.toString(), student_id: g.student_id?._id.toString(),
      student_name: g.student_id?.name, matric: g.student_id?.matric, granted_at: g.granted_at
    })));
  } catch(e) { res.json([]); }
});

app.post('/api/admin/retake-grant', async (req, res) => {
  try {
    const { student_id } = req.body;
    await RetakeGrant.findOneAndUpdate(
      { student_id: toOID(student_id) },
      { student_id: toOID(student_id), granted_at: new Date() },
      { upsert: true }
    );
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.delete('/api/admin/retake-grant/:id', async (req, res) => {
  try {
    await RetakeGrant.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// ===========================
// ===== RETAKE REQUESTS =====
// ===========================

// Student: submit a retake request
app.post('/api/retake-request', async (req, res) => {
  try {
    const { student_id, exam_id, result_id, reason } = req.body;
    if (!student_id || !exam_id) return res.json({ success: false, message: 'Missing required fields.' });

    const exam = await Exam.findById(exam_id);
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    if (exam.retake_request_allowed === false)
      return res.json({ success: false, message: 'Retake requests are not allowed for this exam.' });

    // Check for existing request
    const existing = await RetakeRequest.findOne({ student_id: toOID(student_id), exam_id: toOID(exam_id) });
    if (existing) return res.json({ success: false, message: 'You have already submitted a retake request for this exam.' });

    await RetakeRequest.create({
      student_id: toOID(student_id),
      exam_id:    toOID(exam_id),
      result_id:  result_id ? toOID(result_id) : null,
      reason:     (reason || '').trim()
    });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Student: check retake request status for an exam
app.get('/api/retake-request/status', async (req, res) => {
  try {
    const { student_id, exam_id } = req.query;
    if (!student_id || !exam_id) return res.json({ found: false });
    const req_ = await RetakeRequest.findOne({ student_id: toOID(student_id), exam_id: toOID(exam_id) });
    if (!req_) return res.json({ found: false });
    res.json({ found: true, status: req_.status, admin_note: req_.admin_note || '' });
  } catch(e) { res.json({ found: false }); }
});

// Admin: list all retake requests
app.get('/api/admin/retake-requests', async (req, res) => {
  try {
    const requests = await RetakeRequest.find()
      .populate('student_id')
      .populate('exam_id')
      .sort({ requested_at: -1 });
    res.json(requests.map(r => ({
      id:           r._id.toString(),
      student_name: r.student_id?.name || '—',
      matric:       r.student_id?.matric || '—',
      student_email:r.student_id?.email || null,
      student_id:   r.student_id?._id?.toString(),
      exam_title:   r.exam_id?.title || '—',
      exam_id:      r.exam_id?._id?.toString(),
      retake_request_allowed: r.exam_id?.retake_request_allowed !== false,
      reason:       r.reason || '—',
      status:       r.status,
      admin_note:   r.admin_note || '',
      requested_at: r.requested_at,
      reviewed_at:  r.reviewed_at
    })));
  } catch(e) { res.json([]); }
});

// Admin: approve a retake request
app.put('/api/admin/retake-requests/:id/approve', async (req, res) => {
  try {
    const { admin_note } = req.body;
    const request = await RetakeRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', admin_note: admin_note || '', reviewed_at: new Date() },
      { new: true }
    ).populate('student_id').populate('exam_id');
    if (!request) return res.json({ success: false, message: 'Request not found.' });

    // Grant retake via RetakeGrant
    await RetakeGrant.findOneAndUpdate(
      { student_id: request.student_id._id },
      { student_id: request.student_id._id, granted_at: new Date() },
      { upsert: true }
    );

    // Send approval email
    if (request.student_id?.email) {
      await sendMail({
        to: request.student_id.email,
        subject: `Retake Approved — ${request.exam_id?.title || 'Exam'} | MARGMOCOTH CBT`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:28px;">
          <h2 style="color:#15803d;">Retake Request Approved</h2>
          <p>Dear <strong>${request.student_id.name}</strong>,</p>
          <p>Your retake request for <strong>${request.exam_id?.title || 'your exam'}</strong> has been <strong style="color:#15803d;">approved</strong>.</p>
          ${admin_note ? `<p><strong>Note from admin:</strong> ${admin_note}</p>` : ''}
          <p>You can now log in and retake the exam. Make sure you are fully prepared before starting.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
          <p style="color:#64748b;font-size:12px;">MARGMOCOTH i-CBT System</p>
        </div>`
      });
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Admin: decline a retake request
app.put('/api/admin/retake-requests/:id/decline', async (req, res) => {
  try {
    const { admin_note } = req.body;
    const request = await RetakeRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'declined', admin_note: admin_note || '', reviewed_at: new Date() },
      { new: true }
    ).populate('student_id').populate('exam_id');
    if (!request) return res.json({ success: false, message: 'Request not found.' });

    // Send decline email
    if (request.student_id?.email) {
      await sendMail({
        to: request.student_id.email,
        subject: `Retake Declined — ${request.exam_id?.title || 'Exam'} | MARGMOCOTH CBT`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:28px;">
          <h2 style="color:#b91c1c;">Retake Request Declined</h2>
          <p>Dear <strong>${request.student_id.name}</strong>,</p>
          <p>Your retake request for <strong>${request.exam_id?.title || 'your exam'}</strong> has been <strong style="color:#b91c1c;">declined</strong>.</p>
          ${admin_note ? `<p><strong>Reason:</strong> ${admin_note}</p>` : ''}
          <p>If you believe this is an error, please contact your department administrator.</p>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
          <p style="color:#64748b;font-size:12px;">MARGMOCOTH i-CBT System</p>
        </div>`
      });
    }
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Admin: toggle retake_request_allowed for an exam
app.put('/api/admin/exams/:id/retake-toggle', async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.json({ success: false, message: 'Exam not found.' });
    const newVal = !exam.retake_request_allowed;
    await Exam.findByIdAndUpdate(req.params.id, { retake_request_allowed: newVal });
    res.json({ success: true, retake_request_allowed: newVal });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== ZIP DOWNLOAD ========
// ===========================



// ===========================
// ===== FEATURE: EXAM REVIEW (Feature #1)
// GET /api/exam-review?result_id=xxx — student fetches their answer review
// ===========================
app.get('/api/exam-review', async (req, res) => {
  try {
    const { result_id, student_id } = req.query;
    if (!result_id) return res.json({ success: false, message: 'result_id required' });
    const review = await ExamReview.findOne({ result_id: toOID(result_id) });
    if (!review) return res.json({ success: false, message: 'Review not found. It may not be available yet.' });
    // Verify ownership — student can only see their own review
    if (student_id && review.student_id.toString() !== student_id)
      return res.json({ success: false, message: 'Unauthorized' });
    const showResults = await getSetting('show_results', false);
    if (!showResults) return res.json({ success: false, message: 'Answer review is not enabled by the administrator.' });
    res.json({ success: true, questions: review.questions });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Admin: get review for any result
app.get('/api/admin/exam-review/:result_id', async (req, res) => {
  try {
    const review = await ExamReview.findOne({ result_id: toOID(req.params.result_id) });
    if (!review) return res.json({ success: false, message: 'Review not found' });
    res.json({ success: true, questions: review.questions });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== FEATURE: LIVE EXAM DASHBOARD (Feature #5)
// GET /api/admin/live-exams — active sessions + stats
// ===========================
app.get('/api/admin/live-exams', async (req, res) => {
  try {
    const activeSessions = await ExamSession.find({ status: 'active' })
      .populate('student_id', 'name matric department_id')
      .populate('exam_id', 'title duration')
      .sort({ started_at: -1 });

    // Fetch recent violations for all active sessions in one query
    const sessionIds = activeSessions.map(s => s._id);
    const recentViolations = await Violation.find({ session_id: { $in: sessionIds } })
      .sort({ created_at: -1 });

    // Group violations by session_id
    const violBySession = {};
    recentViolations.forEach(v => {
      const sid = v.session_id.toString();
      if (!violBySession[sid]) violBySession[sid] = [];
      violBySession[sid].push({
        reason:    v.reason,
        sub_type:  v.sub_type || 'other',
        type:      v.violation_type,
        timestamp: v.created_at
      });
    });

    const data = activeSessions.map(s => {
      const elapsed = Math.round((Date.now() - new Date(s.started_at)) / 60000);
      const duration = s.exam_id?.duration || 60;
      const remaining = Math.max(0, duration - elapsed);
      const answered = s.answers ? Object.keys(s.answers).length : 0;
      const sid = s._id.toString();
      const viols = violBySession[sid] || [];
      const lastViol = viols[0] || null;
      return {
        session_id:    sid,
        student_name:  s.student_id?.name || 'Unknown',
        matric:        s.student_id?.matric || '-',
        exam_title:    s.exam_id?.title || '-',
        started_at:    s.started_at,
        elapsed_min:   elapsed,
        remaining_min: remaining,
        violations:    s.violations || 0,
        answered,
        recent_violations: viols.slice(0, 5), // last 5 for tooltip/detail
        last_violation: lastViol
      };
    });
    res.json({ success: true, sessions: data, count: data.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== FEATURE: CONCURRENT SESSION DETECTION (Feature #8)
// GET /api/admin/concurrent-logins — recent multi-IP logins
// ===========================
app.get('/api/admin/concurrent-logins', async (req, res) => {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000); // last hour
    const logs = await LoginAudit.find({ created_at: { $gte: since } })
      .populate('student_id', 'name matric')
      .sort({ created_at: -1 });

    // Group by student, find those with multiple IPs
    const byStudent = {};
    logs.forEach(l => {
      const sid = l.student_id?._id?.toString();
      if (!sid) return;
      if (!byStudent[sid]) byStudent[sid] = { name: l.student_id.name, matric: l.student_id.matric, ips: new Set(), logins: [] };
      byStudent[sid].ips.add(l.ip);
      byStudent[sid].logins.push({ ip: l.ip, user_agent: l.user_agent, created_at: l.created_at });
    });
    const suspicious = Object.entries(byStudent)
      .filter(([,v]) => v.ips.size > 1)
      .map(([id, v]) => ({ student_id: id, name: v.name, matric: v.matric, ip_count: v.ips.size, ips: [...v.ips], logins: v.logins.slice(0,5) }));
    res.json({ success: true, suspicious, total_logins: logs.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== FEATURE: BULK EXAM ACTIONS (Feature #14)
// POST /api/admin/exams/bulk — delete, publish, or export multiple exams
// ===========================
app.post('/api/admin/exams/bulk', async (req, res) => {
  try {
    const { action, exam_ids } = req.body;
    if (!Array.isArray(exam_ids) || !exam_ids.length)
      return res.json({ success: false, message: 'No exam IDs provided' });
    const oids = exam_ids.map(id => toOID(id)).filter(Boolean);

    if (action === 'delete') {
      await Exam.deleteMany({ _id: { $in: oids } });
      await Question.deleteMany({ exam_id: { $in: oids } });
      await ExamSession.deleteMany({ exam_id: { $in: oids } });
      await ExamResult.deleteMany({ exam_id: { $in: oids } });
      return res.json({ success: true, message: `${oids.length} exam(s) deleted.` });
    }

    if (action === 'export_results') {
      const results = await ExamResult.find({ exam_id: { $in: oids } })
        .populate('student_id', 'name matric')
        .populate('exam_id', 'title');
      const rows = [['Student Name','Matric','Exam','Score','Total','Percentage','Time Taken (s)','Date']];
      results.forEach(r => {
        rows.push([
          r.student_id?.name || '', r.student_id?.matric || '',
          r.exam_id?.title || '', r.correct, r.total, r.percentage,
          r.time_taken || 0, new Date(r.submitted_at).toISOString()
        ]);
      });
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="exam-results.csv"');
      return res.send(csv);
    }

    if (action === 'clone') {
      let cloned = 0;
      for (const oid of oids) {
        const exam = await Exam.findById(oid);
        if (!exam) continue;
        const questions = await Question.find({ exam_id: oid });
        const newCode = exam.access_code + '_COPY_' + Date.now().toString(36).toUpperCase();
        const newExam = await Exam.create({ ...exam.toObject(), _id: undefined, access_code: newCode, title: exam.title + ' (Copy)', created_at: new Date() });
        if (questions.length) {
          await Question.insertMany(questions.map(q => ({ ...q.toObject(), _id: undefined, exam_id: newExam._id, created_at: new Date() })));
        }
        cloned++;
      }
      return res.json({ success: true, message: `${cloned} exam(s) cloned.` });
    }

    res.json({ success: false, message: 'Unknown action' });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== FEATURE: QUESTION IMPORT FROM WORD/PDF TEXT (Feature #15)
// POST /api/admin/upload-questions-docx — parse flexible text format
// Supports: "Q: ...\nA: ...\nB: ...\nC: ...\nD: ...\nAnswer: B"
// ===========================
app.post('/api/admin/upload-questions-text', upload.single('file'), async (req, res) => {
  try {
    const { exam_id } = req.body;
    if (!req.file) return res.json({ success: false, message: 'No file uploaded.' });
    const examOID = toOID(exam_id);
    if (!examOID) return res.json({ success: false, message: 'Invalid exam ID.' });

    const content = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path);

    // Parse flexible Q&A blocks — supports both numbered (1. Q:) and plain (Q:) formats
    const blocks = content.split(/\n(?=\s*(?:\d+[\.\)]\s*)?Q:|Question:)/i).map(b => b.trim()).filter(Boolean);
    let inserted = 0, errors = [];

    for (const block of blocks) {
      try {
        const getField = (keys) => {
          for (const k of keys) {
            const m = block.match(new RegExp(`(?:^|\\n)\\s*${k}\\s*:?\\s*(.+)`, 'i'));
            if (m) return m[1].trim();
          }
          return null;
        };
        const question = getField(['Q', 'Question', '\\d+[\\.)\\s]+Q', '\\d+[\\.)\\s]+Question']);
        const optA     = getField(['A', 'a\\)', 'Option A', 'OptionA']);
        const optB     = getField(['B', 'b\\)', 'Option B', 'OptionB']);
        const optC     = getField(['C', 'c\\)', 'Option C', 'OptionC']);
        const optD     = getField(['D', 'd\\)', 'Option D', 'OptionD']);
        const ansRaw   = getField(['Answer', 'Ans', 'Correct', 'Key']);
        const answer   = ansRaw ? ansRaw.trim().toUpperCase().charAt(0) : null;

        const isTF = (!optC && !optD) ||
          (optA && optA.toLowerCase() === 'true' && optB && optB.toLowerCase() === 'false' && !optC && !optD);
        if (!question || !optA || !optB || (!isTF && (!optC || !optD)) || !['A','B','C','D'].includes(answer)) {
          errors.push(`Skipped block (missing fields): "${block.substring(0,60)}..."`);
          continue;
        }
        await Question.create({
          exam_id: examOID, question,
          question_type: isTF ? 'true_false' : 'multiple_choice',
          optionA: optA, optionB: optB,
          optionC: isTF ? '' : optC,
          optionD: isTF ? '' : optD,
          answer
        });
        inserted++;
      } catch(e) { errors.push(e.message); }
    }
    res.json({ success: true, inserted, skipped: blocks.length - inserted, errors: errors.slice(0,5) });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== FEATURE: EMAIL NOTIFICATIONS (Feature #16)
// POST /api/admin/notify/exam — email students about a new exam
// POST /api/admin/notify/results — email students their results
// GET  /api/admin/email-settings — check email configuration status
// ===========================
app.get('/api/admin/email-settings', async (req, res) => {
  const configured = !!process.env.RESEND_API_KEY;
  res.json({ configured, provider: 'Resend', from: process.env.RESEND_FROM || 'onboarding@resend.dev' });
});

app.post('/api/admin/notify/exam', async (req, res) => {
  try {
    const { exam_id, custom_message } = req.body;
    const exam = await Exam.findById(toOID(exam_id)).populate('course_id').populate('department_id').populate('level_id');
    if (!exam) return res.json({ success: false, message: 'Exam not found' });

    const filter = {};
    if (exam.department_id) filter.department_id = exam.department_id._id;
    if (exam.level_id)      filter.level_id      = exam.level_id._id;
    const students = await Student.find({ ...filter, email: { $ne: null, $ne: '' } });
    if (!students.length) return res.json({ success: false, message: 'No students with email addresses found for this exam\'s department/level.' });

    const scheduleLine = exam.start_date
      ? `<tr><td style="padding:6px 0;color:#64748b;">Opens</td><td style="padding:6px 0;font-weight:600;">${new Date(exam.start_date).toLocaleString('en-NG', { timeZone:'Africa/Lagos' })}</td></tr>`
      : '';
    const closeLine = exam.end_date
      ? `<tr><td style="padding:6px 0;color:#64748b;">Closes</td><td style="padding:6px 0;font-weight:600;">${new Date(exam.end_date).toLocaleString('en-NG', { timeZone:'Africa/Lagos' })}</td></tr>`
      : '';

    let sent = 0;
    for (const student of students) {
      const ok = await sendMail({
        to: student.email,
        subject: `New Exam Available: ${exam.title} — MARGMOCOTH CBT`,
        html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
          <div style="background:#0f6b30;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
            <h2 style="margin:0;font-size:20px;">New Exam Available</h2>
          </div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
            <p>Dear <strong>${student.name}</strong>,</p>
            <p>A new exam has been scheduled for you on the MARGMOCOTH CBT portal.</p>
            <table style="width:100%;margin:16px 0;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#64748b;">Exam</td><td style="padding:6px 0;font-weight:700;">${exam.title}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Course</td><td style="padding:6px 0;">${exam.course_id?.name || '-'}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Duration</td><td style="padding:6px 0;">${exam.duration} minutes</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Access Code</td><td style="padding:6px 0;font-weight:700;letter-spacing:2px;color:#0f6b30;">${exam.access_code}</td></tr>
              ${scheduleLine}${closeLine}
            </table>
            ${custom_message ? `<div style="background:#f8fafc;border-radius:8px;padding:14px;margin-top:12px;font-size:13px;color:#374151;">${custom_message}</div>` : ''}
            <p style="margin-top:20px;"><a href="https://localhost" style="background:#0f6b30;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Go to Exam Portal →</a></p>
            <p style="color:#94a3b8;font-size:11px;margin-top:24px;">MARGMOCOTH CBT</p>
          </div>
        </div>`
      });
      if (ok) sent++;
    }
    res.json({ success: true, message: `Notification sent to ${sent} of ${students.length} students.`, sent, total: students.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/notify/results', async (req, res) => {
  try {
    const { exam_id } = req.body;
    const results = await ExamResult.find({ exam_id: toOID(exam_id) })
      .populate('student_id', 'name matric email')
      .populate('exam_id', 'title');
    const withEmail = results.filter(r => r.student_id?.email);
    if (!withEmail.length) return res.json({ success: false, message: 'No results found with student emails.' });
    let sent = 0;
    for (const r of withEmail) {
      const grade = r.percentage >= 70 ? 'A' : r.percentage >= 60 ? 'B' : r.percentage >= 50 ? 'C' : r.percentage >= 45 ? 'D' : 'F';
      const ok = await sendMail({
        to: r.student_id.email,
        subject: `Your Result: ${r.exam_id?.title || 'Exam'} — MARGMOCOTH CBT`,
        html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
          <h2 style="color:#0f6b30;">Your Exam Result</h2>
          <p>Dear <strong>${r.student_id.name}</strong>,</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0;">
            <tr><td style="padding:8px;border:1px solid #e2e8f0;">Exam</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${r.exam_id?.title}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;">Score</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${r.correct}/${r.total}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;">Percentage</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${r.percentage}%</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;">Grade</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:700;">${grade}</td></tr>
          </table>
          <p style="color:#64748b;font-size:12px;">MARGMOCOTH i-CBT System</p>
        </div>`
      });
      if (ok) sent++;
    }
    res.json({ success: true, sent, total: withEmail.length });
  } catch(e) { res.json({ success: false, message: e.message }); }
});


// ===========================
// ===== MARGMOCOTH SUPPORT CHAT ====
// ===========================

// ---------- Shared AI helpers ----------
// groqChat() returns the reply text, or null if no key / Groq failed. It never throws,
// so every assistant can fall back to the built-in answers below and stay usable.
async function groqChat(messages, { max_tokens = 400, temperature = 0.4, label = 'ai' } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  if (typeof fetch === 'undefined') { console.warn(`[${label}] fetch() missing — Node 18+ required for AI.`); return null; }
  const models = [process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  for (const model of models) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model, max_tokens, temperature, messages }),
        signal: ctrl.signal
      });
      if (!r.ok) {
        const t = await r.text();
        console.warn(`[${label}] Groq ${r.status} on ${model}: ${t.slice(0, 200)}`);
        if (r.status === 401) return null;          // bad key — no point trying another model
        continue;                                   // rate limit / model problem — try next model
      }
      const d = await r.json();
      const txt = d?.choices?.[0]?.message?.content?.trim();
      if (txt) return txt;
    } catch(e) {
      console.warn(`[${label}] Groq call failed on ${model}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    } finally { clearTimeout(timer); }
  }
  return null;
}

const OFFICE_EMAIL = process.env.ADMIN_EMAIL || 'Margmocoth.examinationsmedia@gmail.com';

// Built-in answers for the LOGIN page assistant (used when AI is unavailable).
function loginHelpFallback(text) {
  const t = String(text || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  if (has('forgot', 'forget', 'reset', "don't know my password", 'dont know my password', 'lost password', 'lost my password'))
    return `No problem. Tap "Forgot password?" under the Sign In button, enter your name, matric number or email, and the examination office will reset it for you. You can also email ${OFFICE_EMAIL}.`;
  if (has('incorrect password', 'wrong password', 'password is wrong', 'password not', 'password does not', "password doesn't", 'password error'))
    return `"Incorrect password" means the password does not match that account. Check Caps Lock, use the eye icon to view what you typed, and use the password you created when you registered (or the one the exam office gave you). Still stuck? Tap "Forgot password?" to ask the office for a reset.`;
  if (has('not found', 'no account', "can't find", 'cant find', 'not registered', 'no student'))
    return `"No account found" means that name, matric number or email is not on the system. Try your matric number or the email you registered with, and check spelling. If you have not registered, use "Create an account" (when registration is open) or contact the examination office: ${OFFICE_EMAIL}.`;
  if (has('matric'))
    return `You can sign in with your matric number exactly as the college issued it (capital or small letters both work), plus your password. If it is rejected, try your email or full name instead, or contact the examination office.`;
  if (has('email'))
    return `If you added an email when you registered, you can sign in with that email and your password. If you did not add one, use your matric number or full name instead.`;
  if (has('more than one', 'same name', 'duplicate'))
    return `When two students share a name, the system asks you to sign in with your matric number or email instead. Use one of those with your password.`;
  if (has('too many', 'blocked', 'wait 10', 'locked'))
    return `For security, sign-in pauses for 10 minutes after several wrong attempts. Wait a little, then try again carefully, or tap "Forgot password?" to request a reset.`;
  if (has('maintenance', 'closed', 'portal'))
    return `When the portal is under maintenance, sign-in is switched off temporarily. Your records are safe. Please check back later or ask your department administrator.`;
  if (has('register', 'sign up', 'signup', 'create account', 'new student'))
    return `If registration is open you will see a "Create an account" link on this page. You will need your full name, matric number, level, department, a phone number or email, and a password. If you do not see it, ask the examination office for your department's registration link.`;
  if (has('hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'))
    return `Hello! I can help with sign-in problems. Tell me what you see when you try to log in, for example "incorrect password" or "no account found".`;
  return `You can sign in with your full name, matric number or email, plus your password. If it still fails, tap "Forgot password?" or contact the examination office: ${OFFICE_EMAIL}. Tell me the exact error message and I will explain it.`;
}

// Built-in answers for the student DASHBOARD assistant (used when AI is unavailable).
function supportFallback(text, student, exams, results) {
  const first = (student?.name || '').split(' ')[0] || 'there';
  const t = String(text || '').toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  const admin = ' Please contact Admin directly for further assistance.';
  if (has('upcoming', 'exam', 'schedule', 'timetable', 'when is', 'test')) {
    if (!exams.length) return `Hi ${first}! I can't see any upcoming exam for your level and department right now. Check your dashboard again later.`;
    const list = exams.map(e => {
      const d = e.start_date ? new Date(e.start_date).toDateString() : 'date not set';
      return `• ${e.title}${e.course_id?.name ? ' (' + e.course_id.name + ')' : ''} — ${d}, ${e.duration} min`;
    }).join('\n');
    return `Hi ${first}! Here are your upcoming exams:\n${list}\n\nYour lecturer gives you the access code on the day. Enter it on your dashboard, then tap Start Exam.`;
  }
  if (has('result', 'score', 'grade', 'mark', 'passed', 'failed')) {
    if (!results.length) return `Hi ${first}! You have no exam results yet. Results appear once you submit an exam and the college releases them.`;
    const list = results.map(r => `• ${r.exam_id?.title || 'Exam'}: ${r.correct}/${r.total} (${Number(r.percentage || 0).toFixed(1)}%)`).join('\n');
    return `Hi ${first}! Your recent results:\n${list}\n\nSome results may be hidden until the college releases them.`;
  }
  if (has('password'))
    return `Hi ${first}! To change your password, open your Profile and use Change Password. If you forgot it, log out, tap "Forgot password?" on the login page and the examination office will reset it for you.`;
  if (has('face', 'camera', 'capture', 'photo', 'webcam'))
    return `Hi ${first}! For face capture, go to Dashboard > Face Capture, allow camera access, and take clear photos in good light facing the camera.`;
  if (has('name', 'matric') && has('change', 'wrong', 'correct', 'edit', 'update'))
    return `Hi ${first}! To correct your name or matric number, go to Dashboard > Request Name/Matric Change, fill the form and wait for admin approval.`;
  if (has('access code', 'code', 'start'))
    return `Hi ${first}! Enter the access code from your lecturer on your dashboard, then tap Start Exam. If the code is rejected, confirm it with your lecturer and check the exam is for your level and department.`;
  if (has('network', 'internet', 'disconnect', 'offline', 'data'))
    return `Hi ${first}! If your internet drops during an exam, reconnect and continue — your answers are saved as you go and the drop is recorded as a network issue, not cheating. Tell your lecturer if it keeps happening.`;
  if (has('retake', 'resit', 'again'))
    return `Hi ${first}! If you need a retake, send a retake request from your dashboard (when the exam allows it). An admin will approve or decline it.`;
  if (has('hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'))
    return `Hello ${first}! I'm MARGMOCOTH Support. Ask me about your exams, results, access codes, password or face capture.`;
  return `Hi ${first}! I can help with your exam schedule, results, access codes, password and face capture. For anything else about your account, use Complaints on your dashboard.${admin}`;
}

const MARGMOCOTH_SUPPORT_SYSTEM = `You are MARGMOCOTH Support, the official AI assistant for the MARGMOCOTH CBT Student Portal at Margaret Mosunmola College of Health Science and Technology, Owo, Ondo State, Nigeria.

You have access to the student's account data provided below. Use it to give precise, personal answers.

WHAT YOU CAN HELP WITH:
- Their exam schedule: upcoming exams, dates and duration
- Their past results and scores
- Face capture: go to Dashboard > Face Capture, allow camera, take 3 clear photos in good light
- Name/matric change: go to Dashboard > Request Name/Matric Change, fill the form, wait for admin approval
- Password: Profile > Change Password. If forgotten, log out and use "Forgot password?" on the login page so the examination office can reset it
- Signing in: students sign in with their full name, matric number or email, plus their password
- How to start an exam: enter the access code from the lecturer on the Dashboard, then click Start Exam
- General study questions (English, Math, Science, health science) — answer them helpfully

RULES:
1. Always address the student by their first name.
2. Use the student data provided to give specific answers (e.g. actual exam names, scores, dates).
3. Be warm, friendly, and concise — max 150 words unless a detailed answer is needed.
4. For account issues you cannot fix (blocked account, data errors, department mismatch), end with: "Please contact Admin directly for further assistance."
5. NEVER reveal or guess exam access codes — only the lecturer gives them on exam day.
6. NEVER help anyone cheat in an exam or answer live exam questions.
7. Respond in clear simple English suitable for Nigerian students.`;

// POST /api/support/send — student sends a message, AI replies, both saved
app.post('/api/support/send', async (req, res) => {
  try {
    const { student_id, message } = req.body;
    if (!student_id || !message?.trim()) return res.json({ success: false, message: 'student_id and message required.' });

    const student = await Student.findById(toOID(student_id)).populate('department_id').populate('level_id');
    if (!student) return res.json({ success: false, message: 'Student not found.' });

    // Fetch rich student data for AI context
    const now = new Date();

    // Upcoming exams for student's dept/level
    const upcomingExams = await Exam.find({
      department_id: student.department_id?._id,
      level_id: student.level_id?._id,
      $or: [{ end_date: { $gte: now } }, { end_date: null }]
    }).populate('course_id').populate('semester_id').sort({ start_date: 1 }).limit(5);

    // Recent results
    const recentResults = await ExamResult.find({ student_id: toOID(student_id) })
      .populate({ path: 'exam_id', populate: { path: 'course_id' } })
      .sort({ submitted_at: -1 }).limit(5);

    // Face capture status
    const hasFaceCapture = await FaceCapture.exists({ student_id: toOID(student_id) });

    // Build context string
    const examList = upcomingExams.length
      ? upcomingExams.map(e => {
          const dateStr = e.start_date ? new Date(e.start_date).toDateString() : 'No date set';
          return `• ${e.title}${e.course_id?.name ? ' (' + e.course_id.name + ')' : ''} — ${dateStr}, ${e.duration}min`;
        }).join('\n')
      : 'No upcoming exams found.';

    const resultList = recentResults.length
      ? recentResults.map(r => `• ${r.exam_id?.title || 'Exam'}: ${r.correct}/${r.total} correct (${r.percentage?.toFixed(1)}%) — ${new Date(r.submitted_at).toDateString()}`).join('\n')
      : 'No results yet.';

    const studentContext = `
STUDENT ACCOUNT DATA:
- Name: ${student.name}
- Level: ${student.level_id?.name || 'N/A'}
- Department: ${student.department_id?.name || 'N/A'}
- Phone: ${student.phone || 'N/A'}
- Face Capture: ${hasFaceCapture ? 'Done' : 'Not done'}

UPCOMING EXAMS:
${examList}

RECENT RESULTS:
${resultList}`;

    // Load or create conversation
    let conv = await SupportConversation.findOne({ student_id: toOID(student_id) });
    if (!conv) conv = new SupportConversation({ student_id: toOID(student_id), messages: [] });

    // Save student message
    const studentMsg = { role: 'student', content: message.trim(), is_ai: false, created_at: new Date() };
    conv.messages.push(studentMsg);

    // Build Groq messages (last 10 for context)
    const history = conv.messages.slice(-10).map(m => ({
      role:    m.role === 'student' ? 'user' : 'assistant',
      content: m.content
    }));

    const systemWithCtx = MARGMOCOTH_SUPPORT_SYSTEM + studentContext;

    let aiReply = await groqChat(
      [{ role: 'system', content: systemWithCtx }, ...history],
      { max_tokens: 400, temperature: 0.5, label: 'support' }
    );
    // No API key / Groq unavailable → built-in answers so the chat still works
    if (!aiReply) aiReply = supportFallback(message, student, upcomingExams, recentResults);

    // Save AI reply
    const supportMsg = { role: 'support', content: aiReply, is_ai: true, created_at: new Date() };
    conv.messages.push(supportMsg);
    conv.admin_unread = true;
    conv.updated_at   = new Date();
    await conv.save();

    res.json({ success: true, reply: aiReply, created_at: supportMsg.created_at });
  } catch(e) { console.error(e); res.json({ success: false, message: e.message }); }
});

// GET /api/support/history — student's full conversation history
app.get('/api/support/history', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json([]);
    const conv = await SupportConversation.findOne({ student_id: toOID(student_id) });
    if (!conv) return res.json([]);
    res.json(conv.messages.map(m => ({
      role: m.role, content: m.content, is_ai: m.is_ai,
      created_at: m.created_at
    })));
  } catch(e) { res.json([]); }
});

// GET /api/admin/support/conversations — admin: list all conversations
app.get('/api/admin/support/conversations', adminAuth, async (req, res) => {
  try {
    const convs = await SupportConversation.find()
      .populate('student_id', 'name matric department_id level_id')
      .sort({ updated_at: -1 })
      .limit(200);
    res.json(convs.map(c => {
      const last = c.messages[c.messages.length - 1];
      return {
        id:            c._id.toString(),
        student_id:    c.student_id?._id?.toString(),
        student_name:  c.student_id?.name || '—',
        student_matric:c.student_id?.matric || '—',
        last_message:  last?.content?.slice(0, 80) || '',
        last_role:     last?.role || '',
        admin_unread:  c.admin_unread,
        message_count: c.messages.length,
        updated_at:    c.updated_at
      };
    }));
  } catch(e) { res.json([]); }
});

// GET /api/admin/support/conversation/:student_id — admin: full chat for one student
app.get('/api/admin/support/conversation/:student_id', adminAuth, async (req, res) => {
  try {
    const conv = await SupportConversation.findOne({ student_id: toOID(req.params.student_id) })
      .populate('student_id', 'name matric');
    if (!conv) return res.json({ messages: [] });
    // Mark as read
    if (conv.admin_unread) { conv.admin_unread = false; await conv.save(); }
    res.json({
      student_name:  conv.student_id?.name || '—',
      student_matric:conv.student_id?.matric || '—',
      messages: conv.messages.map(m => ({
        role: m.role, content: m.content, is_ai: m.is_ai, created_at: m.created_at
      }))
    });
  } catch(e) { res.json({ messages: [] }); }
});

// POST /api/admin/support/reply — admin manually replies in a conversation
app.post('/api/admin/support/reply', adminAuth, async (req, res) => {
  try {
    const { student_id, message } = req.body;
    if (!student_id || !message?.trim()) return res.json({ success: false });
    let conv = await SupportConversation.findOne({ student_id: toOID(student_id) });
    if (!conv) conv = new SupportConversation({ student_id: toOID(student_id), messages: [] });
    conv.messages.push({ role: 'admin', content: message.trim(), is_ai: false, created_at: new Date() });
    conv.updated_at = new Date();
    await conv.save();
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== AI ASSISTANT PROXY ==
// ===========================
// Proxies Groq requests server-side so the API key never leaves the server.
app.post('/api/ai-assistant', async (req, res) => {
  try {
    const GROQ_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_KEY) return res.json({ error: 'AI is not configured: add GROQ_API_KEY to the server environment (.env) and restart.' });

    // fetch() requires Node 18+. Verify it is available.
    if (typeof fetch === 'undefined') {
      return res.status(500).json({ error: 'fetch is not available. Please upgrade to Node.js 18 or later.' });
    }

    const { messages, model } = req.body;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model:       model || 'llama-3.3-70b-versatile',
        max_tokens:  1024,
        temperature: 0.2,
        messages
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ===========================
// ===== LOGIN ASSISTANT =====
// ===========================

// Helper: persist the latest user+assistant exchange to LoginConversation
async function saveLoginConv(session_key, msgs, assistantReply) {
  if (!session_key) return;
  try {
    let conv = await LoginConversation.findOne({ session_key });
    if (!conv) conv = new LoginConversation({ session_key, messages: [] });
    // Append only the last user message (last item in msgs) + the new assistant reply
    const lastUser = msgs[msgs.length - 1];
    if (lastUser && lastUser.role === 'user') {
      conv.messages.push({ role: 'user',      content: lastUser.content });
    }
    conv.messages.push({ role: 'assistant', content: assistantReply });
    conv.updated_at = new Date();
    await conv.save();
  } catch(e) {
    console.error('saveLoginConv error:', e.message);
  }
}

// Admin: list all login conversations
app.get('/api/admin/login-conversations', adminAuth, async (req, res) => {
  try {
    const convs = await LoginConversation.find()
      .sort({ updated_at: -1 })
      .lean();
    res.json(convs);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Admin: get one login conversation
app.get('/api/admin/login-conversations/:session_key', adminAuth, async (req, res) => {
  try {
    const conv = await LoginConversation.findOne({ session_key: req.params.session_key }).lean();
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json(conv);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Public endpoint — no auth needed (it's on the login page)
app.post('/api/login-assistant', async (req, res) => {
  try {
    const { messages, session_key } = req.body || {};
    const msgs = (Array.isArray(messages) ? messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 600) }))
      .slice(-10);
    if (!msgs.length || msgs[msgs.length - 1].role !== 'user')
      return res.json({ reply: 'Please type your question and I will help.' });
    const lastUser = msgs[msgs.length - 1].content;

    const systemPrompt = `You are MARGMOCOTH Support, a warm and concise assistant on the student login page of MARGMOCOTH CBT (Margaret Mosunmola College of Health Science and Technology, Owo).

Your ONLY job: help students who cannot sign in. You CANNOT change accounts or passwords — only the examination office can.

How sign-in works:
- A student signs in with ONE of: full name, matric number, or email — plus their password.
- Matric numbers and emails are not case-sensitive.
- If two students share a name, the system asks for matric number or email instead.
- After several wrong attempts, sign-in pauses for 10 minutes.
- Forgot password: tap "Forgot password?" under the Sign In button, enter name/matric/email, and the examination office resets it. Or email ${OFFICE_EMAIL}.
- New students: use "Create an account" if registration is open (needs full name, matric number, level, department, phone or email, password).

Error messages:
• "No account found with that name, matric number or email." → not registered or typed differently. Try matric or email.
• "Incorrect password. Please try again." → wrong password. Check Caps Lock, use the eye icon. Never suggest a default password.
• "More than one student has that name…" → use matric number or email.
• "Too many failed attempts…" → wait 10 minutes or request a reset.

Account check: if the student gives you a name, matric or email and asks whether they are registered, output ONLY this token on its own line and nothing else:
[LOOKUP: the value they gave]
The system will return a result; then answer naturally. The result never includes the matric number or password — never ask for or reveal them.

Rules: be warm and brief (short sentences). NEVER ask for a password. NEVER invent a password or matric. Login help only — politely decline other topics.`;

    let reply = await groqChat([{ role: 'system', content: systemPrompt }, ...msgs],
                               { max_tokens: 350, temperature: 0.2, label: 'login-assistant' });

    // Transparent account-existence check (reveals no matric / password)
    const lookupMatch = reply && reply.match(/\[LOOKUP:\s*(.+?)\]/i);
    if (lookupMatch) {
      const found = await findStudentsByIdentifier(lookupMatch[1]);
      let dbResult;
      if (!found.length) {
        dbResult = 'No account exists with that name, matric number or email.';
      } else if (found.length > 1) {
        dbResult = 'More than one account matches that name. The student must sign in with their matric number or email.';
      } else {
        const st = found[0];
        const maskedEmail = st.email ? st.email.replace(/^(.).*(@.*)$/, '$1***$2') : null;
        dbResult = `An account exists for ${st.name} (${st.level_id?.name || 'level unknown'}, ${st.department_id?.name || 'department unknown'}). ` +
          `Matric number on file: ${st.matric ? 'yes' : 'no'}. Email on file: ${maskedEmail ? 'yes (' + maskedEmail + ')' : 'no'}.`;
      }
      const follow = await groqChat(
        [{ role: 'system', content: systemPrompt }, ...msgs,
         { role: 'assistant', content: reply },
         { role: 'user', content: '[SYSTEM LOOKUP RESULT]: ' + dbResult }],
        { max_tokens: 300, temperature: 0.2, label: 'login-assistant' });
      reply = follow || (dbResult + ' Use your password to sign in, or tap "Forgot password?" if you cannot remember it.');
    }

    // No key / Groq failure → built-in answers (and a direct check if they pasted an email)
    if (!reply) {
      reply = loginHelpFallback(lastUser);
      const emailInMsg = lastUser.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
      if (emailInMsg) {
        const found = await findStudentsByIdentifier(emailInMsg[0]);
        reply = found.length
          ? 'Yes, an account exists with that email. Sign in with that email and your password, or tap "Forgot password?" if you cannot remember it.'
          : 'No account exists with that email. Try your matric number or full name, or register if registration is open.';
      }
    }

    await saveLoginConv(session_key, msgs, reply);
    res.json({ reply });
  } catch(e) {
    console.error('login-assistant error:', e.message);
    res.json({ reply: loginHelpFallback('') });
  }
});


// ===========================
// ===== STUDENT PROFILE =====
// ===========================

app.get('/api/student/profile', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json({ success: false, message: 'student_id required.' });
    const s = await Student.findById(toOID(student_id))
      .populate('department_id').populate('level_id');
    if (!s) return res.json({ success: false, message: 'Student not found.' });
    res.json({
      success: true,
      student: {
        id:                s._id.toString(),
        name:              s.name,
        matric:            s.matric,
        department:        s.department_id?.name || null,
        department_id:     s.department_id?._id?.toString() || null,
        sub_department:    s.sub_department || null,
        sub_departments_available: s.department_id?.sub_departments || [],
        action_needed:     (s.department_id?.sub_departments?.length > 0) && !s.sub_department,
        level:             s.level_id?.name      || null,
        phone:             s.phone               || null,
        email:             s.email               || null,
        last_login:        s.last_login          || null,
        profile_photo_url: s.profile_photo_url   || null,
        capture_locked:    s.capture_locked       || false,
        created_at:        s.created_at
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/student/capture-status — returns whether capture is enabled globally and if this student is already locked
app.get('/api/student/capture-status', async (req, res) => {
  try {
    const { student_id } = req.query;
    const enabled = await getSetting('student_capture_enabled', false);
    const face_verify_required = await getSetting('face_verify_required', false);
    if (!student_id) return res.json({ enabled, locked: false, has_photo: false, face_verify_required });
    const s = await Student.findById(toOID(student_id));
    if (!s) return res.json({ enabled, locked: false, has_photo: false, face_verify_required });
    res.json({
      enabled,
      locked:              s.capture_locked    || false,
      has_photo:           !!s.profile_photo_url,
      photo_url:           s.profile_photo_url || null,
      face_verify_required
    });
  } catch(e) { res.json({ enabled: false, locked: false, has_photo: false, face_verify_required: false }); }
});

// POST /api/student/upload-profile-photo — upload face photo; locks after first upload
app.post('/api/student/upload-profile-photo', async (req, res) => {
  try {
    const { student_id, photo_data } = req.body;
    if (!student_id || !photo_data) return res.json({ success: false, message: 'student_id and photo_data required.' });
    const s = await Student.findById(toOID(student_id));
    if (!s) return res.json({ success: false, message: 'Student not found.' });

    // Check if capture is globally enabled
    const captureEnabled = await getSetting('student_capture_enabled', false);
    if (!captureEnabled) return res.json({ success: false, message: 'Face capture is currently disabled by admin.' });

    // Check if student already locked (already captured once)
    if (s.capture_locked) return res.json({ success: false, message: 'You have already captured your face photo. Contact admin to reset.' });

    // Delete old photo from Cloudinary if exists
    if (s.profile_photo_public_id) {
      await cloudinary.uploader.destroy(s.profile_photo_public_id).catch(() => {});
    }
    const result = await cloudinary.uploader.upload(photo_data, {
      folder: 'student_profiles',
      public_id: `student_${student_id}`,
      overwrite: true,
      resource_type: 'image',
      // Auto-enhance brightness/contrast and standardise size on upload.
      // This significantly improves face-api.js detection on dark passport photos
      // (common with African skin tones in poor lighting conditions).
      transformation: [
        { width: 600, height: 600, crop: 'fill', gravity: 'face', quality: 'auto:best' },
        { effect: 'auto_brightness' },
        { effect: 'improve:indoor' }
      ]
    });
    // Save photo + lock capture permanently
    await Student.findByIdAndUpdate(toOID(student_id), {
      profile_photo_url:       result.secure_url,
      profile_photo_public_id: result.public_id,
      capture_locked:          true
    });
    res.json({ success: true, url: result.secure_url });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/student/profile-photo/:student_id — returns the reference photo URL (JSON)
app.get('/api/student/profile-photo/:student_id', async (req, res) => {
  try {
    const s = await Student.findById(toOID(req.params.student_id));
    if (!s) return res.json({ success: false });
    res.json({ success: true, url: s.profile_photo_url || null });
  } catch(e) { res.json({ success: false }); }
});

// GET /api/student/profile-photo-proxy/:student_id
// Fetches the Cloudinary image SERVER-SIDE and pipes it to the client.
// This completely eliminates CORS issues — the browser only ever talks to
// the portal domain (same origin), never directly to Cloudinary.
app.get('/api/student/profile-photo-proxy/:student_id', async (req, res) => {
  try {
    const s = await Student.findById(toOID(req.params.student_id));
    if (!s || !s.profile_photo_url) {
      return res.status(404).json({ success: false, message: 'No profile photo found' });
    }
    const photoUrl = s.profile_photo_url;

    // Pipe the Cloudinary image through this server
    https.get(photoUrl, (imgRes) => {
      if (imgRes.statusCode !== 200) {
        return res.status(502).json({ success: false, message: 'Could not fetch photo from storage' });
      }
      const contentType = imgRes.headers['content-type'] || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300'); // cache 5 min on client
      res.setHeader('Access-Control-Allow-Origin', '*');
      imgRes.pipe(res);
    }).on('error', (err) => {
      console.error('profile-photo-proxy fetch error:', err.message);
      res.status(502).json({ success: false, message: 'Photo fetch failed' });
    });
  } catch(e) {
    console.error('profile-photo-proxy error:', e.message);
    res.status(500).json({ success: false });
  }
});

// ── Face verification token store (in-memory, auto-expires) ──────────────────
// Issued by /api/issue-face-token after a successful face match in face-capture.html.
// Consumed once by /api/exam-questions to prove the correct student verified their face.
const FACE_TOKEN_SECRET = process.env.SESSION_SECRET || SESSION_FALLBACK;
const faceTokenStore    = new Map(); // key: "student_id:exam_id" → { token, expires, match_score }

// Purge expired entries every 15 minutes to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of faceTokenStore.entries()) {
    if (now > v.expires) faceTokenStore.delete(k);
  }
}, 15 * 60 * 1000);

// POST /api/issue-face-token — client calls this after a successful face match
app.post('/api/issue-face-token', async (req, res) => {
  try {
    const { student_id, exam_id, match_score } = req.body;
    if (!student_id || !exam_id) return res.json({ success: false, message: 'Missing parameters.' });
    // Verify the student actually has a profile photo before issuing token
    const s = await Student.findById(toOID(student_id));
    if (!s || !s.profile_photo_url) return res.json({ success: false, message: 'No registered face photo.' });
    const expires = Date.now() + 10 * 60 * 1000; // 10-minute window
    const raw     = `${student_id}:${exam_id}:${expires}`;
    const token   = crypto.createHmac('sha256', FACE_TOKEN_SECRET).update(raw).digest('hex');
    faceTokenStore.set(`${student_id}:${exam_id}`, { token, expires, match_score: match_score || 0 });
    res.json({ success: true, token });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/student/reset-capture — admin resets a student's capture lock so they can retake
app.post('/api/admin/student/reset-capture', adminAuth, async (req, res) => {
  try {
    const { student_id } = req.body;
    const s = await Student.findById(toOID(student_id));
    if (!s) return res.json({ success: false, message: 'Student not found.' });
    // Remove old Cloudinary photo
    if (s.profile_photo_public_id) {
      await cloudinary.uploader.destroy(s.profile_photo_public_id).catch(() => {});
    }
    await Student.findByIdAndUpdate(toOID(student_id), {
      profile_photo_url: null, profile_photo_public_id: null, capture_locked: false
    });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/student-profiles — returns all students with their capture status, grouped by dept+level
app.get('/api/admin/student-profiles', adminAuth, async (req, res) => {
  try {
    const students = await Student.find()
      .populate('department_id').populate('level_id')
      .sort({ 'department_id.name': 1, 'level_id.name': 1, name: 1 });
    const data = students.map(s => ({
      id:                s._id.toString(),
      name:              s.name,
      matric:            s.matric,
      department:        s.department_id?.name || 'Unknown',
      level:             s.level_id?.name      || 'Unknown',
      profile_photo_url: s.profile_photo_url   || null,
      capture_locked:    s.capture_locked       || false,
    }));
    res.json(data);
  } catch(e) { res.json([]); }
});

app.post('/api/student/update-contact', async (req, res) => {
  try {
    const { student_id, phone, email } = req.body;
    if (!student_id) return res.json({ success: false, message: 'Missing student_id.' });
    if (!phone && !email) return res.json({ success: false, message: 'Provide at least a phone or email.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.json({ success: false, message: 'Invalid email address.' });
    const update = {};
    if (phone) update.phone = phone.trim();
    if (email) update.email = email.trim().toLowerCase();
    const s = await Student.findByIdAndUpdate(toOID(student_id), { $set: update }, { new: true });
    if (!s) return res.json({ success: false, message: 'Student not found.' });
    res.json({ success: true, message: 'Contact info updated.' });
  } catch (e) {
    console.error('update-contact error:', e);
    res.json({ success: false, message: 'Server error.' });
  }
});

app.post('/api/student/change-password', async (req, res) => {
  try {
    const { student_id, old_password, new_password } = req.body;
    if (!student_id || !old_password || !new_password)
      return res.json({ success: false, message: 'All fields are required.' });
    if (new_password.length < 6)
      return res.json({ success: false, message: 'New password must be at least 6 characters.' });

    const s = await Student.findById(toOID(student_id));
    if (!s) return res.json({ success: false, message: 'Student not found.' });

    // Verify old password — accept own hash OR active dept generated password
    const ownMatch = bcrypt.compareSync(old_password, s.password);
    if (!ownMatch) {
      // Also check dept generated password
      const deptName = (await Student.findById(toOID(student_id)).populate('department_id'))?.department_id?.name || '';
      const genPw = await GeneratedPassword.findOne({
        scope: deptName, is_active: true,
        $or: [{ expires_at: null }, { expires_at: { $gt: new Date() } }]
      }).sort({ created_at: -1 });
      if (!genPw || genPw.plain_password !== old_password)
        return res.json({ success: false, message: 'Current password is incorrect.' });
    }

    await Student.findByIdAndUpdate(toOID(student_id), {
      password: bcrypt.hashSync(new_password, 10)
    });
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== COMPLAINT SCHEMA ====
// ===========================
const ComplaintSchema = new mongoose.Schema({
  student_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  subject:     { type: String, required: true },
  body:        { type: String, required: true },
  status:      { type: String, enum: ['open','in_progress','resolved'], default: 'open' },
  admin_reply: { type: String, default: '' },
  // Thread: array of {role:'admin'|'student', text, created_at}
  thread:      { type: Array, default: [] },
  created_at:  { type: Date, default: Date.now },
  updated_at:  { type: Date, default: Date.now }
});
const Complaint = mongoose.model('Complaint', ComplaintSchema);

// ── Password Reset Request ──────────────────────────────────────────
const PasswordResetSchema = new mongoose.Schema({
  student_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  matric:       { type: String, required: true },
  status:       { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  channel:      { type: String, default: 'email' }, // email, sms, whatsapp, manual
  new_password: { type: String, default: '' },
  admin_note:   { type: String, default: '' },
  created_at:   { type: Date, default: Date.now },
  updated_at:   { type: Date, default: Date.now }
});
const PasswordResetRequest = mongoose.model('PasswordResetRequest', PasswordResetSchema);

// ── Password Contact Request (student asks admin for help) ──────────
const PasswordContactSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  matric:     { type: String, required: true },
  resolved:   { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});
const PasswordContactRequest = mongoose.model('PasswordContactRequest', PasswordContactSchema);

// ── Scheduled Broadcast ─────────────────────────────────────────────
const ScheduledBroadcastSchema = new mongoose.Schema({
  type:       { type: String, enum: ['push','email'], required: true },
  title:      { type: String, default: '' },
  body:       { type: String, required: true },
  target:     { type: String, default: 'All Students' },
  dept_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  level_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Level', default: null },
  send_at:    { type: Date, required: true },
  sent:       { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});
const ScheduledBroadcast = mongoose.model('ScheduledBroadcast', ScheduledBroadcastSchema);

// ── WebAuthn Credential ─────────────────────────────────────────────
const WebAuthnCredentialSchema = new mongoose.Schema({
  student_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  credential_id: { type: String, required: true, unique: true },
  public_key:    { type: String, required: true },
  sign_count:    { type: Number, default: 0 },
  created_at:    { type: Date, default: Date.now }
});
const WebAuthnCredential = mongoose.model('WebAuthnCredential', WebAuthnCredentialSchema);

// ===========================
// ===== COMPLAINTS API ======
// ===========================

// POST /api/student/complaint — raise a complaint
app.post('/api/student/complaint', async (req, res) => {
  try {
    const { student_id, subject, body } = req.body;
    if (!student_id || !subject?.trim() || !body?.trim())
      return res.json({ success: false, message: 'student_id, subject, and body are required.' });
    const c = await Complaint.create({ student_id: toOID(student_id), subject: subject.trim(), body: body.trim() });
    res.json({ success: true, id: c._id });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/student/complaints — student's own complaints
app.get('/api/student/complaints', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json([]);
    const list = await Complaint.find({ student_id: toOID(student_id) }).sort({ created_at: -1 });
    res.json(list.map(c => ({
      id: c._id, subject: c.subject, body: c.body,
      status: c.status, admin_reply: c.admin_reply,
      thread: c.thread || [],
      created_at: c.created_at, updated_at: c.updated_at
    })));
  } catch(e) { res.json([]); }
});

// GET /api/admin/complaints — all complaints (admin)
app.get('/api/admin/complaints', adminAuth, async (req, res) => {
  try {
    const list = await Complaint.find().populate('student_id', 'name matric').sort({ created_at: -1 });
    res.json(list.map(c => ({
      id: c._id,
      student: { name: c.student_id?.name, matric: c.student_id?.matric },
      subject: c.subject, body: c.body,
      status: c.status, admin_reply: c.admin_reply,
      created_at: c.created_at, updated_at: c.updated_at
    })));
  } catch(e) { res.json([]); }
});

// POST /api/admin/complaints/:id/reply — admin replies to a complaint
app.post('/api/admin/complaints/:id/reply', adminAuth, async (req, res) => {
  try {
    const { reply, status } = req.body;
    const c = await Complaint.findById(req.params.id);
    if (!c) return res.json({ success: false, message: 'Complaint not found.' });
    const replyText = reply?.trim() || '';
    const threadEntry = { role: 'admin', text: replyText, created_at: new Date() };
    c.admin_reply = replyText;
    c.status = status || 'in_progress';
    c.thread.push(threadEntry);
    c.updated_at = new Date();
    await c.save();
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== PUSH NOTIFICATIONS ==
// ===========================

async function sendOneSignalNotification({ title, body, student_ids = null, dept_id = null }) {
  const appId  = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_API_KEY;
  if (!appId || !apiKey) return { sent: false, reason: 'OneSignal not configured' };

  let filters = [];
  // Target by external_user_id tags if student_ids provided
  // Otherwise send to all (segment: Subscribed Users)
  const payload = {
    app_id:   appId,
    headings: { en: title },
    contents: { en: body },
    web_url:  (process.env.APP_URL || ('http://localhost:' + PORT)) + '/notifications.html',
  };

  if (student_ids && student_ids.length > 0) {
    payload.include_external_user_ids = student_ids.map(String);
    payload.channel_for_external_user_ids = 'push';
  } else {
    payload.included_segments = ['Subscribed Users'];
  }

  try {
    const r = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    return { sent: true, id: data.id, recipients: data.recipients };
  } catch(e) {
    return { sent: false, reason: e.message };
  }
}

// POST /api/admin/push/broadcast — send push to all or a dept
app.post('/api/admin/push/broadcast', adminAuth, async (req, res) => {
  try {
    const { title, body, dept_id } = req.body;
    if (!title?.trim() || !body?.trim())
      return res.json({ success: false, message: 'title and body are required.' });

    let student_ids = null;
    let target = 'All Students';
    if (dept_id) {
      const students = await Student.find({ department_id: toOID(dept_id) }, { _id: 1 });
      student_ids = students.map(s => s._id.toString());
      const dept = await Department.findById(dept_id).lean();
      if (dept) target = dept.name;
    }

    const result = await sendOneSignalNotification({ title: title.trim(), body: body.trim(), student_ids });
    await BroadcastLog.create({ type: 'push', title: title.trim(), body: body.trim(), target, sent: result.recipients || 0 });
    res.json({ success: result.sent, ...result });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/email/broadcast — email all students or a dept
app.post('/api/admin/email/broadcast', adminAuth, async (req, res) => {
  try {
    const { subject, html_body, dept_id } = req.body;
    if (!subject?.trim() || !html_body?.trim())
      return res.json({ success: false, message: 'subject and html_body are required.' });

    let target = 'All Students';
    const filter = {};
    if (dept_id) {
      filter.department_id = toOID(dept_id);
      const dept = await Department.findById(dept_id).lean();
      if (dept) target = dept.name;
    }
    const students = await Student.find(filter, { email: 1, name: 1 }).lean();
    const eligible = students.filter(s => s.email);

    if (!eligible.length)
      return res.json({ success: true, sent: 0, failed: 0, total: 0, message: 'No students with email addresses found.' });

    const log = await BroadcastLog.create({ type: 'email', title: subject.trim(), body: html_body.trim(), target, total: eligible.length, status: 'sending' });

    res.json({ success: true, queued: true, total: eligible.length, log_id: log._id });

    // Response already sent above — finish sending in the background so the
    // admin isn't stuck waiting on the request for large recipient lists.
    (async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let sent = 0, failed = 0;
      for (const s of eligible) {
        const ok = await sendMail({
          to: s.email,
          subject: subject.trim(),
          html: html_body.replace(/\{name\}/g, s.name || 'Student')
        });
        ok ? sent++ : failed++;
        await sleep(550); // 550ms delay ≈ 1.8 emails/sec, safely under Resend's 2 req/sec limit
      }
      await BroadcastLog.findByIdAndUpdate(log._id, { sent, failed, status: 'completed' });
    })().catch(err => console.error('[Broadcast] background send error:', err.message));
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/broadcast/log — recent broadcasts
app.get('/api/admin/broadcast/log', adminAuth, async (req, res) => {
  try {
    const logs = await BroadcastLog.find().sort({ created_at: -1 }).limit(50).lean();
    res.json(logs);
  } catch(e) { res.json([]); }
});

// GET /api/student/notifications — public push broadcasts visible to students
app.get('/api/student/notifications', async (req, res) => {
  try {
    const logs = await BroadcastLog.find({ type: 'push' })
      .sort({ created_at: -1 }).limit(30).lean();
    res.json(logs.map(l => ({
      id:         l._id.toString(),
      title:      l.title,
      body:       l.body,
      target:     l.target,
      created_at: l.created_at
    })));
  } catch(e) { res.json([]); }
});

// ===========================
// ===== PASSWORD RESET (OTP) =
// ===========================

// In-memory OTP store: { matric: { otp, phone, expires, student_id } }
const _otpStore = new Map();

// Helper: send SMS via Termii
// Helper: post JSON to Termii
function termiiPost(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'v3.api.termii.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Helper: send OTP via SMS
async function sendTermiiSms(to, message) {
  let phone = to.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '234' + phone.slice(1);
  else if (!phone.startsWith('234')) phone = '234' + phone;
  return termiiPost('/api/sms/send', {
    to: phone,
    from: process.env.TERMII_SENDER_ID || 'MARGMOCOTH',
    sms: message,
    type: 'plain',
    channel: 'generic',
    api_key: process.env.TERMII_API_KEY
  });
}

// Helper: send OTP via WhatsApp
async function sendTermiiWhatsApp(to, message) {
  let phone = to.replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '234' + phone.slice(1);
  else if (!phone.startsWith('234')) phone = '234' + phone;
  return termiiPost('/api/sms/send', {
    to: phone,
    from: process.env.TERMII_WHATSAPP_ID || process.env.TERMII_SENDER_ID || 'MARGMOCOTH',
    sms: message,
    type: 'plain',
    channel: 'whatsapp',
    api_key: process.env.TERMII_API_KEY
  });
}

// Helper: send OTP via email (Resend — free tier)
async function sendOtpEmail(to, otp) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#1e40af;padding:24px;text-align:center;">
        <h2 style="color:#fff;margin:0;font-size:20px;">MARGMOCOTH CBT</h2>
        <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Password Reset OTP</p>
      </div>
      <div style="padding:28px 24px;">
        <p style="color:#374151;font-size:14px;margin-bottom:20px;">Use the OTP below to reset your password. It expires in <strong>5 minutes</strong>.</p>
        <div style="background:#f0f4ff;border:2px dashed #1e40af;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;">
          <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#1e40af;">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:12px;">Do not share this code with anyone. If you did not request this, ignore this email.</p>
      </div>
      <div style="background:#f9fafb;padding:12px 24px;text-align:center;font-size:11px;color:#9ca3af;">
        MARGMOCOTH CBT &mdash; Automated message, do not reply.
      </div>
    </div>`;
  return sendMail({
    to,
    subject: 'MARGMOCOTH CBT — Your Password Reset OTP',
    html
  });
}

// Self-service OTP password reset removed. Students who forget their password
// must use the "Request help from admin" option below; an admin sets a new
// password for them directly from the admin panel.
app.post('/api/student/forgot-password/send-otp', async (req, res) => {
  res.json({ success: false, message: 'Self-service OTP reset is not available. Please use "Request help from admin" instead.' });
});
app.post('/api/student/forgot-password/verify-otp', async (req, res) => {
  res.json({ success: false, message: 'Self-service OTP reset is not available. Please use "Request help from admin" instead.' });
});
app.post('/api/student/forgot-password/reset', async (req, res) => {
  res.json({ success: false, message: 'Self-service OTP reset is not available. Please use "Request help from admin" instead.' });
});

// POST /api/student/password-contact-request — student requests admin help
// Body: { identifier }  (name, matric number or email)
app.post('/api/student/password-contact-request', async (req, res) => {
  try {
    const identifier = cleanSpaces(req.body?.identifier || req.body?.name || '');
    if (!identifier) return res.json({ success: false, message: 'Please enter your name, matric number or email.' });
    const found = await findStudentsByIdentifier(identifier);
    if (!found.length) return res.json({ success: false, message: 'No account found with that name, matric number or email.' });
    if (found.length > 1) return res.json({ success: false, message: 'More than one student has that name. Please enter your matric number or email instead.' });
    const student = found[0];
    // Prevent duplicate pending requests
    const existing = await PasswordContactRequest.findOne({ student_id: student._id, resolved: false });
    if (existing) return res.json({ success: true, message: 'Request already submitted. An admin will contact you.', student_name: student.name });
    await PasswordContactRequest.create({ student_id: student._id, matric: student.matric || student.name });
    res.json({ success: true, message: 'Request sent! An admin will reset your password shortly.', student_name: student.name });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/password-contact-requests
app.get('/api/admin/password-contact-requests', adminAuth, async (req, res) => {
  try {
    const list = await PasswordContactRequest.find().populate('student_id', 'name matric').sort({ created_at: -1 }).limit(100).lean();
    res.json(list.map(r => ({
      id: r._id, matric: r.matric, resolved: r.resolved,
      name: r.student_id?.name || '—',
      created_at: r.created_at
    })));
  } catch(e) { res.json([]); }
});

// POST /api/admin/password-contact-requests/:id/resolve
app.post('/api/admin/password-contact-requests/:id/resolve', adminAuth, async (req, res) => {
  try {
    await PasswordContactRequest.findByIdAndUpdate(req.params.id, { resolved: true });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/admin/password-contact-requests/:id/approve — set new password and resolve
app.post('/api/admin/password-contact-requests/:id/approve', adminAuth, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password?.trim() || new_password.trim().length < 6)
      return res.json({ success: false, message: 'Password must be at least 6 characters.' });

    // Look up the request first so we can resolve via student_id (reliable),
    // not by matric string matching (which breaks on case/spacing mismatches).
    const request = await PasswordContactRequest.findById(req.params.id);
    if (!request) return res.json({ success: false, message: 'Request not found.' });

    const student = await Student.findById(request.student_id);
    if (!student) return res.json({ success: false, message: 'Student not found.' });

    const hashed = bcrypt.hashSync(new_password.trim(), 10);
    await Student.findByIdAndUpdate(student._id, { password: hashed });
    await PasswordContactRequest.findByIdAndUpdate(req.params.id, { resolved: true });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/password-resets — admin sees all pending reset requests
app.get('/api/admin/password-resets', adminAuth, async (req, res) => {
  try {
    const list = await PasswordResetRequest.find().populate('student_id', 'name matric department_id').sort({ created_at: -1 }).limit(100).lean();
    res.json(list.map(r => ({
      id: r._id, matric: r.matric, status: r.status,
      name: r.student_id?.name || '—',
      channel: r.channel || 'manual',
      admin_note: r.admin_note || '',
      created_at: r.created_at, updated_at: r.updated_at
    })));
  } catch(e) { res.json([]); }
});

// POST /api/admin/password-resets/:id/action — admin approves or rejects
app.post('/api/admin/password-resets/:id/action', adminAuth, async (req, res) => {
  try {
    const { action, new_password, admin_note } = req.body; // action: 'approved'|'rejected'
    const rr = await PasswordResetRequest.findById(req.params.id).populate('student_id');
    if (!rr) return res.json({ success: false, message: 'Request not found.' });
    if (action === 'approved') {
      if (!new_password?.trim()) return res.json({ success: false, message: 'new_password is required for approval.' });
      const hashed = bcrypt.hashSync(new_password.trim(), 10);
      await Student.findByIdAndUpdate(rr.student_id._id, { password: hashed });
    }
    await PasswordResetRequest.findByIdAndUpdate(req.params.id, {
      status: action, admin_note: admin_note?.trim() || '', new_password: action === 'approved' ? new_password.trim() : '', updated_at: new Date()
    });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== COMPLAINT THREADS ===
// ===========================

// POST /api/student/complaints/:id/reply — student replies in thread
app.post('/api/student/complaints/:id/reply', async (req, res) => {
  try {
    const { student_id, text } = req.body;
    if (!text?.trim()) return res.json({ success: false, message: 'Reply text required.' });
    const c = await Complaint.findById(req.params.id);
    if (!c) return res.json({ success: false, message: 'Complaint not found.' });
    if (c.student_id.toString() !== student_id) return res.json({ success: false, message: 'Unauthorized.' });
    const entry = { role: 'student', text: text.trim(), created_at: new Date() };
    c.thread.push(entry);
    c.status = c.status === 'resolved' ? 'in_progress' : c.status; // re-open if resolved
    c.updated_at = new Date();
    await c.save();
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// Also store admin replies in thread when admin replies
// (patch the existing reply endpoint to also push to thread)
// This is handled client-side by the updated admin-complaints.html

// GET /api/admin/complaints/:id/thread — get thread for a complaint
app.get('/api/admin/complaints/:id/thread', adminAuth, async (req, res) => {
  try {
    const c = await Complaint.findById(req.params.id).populate('student_id', 'name matric').lean();
    if (!c) return res.json({ success: false });
    res.json({ success: true, thread: c.thread || [], status: c.status });
  } catch(e) { res.json({ success: false }); }
});

// ===========================
// ===== LEVEL BROADCAST ====
// ===========================

// GET /api/levels — levels list (reuse for broadcast dropdowns)
// Already exists as /api/levels in admin.js — adding dedicated endpoint:
app.get('/api/admin/levels', adminAuth, async (req, res) => {
  try {
    const list = await Level.find().sort({ name: 1 }).lean();
    res.json(list.map(l => ({ id: l._id, name: l.name })));
  } catch(e) { res.json([]); }
});

// POST /api/admin/push/broadcast — extend to support level_id (patch existing)
// This route already exists above — we add level support to it:
// (keeping the original but patching the logic in-place above)
// For level broadcast, add a new route:
app.post('/api/admin/push/broadcast/level', adminAuth, async (req, res) => {
  try {
    const { title, body, level_id } = req.body;
    if (!title?.trim() || !body?.trim()) return res.json({ success: false, message: 'title and body are required.' });
    let student_ids = null;
    let target = 'All Students';
    if (level_id) {
      const students = await Student.find({ level_id: toOID(level_id) }, { _id: 1 });
      student_ids = students.map(s => s._id.toString());
      const lv = await Level.findById(level_id).lean();
      if (lv) target = `Level: ${lv.name}`;
    }
    const result = await sendOneSignalNotification({ title: title.trim(), body: body.trim(), student_ids });
    await BroadcastLog.create({ type: 'push', title: title.trim(), body: body.trim(), target, sent: result.recipients || 0 });
    res.json({ success: result.sent, ...result });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

app.post('/api/admin/email/broadcast/level', adminAuth, async (req, res) => {
  try {
    const { subject, html_body, level_id } = req.body;
    if (!subject?.trim() || !html_body?.trim()) return res.json({ success: false, message: 'subject and html_body are required.' });
    let target = 'All Students';
    const filter = {};
    if (level_id) {
      filter.level_id = toOID(level_id);
      const lv = await Level.findById(level_id).lean();
      if (lv) target = `Level: ${lv.name}`;
    }
    const students = await Student.find(filter, { email: 1, name: 1 }).lean();
    const eligible = students.filter(s => s.email);

    if (!eligible.length)
      return res.json({ success: true, sent: 0, failed: 0, total: 0, message: 'No students with email addresses found.' });

    const log = await BroadcastLog.create({ type: 'email', title: subject.trim(), body: html_body.trim(), target, total: eligible.length, status: 'sending' });

    res.json({ success: true, queued: true, total: eligible.length, log_id: log._id });

    (async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let sent = 0, failed = 0;
      for (const s of eligible) {
        const ok = await sendMail({ to: s.email, subject: subject.trim(), html: html_body.replace(/\{name\}/g, s.name || 'Student') });
        ok ? sent++ : failed++;
          await sleep(550);
      }
      await BroadcastLog.findByIdAndUpdate(log._id, { sent, failed, status: 'completed' });
    })().catch(err => console.error('[Broadcast] background send error:', err.message));
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// === SCHEDULED BROADCASTS ==
// ===========================

// POST /api/admin/broadcast/schedule — schedule a broadcast
app.post('/api/admin/broadcast/schedule', adminAuth, async (req, res) => {
  try {
    const { type, title, body, target_type, dept_id, level_id, send_at } = req.body;
    if (!type || !body?.trim() || !send_at) return res.json({ success: false, message: 'type, body, and send_at required.' });
    const sendDate = new Date(send_at);
    if (isNaN(sendDate.getTime()) || sendDate <= new Date()) return res.json({ success: false, message: 'send_at must be a future date.' });
    let target = 'All Students';
    let deptIdVal = null, levelIdVal = null;
    if (target_type === 'dept' && dept_id) {
      const dept = await Department.findById(dept_id).lean();
      if (dept) target = dept.name;
      deptIdVal = toOID(dept_id);
    } else if (target_type === 'level' && level_id) {
      const lv = await Level.findById(level_id).lean();
      if (lv) target = `Level: ${lv.name}`;
      levelIdVal = toOID(level_id);
    }
    const sb = await ScheduledBroadcast.create({ type, title: title?.trim() || '', body: body.trim(), target, dept_id: deptIdVal, level_id: levelIdVal, send_at: sendDate });
    res.json({ success: true, id: sb._id });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/admin/broadcast/scheduled — list pending scheduled broadcasts
app.get('/api/admin/broadcast/scheduled', adminAuth, async (req, res) => {
  try {
    const list = await ScheduledBroadcast.find({ sent: false }).sort({ send_at: 1 }).lean();
    res.json(list.map(s => ({ id: s._id, type: s.type, title: s.title, body: s.body, target: s.target, send_at: s.send_at, created_at: s.created_at })));
  } catch(e) { res.json([]); }
});

// DELETE /api/admin/broadcast/scheduled/:id — cancel a scheduled broadcast
app.delete('/api/admin/broadcast/scheduled/:id', adminAuth, async (req, res) => {
  try {
    await ScheduledBroadcast.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// ===========================
// ===== WEBAUTHN (Biometric)=
// ===========================
// Lightweight WebAuthn registration + authentication using built-in SubtleCrypto
// Server stores credential_id + public_key (COSE-encoded) per student.

// GET /api/webauthn/registration-options — generate challenge for registration
app.get('/api/webauthn/registration-options', async (req, res) => {
  try {
    const { matric } = req.query;
    const student = await Student.findOne({ matric });
    if (!student) return res.json({ success: false, message: 'Student not found.' });
    const challenge = Buffer.from(crypto.randomBytes(32)).toString('base64url');
    // Store challenge in session (use in-memory map since sessions are available)
    req.session.webauthn_challenge = challenge;
    req.session.webauthn_student_id = student._id.toString();
    res.json({
      success: true,
      options: {
        challenge,
        rp: { name: 'MARGMOCOTH', id: (process.env.APP_HOSTNAME || 'localhost') },
        user: { id: Buffer.from(student._id.toString()).toString('base64url'), name: student.matric, displayName: student.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: 60000,
        attestation: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/webauthn/register — store credential after registration
app.post('/api/webauthn/register', async (req, res) => {
  try {
    const { credential_id, public_key, matric } = req.body;
    if (!credential_id || !public_key || !matric) return res.json({ success: false, message: 'Missing fields.' });
    const student = await Student.findOne({ matric });
    if (!student) return res.json({ success: false, message: 'Student not found.' });
    // Upsert credential
    await WebAuthnCredential.findOneAndUpdate(
      { student_id: student._id },
      { credential_id, public_key, sign_count: 0 },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/webauthn/auth-options — generate challenge for authentication
app.get('/api/webauthn/auth-options', async (req, res) => {
  try {
    const { matric } = req.query;
    const student = await Student.findOne({ matric }).populate('department_id').populate('level_id');
    if (!student) return res.json({ success: false, message: 'Student not found.' });
    const cred = await WebAuthnCredential.findOne({ student_id: student._id });
    if (!cred) return res.json({ success: false, registered: false, message: 'No biometric registered for this account.' });
    const challenge = Buffer.from(crypto.randomBytes(32)).toString('base64url');
    req.session.webauthn_challenge = challenge;
    req.session.webauthn_student_id = student._id.toString();
    res.json({
      success: true,
      registered: true,
      options: {
        challenge,
        rpId: process.env.APP_HOSTNAME || 'localhost',
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: cred.credential_id, transports: ['internal'] }]
      },
      // Return student for immediate login after client verifies (server trusts platform authenticator attestation)
      student: {
        id: student._id.toString(), name: student.name, matric: student.matric,
        department: student.department_id?.name, department_id: student.department_id?._id.toString(),
        level: student.level_id?.name, level_id: student.level_id?._id.toString(),
        phone: student.phone || null, email: student.email || null, last_login: student.last_login || null
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/webauthn/authenticate — verify credential assertion (simplified — trusts platform authenticator)
app.post('/api/webauthn/authenticate', async (req, res) => {
  try {
    const { credential_id, matric } = req.body;
    if (!credential_id || !matric) return res.json({ success: false, message: 'Missing fields.' });
    const student = await Student.findOne({ matric }).populate('department_id').populate('level_id');
    if (!student) return res.json({ success: false, message: 'Student not found.' });
    const cred = await WebAuthnCredential.findOne({ student_id: student._id, credential_id });
    if (!cred) return res.json({ success: false, message: 'Biometric credential not recognised.' });
    // Update sign_count + last_login
    await WebAuthnCredential.findByIdAndUpdate(cred._id, { $inc: { sign_count: 1 } });
    await Student.findByIdAndUpdate(student._id, { last_login: new Date() });
    res.json({
      success: true,
      student: {
        id: student._id.toString(), name: student.name, matric: student.matric,
        department: student.department_id?.name, department_id: student.department_id?._id.toString(),
        level: student.level_id?.name, level_id: student.level_id?._id.toString(),
        phone: student.phone || null, email: student.email || null, last_login: student.last_login || null
      }
    });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// POST /api/webauthn/deregister — student removes biometric (from dashboard)
app.post('/api/webauthn/deregister', async (req, res) => {
  try {
    const { student_id } = req.body;
    await WebAuthnCredential.findOneAndDelete({ student_id: toOID(student_id) });
    res.json({ success: true });
  } catch(e) { res.json({ success: false, message: e.message }); }
});

// GET /api/webauthn/status — check if student has biometric registered
app.get('/api/webauthn/status', async (req, res) => {
  try {
    const { student_id } = req.query;
    const cred = await WebAuthnCredential.findOne({ student_id: toOID(student_id) });
    res.json({ registered: !!cred });
  } catch(e) { res.json({ registered: false }); }
});

// ===========================
// ===== EXAM SCHEDULE CRON ==
// ===========================
// Runs every 60s — fires push notification when an exam opens

const notifiedExamIds = new Set(); // in-memory: don't double-notify per server restart

setInterval(async () => {
  try {
    const now = new Date();
    // Find exams that opened in the last 2 minutes (to catch the window even if server was briefly busy)
    const twoMinAgo = new Date(now - 2 * 60 * 1000);
    const justOpened = await Exam.find({
      start_date: { $gte: twoMinAgo, $lte: now }
    }).populate('department_id').lean();

    for (const exam of justOpened) {
      if (notifiedExamIds.has(exam._id.toString())) continue;
      notifiedExamIds.add(exam._id.toString());

      const deptName = exam.department_id?.name || 'All Students';
      const dept_id  = exam.department_id?._id?.toString();

      // Push notification
      await sendOneSignalNotification({
        title: 'Exam Now Available',
        body:  `${exam.title} is now open. Log in to take your exam.`,
        ...(dept_id ? { student_ids: null, dept_id } : {})
      });

      console.log(`[CRON] Exam opened notification sent: ${exam.title}`);
    }
  } catch(e) {
    console.warn('[CRON] Exam schedule check error:', e.message);
  }
}, 60 * 1000);

// ===========================
// === SCHEDULED BROADCAST CRON
// ===========================
setInterval(async () => {
  try {
    const now = new Date();
    const due = await ScheduledBroadcast.find({ sent: false, send_at: { $lte: now } });
    for (const sb of due) {
      let student_ids = null;
      if (sb.dept_id) {
        const students = await Student.find({ department_id: sb.dept_id }, { _id: 1 });
        student_ids = students.map(s => s._id.toString());
      } else if (sb.level_id) {
        const students = await Student.find({ level_id: sb.level_id }, { _id: 1 });
        student_ids = students.map(s => s._id.toString());
      }
      if (sb.type === 'push') {
        const result = await sendOneSignalNotification({ title: sb.title, body: sb.body, student_ids });
        await BroadcastLog.create({ type: 'push', title: sb.title, body: sb.body, target: sb.target, sent: result.recipients || 0 });
      } else if (sb.type === 'email') {
        const filter = {};
        if (sb.dept_id) filter.department_id = sb.dept_id;
        if (sb.level_id) filter.level_id = sb.level_id;
        const students = await Student.find(filter, { email: 1, name: 1 }).lean();
        const eligible = students.filter(s => s.email);
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        let sent = 0, failed = 0;
        for (const s of eligible) {
          const ok = await sendMail({ to: s.email, subject: sb.title || 'Announcement', html: sb.body.replace(/\{name\}/g, s.name || 'Student') });
          ok ? sent++ : failed++;
          await sleep(550);
        }
        await BroadcastLog.create({ type: 'email', title: sb.title, body: sb.body, target: sb.target, sent, failed });
      }
      await ScheduledBroadcast.findByIdAndUpdate(sb._id, { sent: true });
      console.log(`[CRON] Scheduled broadcast sent: ${sb.title} → ${sb.target}`);
    }
  } catch(e) {
    console.warn('[CRON] Scheduled broadcast error:', e.message);
  }
}, 60 * 1000);
// ===========================
// === NAME / MATRIC CHANGE REQUEST ROUTES
// ===========================

// Student: submit a name/matric change request
app.post('/api/student/name-change-request', async (req, res) => {
  try {
    const { student_id, request_type, new_value, reason } = req.body;
    if (!student_id || !request_type || !new_value)
      return res.json({ success: false, message: 'Missing required fields.' });

    const student = await Student.findById(toOID(student_id));
    if (!student) return res.json({ success: false, message: 'Student not found.' });

    const current_value = request_type === 'name' ? student.name : student.matric;

    const existing = await NameChangeRequest.findOne({
      student_id: toOID(student_id), request_type, status: 'pending'
    });
    if (existing)
      return res.json({ success: false, message: `You already have a pending ${request_type === 'name' ? 'name' : 'matric'} change request. Please wait for admin review.` });

    await NameChangeRequest.create({ student_id: toOID(student_id), request_type, current_value, new_value: new_value.trim(), reason: reason || '' });
    res.json({ success: true });
  } catch(e) {
    console.error('[NameChangeRequest POST]', e.message);
    res.json({ success: false, message: 'Server error.' });
  }
});

// Student: get their own request history
app.get('/api/student/name-change-requests', async (req, res) => {
  try {
    const { student_id } = req.query;
    if (!student_id) return res.json([]);
    const requests = await NameChangeRequest.find({ student_id: toOID(student_id) })
      .sort({ requested_at: -1 }).lean();
    res.json(requests.map(r => ({
      id: r._id,
      request_type: r.request_type,
      current_value: r.current_value,
      new_value: r.new_value,
      reason: r.reason,
      status: r.status,
      admin_note: r.admin_note,
      requested_at: r.requested_at
    })));
  } catch(e) {
    res.json([]);
  }
});

// Admin: list all name/matric change requests
app.get('/api/admin/name-change-requests', adminAuth, async (req, res) => {
  try {
    const requests = await NameChangeRequest.find()
      .populate('student_id', 'name matric')
      .sort({ requested_at: -1 }).lean();
    res.json(requests.map(r => ({
      id: r._id,
      student: { name: r.student_id?.name, matric: r.student_id?.matric },
      request_type: r.request_type,
      current_value: r.current_value,
      new_value: r.new_value,
      reason: r.reason,
      status: r.status,
      admin_note: r.admin_note,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at,
      requested_at: r.requested_at
    })));
  } catch(e) {
    console.error('[Admin NameChangeRequests GET]', e.message);
    res.json([]);
  }
});

// Admin: approve or decline a request
app.post('/api/admin/name-change-requests/:id/review', adminAuth, async (req, res) => {
  try {
    const { action, admin_note } = req.body;

    // Resolve admin name from token
    const token = req.headers['x-admin-token'] || req.query._t;
    const adminDoc = await Admin.findOne({ activeToken: token }).lean();
    const adminName = adminDoc?.name || 'Admin';

    const ncr = await NameChangeRequest.findById(toOID(req.params.id)).populate('student_id');
    if (!ncr) return res.json({ success: false, message: 'Request not found.' });
    if (ncr.status !== 'pending') return res.json({ success: false, message: 'Request already reviewed.' });

    if (action === 'declined' && !admin_note)
      return res.json({ success: false, message: 'A reason is required to decline.' });

    ncr.status      = action;
    ncr.admin_note  = admin_note || '';
    ncr.reviewed_by = adminName;
    ncr.reviewed_at = new Date();
    await ncr.save();

    if (action === 'approved') {
      const update = ncr.request_type === 'name'
        ? { name: ncr.new_value }
        : { matric: ncr.new_value };
      await Student.findByIdAndUpdate(ncr.student_id._id, update);
    }

    const student = ncr.student_id;
    if (student?.email) {
      const isApproved = action === 'approved';
      const fieldLabel = ncr.request_type === 'name' ? 'Full Name' : 'Matric Number';
      await sendMail({
        to: student.email,
        subject: `${isApproved ? 'Approved' : 'Declined'} — ${fieldLabel} Change Request | MARGMOCOTH CBT`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
            <h2 style="color:${isApproved ? '#166534' : '#991b1b'};">${isApproved ? 'Request Approved' : 'Request Declined'}</h2>
            <p>Dear <strong>${student.name}</strong>,</p>
            <p>Your request to change your <strong>${fieldLabel}</strong> from <strong>${ncr.current_value}</strong> to <strong>${ncr.new_value}</strong> has been <strong>${action}</strong>.</p>
            ${isApproved
              ? '<p style="color:#166534;">Your record has been updated immediately.</p>'
              : `<p>Reason: <em>${admin_note}</em></p><p>You may submit a new corrected request if needed.</p>`}
            <hr style="margin:20px 0;"><p style="font-size:12px;color:#6b7280;">MARGMOCOTH CBT — Do not reply.</p>
          </div>`
      });
    }

    res.json({ success: true });
  } catch(e) {
    console.error('[Admin NameChangeRequest Review]', e.message);
    res.json({ success: false, message: 'Server error.' });
  }
});

// ===========================
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// ===========================
// ===== START SERVER ========
// ===========================

app.listen(PORT, () => {
  console.log(`\n[INFO] MARGMOCOTH CBT running on http://localhost:${PORT}`);
  console.log(`[INFO] Admin Portal: http://localhost:${PORT}/admin-login.html`);
  console.log(`[INFO] Student Portal: http://localhost:${PORT}/`);
});
