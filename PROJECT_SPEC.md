# TEMPO — Time Tracker (Project Spec)

A Clockify-style time tracking app with a strong, secure architecture and a beautiful, animated UI. Three roles: Super Admin, Project Manager (PM), Worker. Time calculation must be exactly correct across devices, timezones and server/client clock differences.

## TECH STACK
- Monorepo with npm workspaces:
  - apps/api — Node.js + Express + TypeScript
  - apps/web — Vue 3 + Vite + TypeScript
  - packages/shared — shared Zod schemas, types, roles/permissions and time utilities used by BOTH api and web
- Database: PostgreSQL 16 + Prisma (with raw SQL migrations for constraints Prisma can't express)
- Time library: Luxon (both sides, via packages/shared)
- Realtime: Socket.io (live "who is working now")
- Frontend: Pinia, Vue Router, Tailwind CSS v4, VueUse, ECharts (vue-echarts), GSAP for UI motion
- Testing: Vitest (unit), Supertest (API integration), Playwright (main E2E flows)
- Docker Compose: postgres, api, web (dev), plus a test database

## ROLES & PERMISSIONS

### Super Admin (site administrator)
- Manage all users: invite, activate/deactivate, change role, reset 2FA, force logout (revoke sessions)
- Manage clients and all projects; assign PMs to projects
- Organization settings: name, default timezone, week start day, time rounding for reports, max running-timer duration, timesheet approval on/off, lock period (e.g. entries older than 30 days locked)
- View all reports, all time entries, live activity
- View the audit log (who did what, when, from which IP)
- Required 2FA (TOTP)

### Project Manager (PM)
- Sees ONLY projects where they are a PM
- Create/edit tasks inside their projects, add/remove workers to their projects, set project budget (hours) and billable rates
- Live view: which of their workers are tracking right now, on what, for how long
- Reports for their projects: by project, task, worker, day/week/month; export CSV and PDF
- Timesheet approval: approve or reject (with comment) workers' weekly timesheets for their projects
- Can NOT edit a worker's time entries directly; can only reject with a comment (every action audited)

### Worker
- Start / stop the timer with project, task (optional), description, billable flag
- Add manual time entries; edit/delete own entries unless the period is locked or approved
- See only projects they're assigned to
- Views: today list, week timesheet grid, calendar view, own reports
- Submit weekly timesheet for approval

Authorization rules are enforced on the server for every request (role check + resource ownership check). The frontend only hides UI; it never decides access.

## TIME CORRECTNESS (most important part)

### Golden rules
1. All instants are stored in UTC (Postgres `timestamptz`). Never store local time strings.
2. The SERVER clock is the source of truth for the running timer. Start and stop use the server's current time, never the client's.
3. Durations are always computed from two UTC instants (end − start), stored as integer seconds (generated column). Never add up minutes from strings or from client counters.
4. Every user has an IANA timezone in their profile (e.g. "Asia/Yerevan", "Europe/Berlin"), defaulting to the browser's timezone on first login. All display, "today", day/week grouping and reports use this timezone, not the server timezone and not a fixed offset.
5. Rounding (e.g. to 15 min) is applied ONLY in reports/exports display, never to stored data.

### Server/client clock difference
- Every API response includes a `X-Server-Time` header (UTC ms).
- The web app computes `serverOffset = serverTime - (requestStart + responseEnd) / 2` and keeps a smoothed value (median of recent samples).
- The live timer display = `now + serverOffset - startedAt`. This way a laptop with a wrong clock still shows the correct elapsed time.
- If the browser timezone differs from the profile timezone, show a small banner offering to switch.
- If the device clock is off by more than 2 minutes, show a subtle warning (tracking still works because the server decides).

### Running timer
- Max one running timer per user (enforced by a partial unique index: one row per user where ended_at IS NULL).
- Starting a timer while one is running stops the previous one first, in one transaction.
- The timer keeps running on the server if the browser closes. On next open, the web app loads it and continues displaying.
- Multiple tabs/devices: timer state syncs via Socket.io (start/stop in one tab updates all others instantly).
- Safety: a scheduled job auto-stops timers running longer than the org's max duration (default 12 h), flags the entry as "auto-stopped" and notifies the worker.

### Manual entries
- The user enters date + start + end in their profile timezone. The shared util converts to UTC with Luxon, handling DST gaps (non-existent times) and overlaps (ambiguous times) explicitly with a clear validation message.
- The server re-validates everything: end > start, duration ≤ 24 h, not in the future (allow 1 min skew), not in a locked/approved period, user assigned to the project, and no overlap with the user's other entries.
- Overlaps are blocked by a Postgres exclusion constraint on (user_id, tstzrange(started_at, ended_at)), so even concurrent requests can't create overlaps.

### Entries crossing midnight / days
- An entry from 22:00 to 02:00 (user timezone) is split across both days in day/week reports by its real portion on each day (computed in SQL with AT TIME ZONE or in the shared util), never counted fully on one day.

### Tests (required)
- Unit tests for all shared time utilities, including: DST spring-forward and fall-back (Europe/Berlin, America/New_York), Asia/Yerevan, midnight-crossing entries, week boundaries with different week-start days, leap day, client clock offset calculation.
- API tests: two concurrent start requests produce one running timer; overlapping manual entries are rejected; locked periods reject edits.

## SECURITY
- Passwords: argon2id; strong password policy; breached-password check optional
- Auth: short-lived access token (JWT, 15 min) kept in memory on the client; refresh token in an httpOnly, Secure, SameSite=Strict cookie, rotated on every use, stored hashed in DB, with reuse detection (reuse = revoke the whole session family)
- 2FA (TOTP) required for Super Admin, optional for others; recovery codes hashed
- Users are created by invitation only (Super Admin invites; invite link token hashed, expires in 48 h). No public signup
- Password reset: hashed single-use token, 30 min expiry, same response whether the email exists or not
- Rate limiting: login, refresh, password reset, invite endpoints; account lockout with backoff after repeated failures
- helmet, strict CORS allowlist, Origin check on cookie-based endpoints, body size limits, hpp
- All input validated with Zod schemas from packages/shared; unknown fields stripped (no mass assignment)
- Every query scoped by permissions in a service layer; IDs are UUIDs; 404 (not 403) for resources the user can't see
- Socket.io connections authenticated with the access token; users join only rooms they're allowed to (own user room, PM's project rooms, admin room)
- Audit log: logins, failed logins, role changes, entry edits/deletes, approvals, settings changes (actor, action, target, before/after, IP, user agent)
- Secrets only from environment variables, validated at startup; no secrets in the repo
- Structured logging (pino) without passwords/tokens; request IDs
- Dependency audit in CI

