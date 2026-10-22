# Milestone 1 architecture

This is the original Milestone 1 design record. For the current implementation, also read [Milestone 2 additions](milestone-2.md), which extend the schema, OAuth scopes and sync behavior described here.

This plan follows the supplied PRD's Milestone 1 vertical slice. Its later flows describe the eventual product; they are not requirements to implement now. The user authorized this Calendar-only implementation and asked for the plan before code. The plan was presented in chat before implementation.

## One application with small modules

```text
Capstone/
  src/app/                  Next.js pages and API routes
  src/components/           Interactive dashboard and structured form
  src/lib/                  Types, validation, timezone conversion, scheduler
  src/server/auth/          Google OAuth, encryption, app session lookup
  src/server/calendar/      Calendar API adapter and token refresh
  src/server/db/            Connection pool and user-scoped repositories
  src/server/services/      Schedule one task and save its result
  db/migrations/            Versioned PostgreSQL schema
  scripts/migrate.ts        Apply schema changes
  tests/                    Unit, SQL, UI, and browser checks
  docs/                     Architecture and acceptance checklist
  .env.example              Variable names, with no credentials
  README.md                 Setup and local run instructions
```

Next.js serves both the pages and server routes. That means one process to run and one repository to understand. TypeScript checks that modules agree on the shape of a task or calendar interval. Dependencies and their exact resolved versions are recorded in `package-lock.json`.

An API route is the front desk: it checks the signed-in user, validates input, and calls a service. A service coordinates a task's scheduling steps. The Calendar adapter translates our small interface into Google's HTTP requests. A repository translates application operations into SQL. These boundaries make Google behavior and persistence testable without copying API code into the UI.

The scheduler is a plain function: given the same clock time, settings, deadline, duration, and busy intervals, it returns the same earliest slot. It never calls Google or writes data. An AI model is unnecessary for structured fields and would make this milestone harder to verify.

## Request flow

```mermaid
sequenceDiagram
  participant UI as Task form
  participant API as Next.js route
  participant DB as PostgreSQL
  participant G as Google Calendar
  UI->>API: title, duration, local deadline, submission ID
  API->>API: Authenticate, validate, convert deadline to UTC
  API->>DB: Lock this user's row; find or insert task
  API->>G: Recover existing event by stable ID, if present
  API->>G: Read busy intervals, including Right Now
  API->>API: Find earliest continuous slot
  API->>G: Recheck slot immediately before writing
  API->>G: Create ordinary work event
  API->>DB: Save event ID, calendar ID, exact times, rationale
  DB-->>API: Commit
  API-->>UI: Saved scheduling result or clear error
```

The user-row lock serializes app writes for one user. Two simultaneous app requests cannot both pick the same slot from stale availability. It also coordinates settings and disconnect writes. It does not lock Google's Calendar: an external edit can still occur between the final availability check and event creation. Google does not provide an atomic free/busy-check-and-insert operation. This small residual race is an explicit limitation, not a guarantee that future calendar changes can never overlap.

Each submission has a UUID. Its user ID plus submission UUID produces a stable hexadecimal event ID accepted by Google. A retry first looks for that event before making another scheduling decision. A remote write can succeed before a local database commit fails; this lookup recovers that outcome on retry. The browser retains the pending input in session storage until a confirmed result. This is bounded request recovery, not automatic rescheduling or a general synchronization system.

## Data model

| Table | Key fields | Purpose |
| --- | --- | --- |
| `users` | UUID `id`; unique `google_sub`; email; timezone; work/sleep times; selected calendar IDs; dedicated calendar ID | Account and the rules for new scheduling |
| `oauth_connections` | `user_id` primary/foreign key; encrypted refresh token; scopes; status; update time | Server-only Google connection |
| `app_sessions` | Hashed token primary key; user ID; expiry | Short-lived app login, separate from Google tokens |
| `tasks` | UUID ID; user ID; submission ID; title; duration; UTC deadline; original local deadline; state; rationale; creation time | One logical task and its last scheduling result |
| `work_sessions` | UUID ID; user/task foreign keys; Google calendar/event IDs; UTC start/end | Exact mapping to the ordinary Google event |
| `schema_migrations` | SQL filename and application time | Which migrations have been applied |

