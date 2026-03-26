# Flowdesk — Workforce Management Platform

Flowdesk is a task management and employee performance platform for small businesses. It lets managers assign recurring and one-off tasks to employees, track completion in real time, analyse performance trends, and use AI to generate structured task lists from plain text descriptions.

---

## Features

- **Admin Dashboard** — Live activity feed, completion rates, employee progress overview
- **Task Manager** — Full CRUD for tasks with daily/weekly/monthly/one-off scheduling, multi-employee assignment, category tagging and priority levels
- **AI Organiser** — Describe work in plain English; Claude generates a structured, importable task list
- **Employee Profiles** — Per-employee analytics, task assignments, toolbox and guidelines management
- **Analytics** — Completion heatmaps, line charts, day-of-week patterns, time-of-day charts, leaderboard, missed tasks log
- **Gantt Chart** — Week and month views for both admin (all employees) and employees (personal schedule)
- **My Tasks** — Today / This Week / This Month views with progress bar, time blocks, and completion tracking
- **Toolbox** — Employee-specific website shortcuts with favicons, document upload/download with folder organisation
- **Guidelines** — Rich-text guidelines per employee, editable by admin, read-only by employee

---

## Installation

```bash
git clone <repo-url>
cd flowdesk
npm install
```

Create a `.env` file (copy from `.env.example`):

```
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

Start the development server:

```bash
npm run dev
```

The app opens at `http://localhost:5173`.

---

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@flowdesk.com | admin123 |
| Social Media Manager | ana@innoweb.com | employee123 |
| Ads Manager | carlos@innoweb.com | employee123 |

These are also shown as quick-fill buttons on the login page.

---

## Feature Walkthrough

### Admin

1. **Overview** — See today's completion rate, live activity feed, and employees falling behind
2. **Task Manager** — Create, edit and delete tasks. Filter by employee, category, frequency or priority
3. **AI Organiser** — Type a work description, select employees, click Generate Tasks, review inline then Import All
4. **Employees** — Grid view with today's progress bars. Click View Profile for per-employee management
5. **Analytics** — Company View (leaderboard, comparison charts, 30-day trend) and Individual View (heatmap, day-of-week, time-of-day, category, missed tasks)
6. **Gantt Chart** — Week/month view showing all employees' tasks, colour-coded by category

### Employee

1. **My Tasks** — Today's tasks grouped by time block. Check off as you complete them
2. **My Schedule** — Personal Gantt chart for week or month view
3. **Toolbox** — Websites tab with favicon quick-launch; Documents tab with upload, folders, download
4. **Guidelines** — Read manager-set guidelines for your role

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v3 |
| State | Zustand (persisted to localStorage) |
| Routing | React Router v6 |
| Charts | Recharts |
| Rich Text | Tiptap v2 |
| AI | Anthropic SDK (claude-sonnet-4-6) |
| Date Utils | date-fns |
| Icons | Lucide React |

---

## Adding Employees

Add to `sampleEmployees` in `src/data/sampleData.ts`:

```typescript
{
  id: 'emp-3',
  email: 'name@company.com',
  password: 'password',
  name: 'Full Name',
  role: 'employee',
  avatarInitials: 'FN',
  joinDate: '2024-01-01',
  jobTitle: 'Job Title',
  department: 'Department',
  managerId: 'admin-1',
}
```

Then clear localStorage to reinitialise sample data.

---

## Prototype Limitations

- **No backend** — All data stored in localStorage. Clearing browser data resets everything
- **No real auth** — Passwords in plain text (prototype only)
- **Browser API key** — Set `dangerouslyAllowBrowser: true` for prototyping. In production, proxy through a backend
- **Single-tenant** — No multi-tenancy support
- **No real-time sync** — Changes not reflected across sessions until refresh
