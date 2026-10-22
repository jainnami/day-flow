# Right Now

Milestones 1 and 2 of the supplied Right Now v0.1 PRD: a student enters a structured task, the app finds one feasible Calendar work session, and a linked Google Task tracks completion. Built with Next.js App Router, TypeScript, and PostgreSQL hosted on Neon.

The code includes Google sign-in, calendar selection, editable working/sleep hours and timezone, deterministic scheduling, Calendar event and Google Task linkage, completion refresh, manual sync, and reconciliation of moved/deleted events. Natural-language parsing, priorities, split sessions, check-ins, and automatic rescheduling remain outside the implemented scope.

## Upgrade from Milestone 1

1. Enable **Google Tasks API** in the same Google Cloud project used for Calendar.
2. Add `https://www.googleapis.com/auth/tasks` under **Google Auth Platform > Data Access**. Keep the existing Calendar scopes.
3. Run `npm.cmd run db:migrate` against the existing Neon database. Migration `002_linked_completion.sql` adds fields and states without deleting existing tasks, events, or OAuth connections. No new environment variables are needed.
4. Restart the app (or redeploy the new code), click **Reconnect Google**, and approve Calendar and Tasks permissions. Each user must consent separately; a Calendar-only connection cannot access Tasks.
5. Open the app or click **Sync Google**. Existing Milestone 1 tasks are linked to Google Tasks, and their existing Calendar events are reconciled without creating new work sessions.

Deadlines are now optional. Run the migration command after updating to apply `003_optional_deadlines.sql`, which allows a task to keep both deadline fields empty while preserving existing dated tasks. No new environment variables or Google permissions are needed for this change.

See [Milestone 2 behavior and acceptance checks](docs/milestone-2.md). Calendar events and Google Tasks are separate Google objects; the public Tasks API does not expose precise scheduled times.

## Start here

You need Node.js 22 or newer, a Google account, and a Neon account for the hosted PostgreSQL database. No local PostgreSQL installation or Workbench is needed. Development was checked with Node 24.13.1. The commands below use `npm.cmd` because Windows PowerShell can block `npm.ps1`.

```powershell
Set-Location -LiteralPath "C:\Users\tanul\Tanu academics\Columbia\Fall '26\PM with AI\Capstone"
npm.cmd ci
if (!(Test-Path .env.local)) {
    Copy-Item .env.example .env.local
}
```

Open `.env.local` in your editor. It contains secrets, so it is excluded from Git. Do not paste credentials into chat or commit them. Generate the encryption key once and put its output in `TOKEN_ENCRYPTION_KEY`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep this key stable. Changing it makes existing encrypted Google tokens unreadable, requiring reconnection.

## Configure Google Cloud

Google Cloud supplies this app's sign-in credentials and permission to use Calendar and Tasks. It does not need to host the app or database. No service account, LLM API, Cloud Scheduler, or background worker is needed for these two milestones.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a development project, for example `right-now-dev`.
2. In **APIs & Services → Library**, enable **Google Calendar API** and **Google Tasks API**.
3. Open **Google Auth Platform → Branding**. Enter the app name `Right Now`, your support email, and developer contact email.
4. Under **Audience**, select **External**, keep publishing status **Testing**, and add your Google account under test users. An institutional account may have administrator restrictions; a personal test account can simplify development.
5. Under **Data Access**, configure these scopes:

   | Scope | Why this milestone needs it |
   | --- | --- |
   | `openid` | Verify your Google identity |
   | `email` | Show which account is connected |
   | `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Let you choose calendars to check |
   | `https://www.googleapis.com/auth/calendar.events.freebusy` | Read availability on accessible calendars without reading event titles |
   | `https://www.googleapis.com/auth/calendar.app.created` | Create a dedicated calendar and manage events in app-created calendars |
   | `https://www.googleapis.com/auth/tasks` | Create linked Google Tasks and read their completion/deletion state |

6. Under **Clients**, create an OAuth client with application type **Web application**.
7. Add authorized JavaScript origin `http://localhost:3000` and authorized redirect URI `http://localhost:3000/api/auth/google/callback`. The redirect URI must match exactly. The server-side flow uses the redirect URI; it does not put Google's client secret in browser code.
8. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`.
9. Set `APP_URL=http://localhost:3000`. Open the app using that same hostname and port. If you change it, update Google's redirect URI too.