## BACKEND ARCHITECTURE (apps/api)
- Feature modules: auth, users, clients, projects, tasks, time-entries, timer, timesheets, reports, settings, audit, realtime
- Each module: routes → controller (HTTP only) → service (business rules, permissions, transactions) → repository (Prisma queries)
- Central error handler with typed AppError classes, consistent error format { error: { code, message, details } }
- Middleware: requestId, logger, helmet, cors, rateLimit, authenticate, requireRole, validate(schema)
- Jobs: auto-stop long timers, clean expired tokens (node-cron or a simple scheduler)
- API versioned under /api/v1; OpenAPI docs generated from Zod schemas (available only in development)
- Seed script: 1 super admin, 2 PMs, 6 workers, 2 clients, 4 projects, tasks, and realistic entries for the last 6 weeks across different timezones

## DATABASE (main tables)
- users (id, email unique, password_hash, name, role, timezone, is_active, totp_secret_encrypted, created_at)
- sessions / refresh_tokens (family_id, token_hash, expires_at, revoked_at, ip, user_agent)
- invites, password_resets
- clients, projects (client_id, name, color, budget_hours, is_billable, archived_at)
- project_members (project_id, user_id, role_in_project: PM | WORKER, hourly_rate)
- tasks (project_id, name, is_done)
- time_entries (id, user_id, project_id, task_id, description, started_at timestamptz, ended_at timestamptz NULL, duration_seconds GENERATED, is_billable, source: TIMER | MANUAL | AUTO_STOPPED, created_at, updated_at)
  - partial unique index: one running entry per user
  - exclusion constraint: no overlapping ranges per user (btree_gist)
  - check: ended_at > started_at
- timesheets (user_id, week_start date, status: DRAFT | SUBMITTED | APPROVED | REJECTED, reviewer_id, comment)
- org_settings (single row)
- audit_logs

## FRONTEND (apps/web)
### Design
- Modern, calm, premium SaaS look. Light and dark mode (system default + toggle)
- Colors: neutral grays, one accent (indigo #5B5BF7) and a success green for "running"; project colors as small dots/bars
- Font: Inter for UI, JetBrains Mono for all timers and durations (tabular numbers so digits don't jump)
- Layout: collapsible sidebar, top bar with the global timer, content area with cards
- Motion (GSAP + Vue transitions, subtle and fast, 150–300 ms): page transitions, list items enter/leave, timer start button morphs into a stop button with a pulsing ring, numbers count up in dashboards, charts animate in, skeleton loaders, toast notifications. Respect prefers-reduced-motion.

### Global timer bar (all roles that track)
- Description input, project/task picker (searchable, with project color), billable toggle, big start/stop button, live elapsed time HH:MM:SS
- Keyboard shortcut: "S" to start/stop, "N" for new manual entry
- Browser tab title shows the running time

### Worker pages
- Today: entries grouped by day, total per day, inline edit, duplicate entry, "continue" button to restart a past entry
- Week timesheet: grid (projects × days), totals per row/column, submit for approval, status badge
- Calendar: week view with entries as blocks, drag to create a manual entry
- My reports: charts by project and by day

### PM pages
- Dashboard: live "working now" list (avatar, project, elapsed time ticking), hours this week vs budget per project (progress bars), pending approvals count
- Projects: list + detail (members, tasks, budget usage, rates)
- Reports: filters (date range, project, task, worker, billable), summary cards, bar chart by day, donut by project, detailed table; export CSV / PDF
- Approvals: weekly timesheets to approve/reject with comment

### Super Admin pages
- Users: table with search/filter, invite modal, role change, deactivate, revoke sessions
- Clients & Projects: full management, assign PMs
- Organization settings
- Audit log: filterable table with before/after diff view
- Global reports (same as PM but all projects)

### Common
- Login, 2FA screen, accept invite, forgot/reset password, profile (name, timezone selector, password, 2FA setup)
- Route guards by role; 404 page; empty states with illustrations
- All dates/times formatted with the user's timezone and locale

## DEVELOPER EXPERIENCE
- ESLint + Prettier, strict TypeScript, Husky pre-commit (lint + typecheck)
- .env.example for api and web
- README with setup, architecture diagram, roles, time handling explanation
- GitHub Actions: lint, typecheck, tests (with a Postgres service)
