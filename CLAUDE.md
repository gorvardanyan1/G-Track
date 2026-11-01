# TEMPO — project rules

Full spec: PROJECT_SPEC.md. Read it before any task. Build only the phase I ask for.

## Structure
npm workspaces monorepo: apps/api (Express + TS + Prisma + PostgreSQL), apps/web (Vue 3 + Vite + TS + Pinia + Tailwind v4), packages/shared (Zod schemas, types, permissions, time utils with Luxon).

## Time rules (never break these)
- Store instants only as UTC timestamptz. Never store local time strings or fixed offsets.
- Timer start/stop always uses SERVER time. Never trust client timestamps for the running timer.
- Durations = ended_at − started_at in seconds (DB generated column). Never sum client-side counters.
- Display, "today", day/week grouping and reports always use the USER's IANA timezone from the profile.
- Rounding only in reports/exports, never in stored data.
- All timezone conversion logic lives in packages/shared and is unit tested, including DST and midnight-crossing cases.
- The web app's live timer uses the server clock offset from the X-Server-Time header.

## Security rules
- Every endpoint: validate input with a Zod schema from packages/shared (strip unknown keys), authenticate, then authorize in the service layer (role + resource ownership).
- Return 404 for resources the user isn't allowed to see.
- Never log passwords, tokens, secrets or full request bodies of auth endpoints.
- Refresh tokens: httpOnly Secure SameSite=Strict cookie, hashed in DB, rotated, with reuse detection.
- Every state-changing admin/PM action and every time entry edit/delete writes an audit log row.
- No raw SQL built with string concatenation; use Prisma or parameterized $queryRaw.

## Architecture rules
- api modules: routes → controller → service → repository. Controllers have no business logic; repositories have no permission logic.
- Errors via typed AppError classes and the central error handler.
- Database constraints protect invariants (one running timer, no overlaps) in addition to service checks.
- web: API calls only through a typed api client; state in Pinia stores; role checks in router guards for UX only.

## Workflow
- After each phase: run lint, typecheck and tests for affected workspaces; fix everything; then summarize what changed, what I should test manually, and with which seeded user.
- Write tests in the same phase as the feature.
- Don't add new libraries without asking me.
- Keep files small and focused.