`tasks` has a unique `(user_id, request_id)` constraint to reject duplicate submissions. `work_sessions` has one row per task in this milestone, a composite foreign key to prevent cross-user links, a unique event mapping, and a check that end is after start. Durations and states are constrained in SQL as well as request validation.

The original local deadline allows retries to recognize the same input even after a timezone preference changes. The already saved UTC deadline remains stable. Later milestones may expand task states and session multiplicity through new migrations. There are no dormant Google Task, LLM, check-in, cron, priority, or rescheduling tables.

UTC identifies a moment unambiguously, like a shared clock. An IANA timezone such as `America/New_York` tells us how to display that moment and how local working hours change with daylight saving. The Temporal polyfill handles these conversions without hand-coded UTC offsets. Deadline conversion rejects missing/repeated local clock times. Work/sleep boundaries use Temporal's compatible clock-change rules.

## Environment and security

| Variable | Role |
| --- | --- |
| `APP_URL` | Exact trusted origin for callback URLs and mutation-origin validation |
| `DATABASE_URL` | Server-only PostgreSQL connection, using provider TLS settings |
| `GOOGLE_CLIENT_ID` | App identifier used for consent and ID-token audience checking |
| `GOOGLE_CLIENT_SECRET` | Server-only credential for Google's code exchange |
| `TOKEN_ENCRYPTION_KEY` | Base64 representation of 32 random bytes for AES-256-GCM |

No variable is prefixed `NEXT_PUBLIC_`. Tokens stay on the server. The OAuth library validates Google's signed ID token. OAuth state binds the callback to the initiating browser; PKCE binds code exchange to a verifier held in an HTTP-only cookie. Session cookies use SameSite Lax, seven-day expiration, and Secure on HTTPS. Database session tokens are hashed, and refresh tokens are encrypted with authenticated encryption. Ordinary error responses exclude raw provider/database errors.

Every task read/write includes the authenticated user ID. Composite foreign keys add a second guard against mismatched event ownership. The app uses PostgreSQL through its server; it exposes no database endpoint or broad database credential to the browser. This is application-level isolation, not a claim of PostgreSQL row-level security. If browser database access is introduced later, its authorization model must be designed separately.

Scopes are `openid`, `email`, `calendar.calendarlist.readonly`, `calendar.events.freebusy`, and `calendar.app.created`. The app reads availability rather than unrelated event content and writes only to app-created calendars. The dedicated calendar has a marker tied to this OAuth client and user, so reconnection can identify it without treating an unrelated calendar named Right Now as ours. Stored dedicated calendar deletion fails visibly.

## Intentional Milestone 1 defaults

| Decision | Beginner-friendly reason |
| --- | --- |
| One continuous event per task | Makes it easy to verify that input duration matches output duration |
| Required future deadline, maximum 90 days | Gives the scheduler a clear, bounded search window |
| Working hours 09:00–18:00, sleep 23:00–07:00, editable | Protects time with visible rules instead of hidden guesses |
| Same-day working interval, every day eligible | Keeps settings and placement understandable in the first slice |
| No buffer, whole-minute starts | A clear initial rule that is easy to test |
| Save an unscheduled task with all effort unallocated | No false claim that an infeasible task fits |
| No separate backend server or ORM | Keeps business logic and SQL readable and setup small |
| No automatic retries or background work | Makes each calendar write traceable to a user submission |

These are implementation choices for Milestone 1, not inferred changes to later product requirements. Split work and partial allocation, Google Tasks, event-move/deletion reconciliation, natural language, priorities, completion, check-ins, and fallback jobs remain unimplemented.

Official references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [FreeBusy contract](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), and [event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