On first connection, approve all requested permissions. Partial consent is rejected clearly. Google issues offline refresh tokens so the server can renew access; tokens for External apps in Testing generally expire after seven days, so reconnect when prompted. Public distribution may require Google verification depending on the scopes and audience. See [Google's scope reference](https://developers.google.com/workspace/calendar/api/auth) and [OAuth token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Configure Neon PostgreSQL

This project uses [Neon](https://console.neon.tech/) to host PostgreSQL online. The database stores tasks and their Google event links so they survive app and server restarts. Neon's browser console lets you inspect the database without installing a desktop database tool. The app uses its existing `pg` driver; no Neon SDK or Neon Auth setup is required.

1. Sign in to Neon and open your project. If creating it for the first time, name it `right-now` and choose a nearby region. The default database name, such as `neondb`, is fine.
2. Click **Connect** and select the branch, database, and role you want this app to use. A Neon database branch is separate from your Git branch; switching Git branches does not switch databases.
3. Turn **Connection pooling off** to copy a direct connection string for local setup and migrations. Its hostname should not contain `-pooler`. A hosted serverless app can use Neon's pooled URL for the same database.
4. Copy only the URL beginning with `postgresql://`, without a surrounding `psql` command. Keep all SSL and other connection parameters supplied by Neon.
5. In `.env.local`, replace the localhost `DATABASE_URL` placeholder with the copied URL. Leave your other environment variables in place.

```dotenv
DATABASE_URL="postgresql://YOUR_ROLE:YOUR_PASSWORD@YOUR_NEON_HOST/neondb?sslmode=verify-full"
```

The example shows the shape of the URL; copy the credentials, hostname, database and other connection parameters from your Neon console. Use `sslmode=verify-full` to make certificate and hostname verification explicit. Both the app and migration runner normalize the older `require`, `prefer`, and `verify-ca` aliases to `verify-full`, preserving pg's existing behavior without its upcoming-change warning. Local URLs without an SSL mode and URLs explicitly opting into `uselibpqcompat=true` keep their configured behavior. The connection string contains your database password, so keep it in the Git-ignored `.env.local`. The browser never connects directly to PostgreSQL. Server queries use parameters and filter by the authenticated user's ID. See [Neon's connection guide](https://neon.com/docs/get-started/connect-neon) and [PostgreSQL SSL verification](https://www.postgresql.org/docs/current/libpq-ssl.html).

Create the tables from the project folder:

```powershell
npm.cmd run db:migrate
```

This command reads `.env.local`, connects to Neon, applies unapplied SQL migrations in order, and records them in `schema_migrations`. A successful first run prints:

```text
Applied 001_milestone_one.sql
Applied 002_linked_completion.sql
Applied 003_optional_deadlines.sql
```

Repeating the command safely skips completed migrations. Do not manually create the tables in Neon first. Do not edit an already-applied migration; add a new numbered SQL file instead.

To verify setup, open Neon's **SQL Editor**, select the same branch and database, and run:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

For a new database, expect six tables: `app_sessions`, `oauth_connections`, `schema_migrations`, `tasks`, `users`, and `work_sessions`.

Neon's [SQL Editor guide](https://neon.com/docs/get-started/query-with-neon-sql-editor) explains how to run queries in the browser. Restart the app after changing `.env.local`. Google credentials and the encryption key are still required separately before connecting Calendar.

## Run the app

```powershell
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). The public welcome screen also works without credentials and explains setup. Scheduling requires completed setup.

1. Click **Connect Google Calendar** and approve Calendar and Tasks access. The familiar connection button now connects both services.
2. Open **Calendar & hours**. Verify your timezone, working/sleep hours, and calendars. Defaults are `America/New_York`, working 09:00–18:00, sleep 23:00–07:00, and your primary calendar. The dedicated Right Now calendar is always included in availability checks.
3. Enter a title and duration in minutes. Optionally add a deadline in the displayed timezone, or leave **Finish by (optional)** blank. Click **Find a time & schedule**.
4. See the saved task and its scheduled time. Open Google Calendar and verify the ordinary event in the **Right Now** calendar. Open Google Tasks to find the linked task in the app's **Right Now (account marker)** list.
5. Refresh the page to confirm the task/event mapping persisted.

Working hours must start and end on the same local day; sleep can cross midnight. All days of the week are eligible. Durations range from 5 to 720 minutes. A deadline, when provided, must be a future time within 90 days. Without a deadline, the scheduler searches for the earliest free slot within the next 90 days, respecting the same working/sleep hours and busy calendars. This is a search limit, not a deadline; the database keeps deadline fields null and the app shows **No deadline**. Google Tasks uses a separate date based on the work session, as described below. Each task needs a single continuous slot. Scheduling starts at the next whole minute, with no buffer. If no slot fits, the task and its undated Google Task are saved, and all work minutes are reported as unallocated. To try different inputs for such a task, create a new task; there is no reschedule action yet.

The deadline field uses the selected account timezone, even if your computer uses another timezone. UTC timestamps identify exact moments in storage. Invalid or ambiguous local deadlines around clock changes are rejected so the app does not silently choose a different deadline.

**Sync Google** refreshes Google Tasks completion and Calendar event times, and also runs automatically when the signed-in app opens or reloads. Sync is processed in small pages to keep each server request bounded. If one task fails, its existing links remain and a clear warning is shown; other tasks can still sync. Closing the page can interrupt a sync; run it again to continue checking state.

Mark a linked task completed in Google Tasks, then sync. The app closes it and cancels work sessions that have not started, using Google's current event times. Already started/elapsed sessions remain historical. Deleting the Google Task also intentionally closes it. Deleting only the Calendar event leaves the Google Task open and marks the session removed and the task review needed; it is not recreated automatically. Moving an event updates its saved timing without duplicating it or changing the original task title. Converting it to an all-day event requires review. Closed tasks are not automatically reopened or rescheduled in this milestone.

Google Tasks receives a date-only value for the **day after the Calendar work session starts**, using your Right Now timezone. For example, a Friday work session puts the Google Task on Saturday, even if the actual deadline is next week or blank. The exact deadline remains unchanged in the app/database and Task notes. A Task stays undated until a work session is saved. Moving a Calendar event updates the Google Task date on the next sync; completed or deleted Tasks are not redated. After upgrading, click **Sync Google** to correct existing open Tasks that still use the old deadline date. Confirm API-created Task visibility in Google's UI during account-backed acceptance testing.

**Sign out** ends this app session. **Disconnect Google Calendar**, in settings, removes saved access to both Google services, ends all account sessions, and attempts Google token revocation. Existing tasks, task lists and Calendar events remain. If revocation cannot be confirmed, follow the displayed instruction to remove access in your Google Account.

## Recover an interrupted submission

If a connection fails after you click Schedule, Google may already have created a Task or event. Use **Check previous submission** in the same browser tab. The app remembers the submission ID in session storage and uses a stable Google event ID to recover a Calendar write. Google Tasks does not offer the same client-chosen event ID mechanism, so its creation intent is committed first and the Task carries a unique marker in its notes. Sync searches for that marker, including hidden/completed/deleted tasks, to recover the original ID. Do not remove this marker while a creation result is uncertain.

Validation failures allow correcting the form immediately. Unexpected failures keep the submission ID for recovery. If a persisted task shows an error after reopening a different tab, use **Check this task’s status** on its task card. This recovers the same request; it is not an action to move an already scheduled task.

If an attempted Google Task write has an unknown result and its marker is not found, the app shows an uncertain link and does not issue another insertion. Repeated Sync checks can recover a delayed result. This favors avoiding duplicates; an ambiguous write that never reached Google may require manual investigation. An explicit provider rejection, such as Tasks API disabled, permits retry after fixing setup.

## Run checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The browser suite starts the built app on port 3100 with fake test credentials and no database. It uses installed Google Chrome and verifies the public UI, protected task/sync endpoints, OAuth state/PKCE and Tasks scope, denied consent, and mobile overflow. If Chrome is unavailable, install Playwright's Chromium (`npx.cmd playwright install chromium`) and remove `channel: "chrome"` from the two projects in `playwright.config.ts`.

Unit/service tests run without Google or PostgreSQL credentials. UI tests exercise the signed-in dashboard, sync, completion states and errors with mocked API responses. SQL tests execute migrations and repository queries using **pg-mem**, a PostgreSQL emulator. They do not prove real PostgreSQL locking or live Google interoperability. See the original [Milestone 1 acceptance checklist](docs/acceptance-tests.md) and the current [Milestone 2 checks](docs/milestone-2.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Setup message on welcome screen | All five variables have real values; restart the dev server after changing them |
| `redirect_uri_mismatch` from Google | `APP_URL` and the OAuth client's callback URI match exactly |
| Google says access blocked | Your account is a test user, API is enabled, scopes are configured, and Workspace admin allows the app |
| Connection cannot finish | Database is reachable, migration is applied, encryption key decodes to 32 bytes, and all Calendar permissions were approved |
| Neon connection or migration fails | Copy the direct URL from Neon again; check the branch, database, role, password, and supplied SSL parameters, then restart the app |
| Tables are missing in Neon | Run `npm.cmd run db:migrate` and make sure SQL Editor uses the same branch and database as `DATABASE_URL` |
| Tasks access denied or reconnect banner | Enable Google Tasks API, add the Tasks scope in Data Access, and reconnect each user with all requested permissions |
| Google connection fails after consent | The page now identifies the failing step: OAuth exchange, identity verification, database, Calendar setup, or Tasks setup. Server logs include only the step and a safe reason code, never raw OAuth errors or tokens |
| Google Task link uncertain | Use Sync Google to recover the prior write; avoid manually submitting the same task again |
| Calendar session review needed | The event was removed or converted to unsupported timing; inspect Google Calendar and the linked Google Task |
| Reconnect requested | Google refresh token expired/revoked; connect again |
| Availability cannot be read | All selected calendars remain accessible; an unreadable calendar is never treated as free |
| Dedicated calendar missing | Restore the original Right Now calendar in Google Calendar; the app does not silently replace it |
| Task has no slot | Check continuous duration, deadline, selected calendars, working hours, and sleep |

See the original [Milestone 1 architecture](docs/architecture.md) and [Milestone 2 additions](docs/milestone-2.md) for beginner-friendly explanations of the folder structure, schema, security, and boundaries.
