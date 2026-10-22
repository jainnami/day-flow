# Milestone 1 acceptance tests

The PRD's full acceptance list spans multiple milestones. This checklist narrows it to the Calendar-only slice. In particular, Google Task linkage from AC01/AC03, completion, event synchronization, split allocation, LLM handling, and check-in behavior are deferred. A Calendar work event and a Google Task are distinct objects.

## Five acceptance scenarios

| ID | Scenario and expected result | Automated evidence | Live check still required |
| --- | --- | --- | --- |
| M1-01 | Sign in with Google; reject denied or invalid consent; disconnect removes local token access and all sessions | OAuth browser tests, encryption/origin tests | Real consent, dedicated calendar creation/reuse, token refresh, disconnect/reconnect |
| M1-02 | A 14:00–15:00 busy event in any selected calendar prevents overlap; existing Right Now work also blocks time | Scheduler, adapter and service tests | Actual Google busy results, including all-day and recurring events |
| M1-03 | Choose the earliest full session in working hours, outside sleep, ending by the deadline | More than five automated scheduling tests, including timezone/DST cases | Account timezone and exact event times in Google UI |
| M1-04 | Create one ordinary Google event, persist task/event mapping, survive refresh, and recover repeated submission without a duplicate | Service tests, SQL repository tests, structured form tests | Real database persistence, concurrent requests, uncertain write recovery |
| M1-05 | Invalid inputs, insufficient availability and API failures produce clear results without false success | Validation, service, adapter and UI tests | Real revoked-access and inaccessible-calendar behavior |

## Automated checks

Run `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, then `npm.cmd run test:e2e`.

The Vitest suite covers deterministic placement, overlapping/unsorted intervals, all-day busy time, exact deadlines, insufficient continuous time, working/sleep boundaries, DST changes, half-hour timezones, input validation, no-location input, repeat submission IDs, recovery after an uncertain Google write, changed availability, Google errors, encryption/tampering, origin checks, SQL persistence/ownership, and signed-in form/settings interactions.

The Playwright suite runs desktop and mobile Chrome against the built app with fake OAuth configuration. It checks welcome layout, absence of page errors/overflow, session-protected routes, foreign-origin rejection, OAuth state/PKCE, state rejection, and denied consent. It does not sign into Google or use real credentials. SQL tests use pg-mem, not a live PostgreSQL server.

## Manual account-backed walkthrough

Use your development account and a disposable test calendar so the behavior is easy to inspect.

1. Complete README setup, run migrations, and start the app at its configured `APP_URL`.
2. Connect Google and approve all Calendar scopes. Confirm exactly one app-owned **Right Now** calendar is created. Sign out/in again and confirm the same calendar is reused.
3. Select your primary and test calendars. Verify timezone and working/sleep hours. Put a busy event from 14:00–15:00 tomorrow in the test calendar. Fill the earlier allowed hours with busy time so 15:00 is the earliest full one-hour opening.
4. Enter a 60-minute task due tomorrow after 16:00. Confirm Right Now schedules 15:00–16:00, and Google Calendar shows an ordinary opaque event with exactly those times in Right Now. It should not create a Google Task.
5. Refresh the browser, then restart the server and revisit. Confirm the task persists. Inspect `tasks` and `work_sessions` in the database: user IDs, dedicated calendar ID, event ID, and UTC start/end must match.
6. Submit a 180-minute task when only a 60-minute continuous gap remains before its deadline. Confirm unscheduled state, all 180 minutes unallocated, and no event for that task. Milestone 1 deliberately does not split effort.
7. Set work hours overlapping sleep and try another task. Confirm no session enters protected sleep. Try an invalid/past deadline and confirm a useful error. Verify displayed times in a second timezone.
8. For recovery, simulate a dropped response after a Google event write. Use **Check previous submission** in the original tab. Confirm it returns the original event ID and no duplicate. With the real PostgreSQL database, also issue concurrent requests for one user and verify row locking serializes scheduling.
9. Revoke the app in Google Account settings, then try scheduling. Confirm a reconnect error and no false scheduled state. Reconnect and verify existing mappings remain. Deny consent on a fresh attempt and confirm a recoverable message.
10. Disconnect in settings. Confirm `oauth_connections` and all this user's `app_sessions` are removed, prior session cookies no longer authorize APIs, and existing calendar events remain. If Google revocation fails, confirm the app displays the manual revocation instruction.

Do not mark Milestone 1 verified end to end until this walkthrough has passed with a live PostgreSQL database and Google account. The automated tests establish local behavior and API contracts with controlled inputs.
