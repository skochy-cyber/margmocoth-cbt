# MARGMOCOTH CBT
## Margaret Mosunmola College of Health Science and Technology, Owo — Computer-Based Testing

A full-featured, AI-proctored, real-time Computer-Based Testing (CBT) platform built with Node.js, Express, MongoDB and Cloudinary.

---

### Pages

| Page | Purpose |
|------|---------|
| `index.html` | College landing page |
| `login.html` | Student login |
| `register.html` | Student registration |
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
name,matric,department,level,password
John Doe,MCH/2025/001,CHEW,100,pass1234
```

### Questions CSV

```
question,optionA,optionB,optionC,optionD,answer
What is...?,Option 1,Option 2,Option 3,Option 4,A
```

---

## Developer

Powered by Tribal Tech
