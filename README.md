# MARGMOCOTH CBT
## Margaret Mosunmola College of Health Science and Technology, Owo — Computer-Based Testing

A full-featured, AI-proctored, real-time Computer-Based Testing (CBT) platform built with Node.js, Express, MongoDB and Cloudinary.

---

### Pages

| Page | Purpose |
|------|---------|
| `index.html` | College landing page |
| `login.html` | Student login — full name, matric number **or** email, plus password |
| `register.html` | Student registration (full name, matric number, level, department, phone/email, password) |
| `admin-login.html` | Staff / admin login |

There is no payment or fee feature in this edition.

---

## Features

- **Student Portal** — Login, access exam with code, real-time face proctoring, AI side-look & voice detection
- **Admin Dashboard** — Manage exams, questions, students, departments, levels and courses
- **Face Captures** — Cloudinary-backed identity photos with per-card delete and Delete All support
- **Violations Dashboard** — Distinguishes *rule violations*, *network errors* and *system errors* with filtering, Excel/PDF export and per-student history lookup
- **Batch Password Generator** — Generate N login passwords with optional expiry and scope; full audit log
- **Real-time Network Monitoring** — Detects disconnect/reconnect during exams and logs them as `network_error` violations (does not count toward auto-submit limit)
- **Results & Analytics** — Score distribution charts, per-exam averages, retake grants
- **CSV Import** — Bulk upload students and questions via CSV
- **Restricted Admin Access** — Only the configured super-admin account may log in

---

## Tech Stack

| Layer       | Technology                                 |
|-------------|---------------------------------------------|
| Backend     | Node.js 18+, Express 4, Mongoose 9          |
| Database    | MongoDB Atlas                               |
| File Store  | Cloudinary (face captures)                  |
| AI Proctor  | TensorFlow.js + BlazeFace (client-side)    |
| Frontend    | Vanilla HTML/CSS/JS (served statically)    |
| CSV Export  | SheetJS, jsPDF, jsPDF-AutoTable             |
| Passwords   | bcryptjs                                    |

---

## Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd margmocoth-cbt
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

| Key                    | Description                               |
|------------------------|-------------------------------------------|
| `MONGODB_URI`          | MongoDB Atlas connection string           |
| `CLOUDINARY_CLOUD_NAME`| Cloudinary cloud name                     |
| `CLOUDINARY_API_KEY`   | Cloudinary API key                        |
| `CLOUDINARY_API_SECRET`| Cloudinary API secret                     |
| `GROQ_API_KEY`         | Optional. Turns on live AI in the login-page helper and student dashboard chat (free key at console.groq.com). Without it both assistants still answer common questions with built-in replies. |
| `SESSION_SECRET`       | Long random string for session cookies    |
| `PORT`                 | Server port (default: 3000)               |

### 3. Run

```bash
npm start          # production
npm run dev        # development (NODE_ENV=development)
```

Visit:
- **Student Portal:** `http://localhost:3000/`
- **Admin Portal:** `http://localhost:3000/admin-login.html`

---

## Admin Login

> Set your admin credentials via environment variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) before deploying.

Only the configured super-admin account is permitted. All other admin accounts are removed on startup.

After signing in, change the password at **Admin → Settings → Change Admin Password**.

## Violation Volume (AI sharpness)

**Admin → Settings → Violation Volume** takes a value from 1 to 100. At 1 the AI checks the camera about once a second and forgives short movements (head turn flagged after ~5 s, no face after ~8 s, leaving the exam window after ~4 s). At 100 it checks about 10 times a second and flags a head turn after ~0.4 s, no face after ~1 s, talking after ~1.2 s and leaving the exam window after ~0.8 s. The AI toggles (Strict Face Anti-Cheat, Restrict Side Look, Restrict Voice) must still be switched on for the camera checks; leaving the exam window is always monitored.

## Face verification (real exams)

When **Settings → Require Face Verification** is on (it is switched on once by default), a student must pass this order before a real exam opens: **access code → face check → exam**. The face check page compares the student's live face with the photo registered on their profile (Dashboard → Face Capture) using face-api.js in the browser. The match must be 0.5 or better (the server enforces this and refuses to issue the exam pass otherwise). Every attempt, matched or not, is saved with a photo and shown under **Admin → Face Captures** with a green "Matched" or red "MISMATCH" badge. After 5 failed attempts in 30 minutes the student is locked out for that exam. During the exam the identity check keeps running every few seconds, so the person cannot be swapped after the start. A student with no profile photo is sent to register one first. Refreshing a running exam does not need a new face check.

