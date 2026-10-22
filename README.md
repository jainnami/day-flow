# Right Now

Milestone 1 of the supplied Right Now v0.1 PRD: a student enters a structured task, and the app finds one feasible work session in Google Calendar. Built with Next.js App Router, TypeScript, and PostgreSQL.

The code includes Google sign-in, calendar selection, editable working/sleep hours and timezone, a deterministic scheduler, ordinary Calendar event creation, persisted task/event links, and a task list. Google Tasks, completion sync, natural-language parsing, split sessions, check-ins, and rescheduling are outside this milestone.

## Start here

You need Node.js 22 or newer, a Google account, and a PostgreSQL database. Development was checked with Node 24.13.1. The commands below use `npm.cmd` because Windows PowerShell can block `npm.ps1`.

```powershell
Set-Location -LiteralPath "C:\Users\tanul\Tanu academics\Columbia\Fall '26\PM with AI\Capstone"
npm.cmd ci
Copy-Item .env.example .env.local
```

Open `.env.local` in your editor. It contains secrets, so it is excluded from Git. Do not paste credentials into chat or commit them. Generate the encryption key once and put its output in `TOKEN_ENCRYPTION_KEY`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep this key stable. Changing it makes existing encrypted Google tokens unreadable, requiring reconnection.

## Configure Google Cloud

Google Cloud supplies this app's sign-in credentials and permission to use Calendar. It does not need to host the app or database. No service account, Tasks API, LLM API, Cloud Scheduler, or background worker is needed for this milestone.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a development project, for example `right-now-dev`.
2. In **APIs & Services → Library**, enable **Google Calendar API**.
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

6. Under **Clients**, create an OAuth client with application type **Web application**.
7. Add authorized JavaScript origin `http://localhost:3000` and authorized redirect URI `http://localhost:3000/api/auth/google/callback`. The redirect URI must match exactly. The server-side flow uses the redirect URI; it does not put Google's client secret in browser code.
8. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env.local`.
9. Set `APP_URL=http://localhost:3000`. Open the app using that same hostname and port. If you change it, update Google's redirect URI too.

On first connection, approve all requested permissions. Partial consent is rejected clearly. Google issues offline refresh tokens so the server can renew access; tokens for External apps in Testing generally expire after seven days, so reconnect when prompted. Public distribution may require Google verification depending on the scopes and audience. See [Google's scope reference](https://developers.google.com/workspace/calendar/api/auth) and [OAuth token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Configure PostgreSQL

Use a local PostgreSQL database or an existing hosted PostgreSQL provider. A database is where tasks and their Google event links survive server restarts. You do not need a separate authentication product or a browser database SDK.

For a hosted database, copy its **server-side PostgreSQL connection string** into `DATABASE_URL`. Keep any TLS parameters supplied by the provider. Use a direct or session connection suitable for transactions and row locks. For local PostgreSQL, create a database named `right_now` and use:

```dotenv
DATABASE_URL=postgresql://YOUR_DB_USER:YOUR_URL_ENCODED_PASSWORD@localhost:5432/right_now
```

If your password includes reserved URL characters, percent-encode them. Use a dedicated database and an application role with access to its tables. The browser never connects directly to PostgreSQL. Queries use parameters and filter by the authenticated user's ID.

Apply the schema:

```powershell
npm.cmd run db:migrate
```

This command reads `.env.local`, applies unapplied SQL migrations in order, and records them in `schema_migrations`. Repeating it safely skips completed migrations. Do not edit an already-applied migration; add a new numbered SQL file instead.

## Run the app

```powershell
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). The public welcome screen also works without credentials and explains setup. Scheduling requires completed setup.

1. Click **Connect Google Calendar** and approve access.
2. Open **Calendar & hours**. Verify your timezone, working/sleep hours, and calendars. Defaults are `America/New_York`, working 09:00–18:00, sleep 23:00–07:00, and your primary calendar. The dedicated Right Now calendar is always included in availability checks.
3. Enter a title, duration in minutes, and a deadline in the displayed timezone. Click **Find a time & schedule**.
4. See the saved task and its scheduled time. Open Google Calendar and verify the ordinary event in the **Right Now** calendar.
5. Refresh the page to confirm the task/event mapping persisted.

Working hours must start and end on the same local day; sleep can cross midnight. All days of the week are eligible. Durations range from 5 to 720 minutes; deadlines must be future times within 90 days. Each task needs a single continuous slot. Scheduling starts at the next whole minute, with no buffer. If no slot fits, the task is saved as unscheduled and all its minutes are reported as unallocated. To try different inputs for such a task, create a new task; there is no reschedule action yet.

The deadline field uses the selected account timezone, even if your computer uses another timezone. UTC timestamps identify exact moments in storage. Invalid or ambiguous local deadlines around clock changes are rejected so the app does not silently choose a different deadline.

**Refresh list** reloads stored results. It does not sync event moves/deletions from Google; that is Milestone 2. Calendar remains the authority for current event times. **Sign out** ends this app session. **Disconnect Google Calendar**, in settings, removes saved OAuth access, ends all account sessions, and attempts Google token revocation. Existing tasks and Google events remain. If revocation cannot be confirmed, follow the displayed instruction to remove access in your Google Account.

## Recover an interrupted submission

If a connection fails after you click Schedule, Google may already have created the event. Use **Check previous submission** in the same browser tab. The app remembers the submission ID in session storage and uses a stable Google event ID to recover the prior write. Do not start a new submission for the same task while its outcome is uncertain.

Validation failures allow correcting the form immediately. Unexpected failures keep the submission ID for recovery. If a persisted task shows an error after reopening a different tab, use **Check this task’s status** on its task card. This recovers the same request; it is not an action to move an already scheduled task.

## Run checks

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The browser suite starts the built app on port 3100 with fake test credentials and no database. It uses installed Google Chrome and verifies the public UI, protected endpoints, OAuth state/PKCE, denied consent, and mobile overflow. If Chrome is unavailable, install Playwright's Chromium (`npx.cmd playwright install chromium`) and remove `channel: "chrome"` from the two projects in `playwright.config.ts`.

Unit/service tests run without Google or PostgreSQL credentials. UI tests exercise the signed-in dashboard with mocked API responses. SQL tests execute the migration and repository queries using **pg-mem**, a PostgreSQL emulator. They do not prove real PostgreSQL locking or live Google interoperability. The account-backed manual checks in [the acceptance checklist](docs/acceptance-tests.md) are required before calling Milestone 1 verified end to end.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Setup message on welcome screen | All five variables have real values; restart the dev server after changing them |
| `redirect_uri_mismatch` from Google | `APP_URL` and the OAuth client's callback URI match exactly |
| Google says access blocked | Your account is a test user, API is enabled, scopes are configured, and Workspace admin allows the app |
| Connection cannot finish | Database is reachable, migration is applied, encryption key decodes to 32 bytes, and all Calendar permissions were approved |
| Reconnect requested | Google refresh token expired/revoked; connect again |
| Availability cannot be read | All selected calendars remain accessible; an unreadable calendar is never treated as free |
| Dedicated calendar missing | Restore the original Right Now calendar in Google Calendar; the app does not silently replace it |
| Task has no slot | Check continuous duration, deadline, selected calendars, working hours, and sleep |

See [architecture](docs/architecture.md) for beginner-friendly explanations of the folder structure, schema, security, and boundaries.