Limits to know: the face comparison runs in the student's browser, so the saved photo plus the Face Captures review is your audit trail. For the best accuracy ask students to take their profile photo in good light, facing the camera. The face-api model files are loaded from `/models` if you add them there, otherwise from a public CDN.

## Access codes and the demo exam

To open a real exam a student types the exam's **access code** on the Exam Access page (generate codes under *Access Code Restrictions / Exam Access Codes*). The server checks the code and gives the exam page a token; without it the questions will not load. An exam with no code yet cannot be started. After 8 wrong codes a student is paused for 10 minutes, and a code is needed again for a retake.

Every student has a **Take Demo Exam** card on the dashboard. The demo flow is: Start Demo → **face check** (live camera, one face in the oval, capture and confirm; the demo does not compare against a profile photo) → type the **demo access code `123456`** (shown on screen; change `DEMO_ACCESS_CODE` in `server.js`) → exam. During the demo the camera monitoring (face, side look, multiple faces, voice at violation volume 100, with a live "AI monitor" chip showing faces in view and whether the student is looking away) is always on at full strength, whatever your Settings say for real exams. It is a 10-question practice exam that works like a real one (camera, timer, fullscreen, violation rules, your Violation Volume and AI settings) but **saves nothing to the server**: no session, answers, camera photos or result. Violations are detected exactly like a real exam (leaving the window, side look, no face, multiple faces, talking…) and kept only in the student's browser tab, so the results page can list them with their photos. Admins and lecturers never see them. The score is marked in the browser and the results page says it was not recorded. Every results page has a Back to Dashboard button. Edit the questions in `DEMO_EXAM` in `server.js`.

## Violations page

**Admin → Proctoring → Violations** lists every violation the exam page records, each with the webcam capture or mouth-movement clip taken at that moment. Filter by exam, type, kind, date or student, switch to the *By student* summary, view and download the evidence, and export a CSV. Only the super admin can delete violations. Evidence is stored on Cloudinary; if Cloudinary is not configured or fails, it is saved under `public/uploads/violations/` on the server instead (note: some hosts wipe that folder on redeploy). A student's violation count is stored on the server, so refreshing the exam page no longer resets it.

## Lecturers and exam assignment

A lecturer does not need a department. **Settings → Exam Assignments** lets you assign an exam to all lecturers (including ones added later) or to any ticked lecturers. Assigned lecturers see that exam's questions, results and violations.

## Student Sign-in

Students sign in with **one** of their full name, matric number or email, plus their password
(their own password, or the active department password from *Batch Passwords*). If two students share a name,
the portal asks that student to use their matric number or email. After 8 wrong attempts from one device the
account pauses sign-in for 10 minutes. Students who forget a password tap **Forgot password?** and the request
appears in the admin panel, where an admin sets a new one.

---

## Admin Pages

| Page                      | Description                                  |
|---------------------------|----------------------------------------------|
| Dashboard                 | Overview stats and recent activity           |
| Create Exam               | Create exams with access codes               |
| Add / Upload Questions    | Add individual questions or CSV bulk import  |
| Results & Export          | View scores, export Excel/PDF                |
| Analytics                 | Charts, score distributions, averages        |
| Violations Dashboard      | Filter by type (rule/network/system), export |
| Face Captures             | View, delete, or delete-all face photos      |
| Batch Passwords           | Generate login passwords with expiry/audit   |
| Manage Students           | Add, edit, bulk import students              |
| Settings                  | Portal open/close, proctoring options        |

---

## Violation Types

| Type             | Icon | Description                                         |
|------------------|------|-----------------------------------------------------|
| `rule_violation` | [VIOLATION]   | Tab switch, fullscreen exit, face detection, etc.   |
| `network_error`  | [NETWORK]   | Internet disconnect/reconnect during exam           |
| `system_error`   | [SYSTEM]   | Unexpected system-level error                       |

Network errors are logged but **do not** count toward the auto-submit violation limit.

---

## CSV Formats

### Students CSV

```
name,matric,email,department,level
John Doe,MCH/2025/001,john@example.com,Public Health,100L
```

`matric` and `email` are optional but needed for students to sign in with them. Department and level names must match
the ones in the system. Each imported student gets the active department password from *Batch Passwords* (or `changeme`
if none exists) until they set their own.

### Questions CSV

```
question,optionA,optionB,optionC,optionD,answer
What is...?,Option 1,Option 2,Option 3,Option 4,A
```

---

## Developer

Powered by Tribal Tech
