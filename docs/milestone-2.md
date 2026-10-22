# Milestone 2 linked completion

Milestone 2 adds a Google Task for each logical Right Now task and reconciles completion, deletion and Calendar edits. Google Tasks owns completion; Calendar owns exact session times; PostgreSQL owns the original task metadata and both object links. Natural language, AI priority ordering, splitting, check-ins, cron, and automatic rescheduling remain for later milestones.

## Upgrade and account setup

Enable **Google Tasks API** in the existing Google Cloud project, add `https://www.googleapis.com/auth/tasks` in Google Auth Platform Data Access, apply `002_linked_completion.sql` with `npm.cmd run db:migrate`, and reconnect each account. The existing five environment variables stay the same. Keep the encryption key stable, especially when local and hosted instances use the same database. Existing Calendar-only sessions show a reconnect banner and cannot submit or sync until Tasks consent is granted.

Google's Tasks write scope permits access to all the user's Tasks; the API does not provide an app-created-only equivalent to Calendar's narrow scope. Our adapter confines operations to the stored dedicated app list and stored task IDs. The app creates a list called `Right Now (account marker)`; the marker is derived from the OAuth client and internal user ID. It recovers this list on reconnect and does not silently recreate a stored list that was deleted.

## Modules and schema

The subsequent `003_optional_deadlines.sql` migration makes `due_at` and `deadline_local` nullable together. A blank form deadline is stored as null. Scheduling uses a 90-day search window for these tasks without treating its end as a deadline. The Google Task date is derived separately from the Calendar session, whether a deadline exists or not. Existing dated tasks and event links are preserved. Completion cleanup uses the Calendar session's current start time and works the same with or without a task deadline.

| Addition | What it does |
| --- | --- |
| `src/server/tasks/adapter.ts` | Lists, reads and creates Google Tasks, patches their dates and recovers marker-tagged Tasks |
| `src/lib/google-task-date.ts` | Computes the day after a Calendar session starts in the user's timezone |
| `src/server/services/link-task.ts` | Coordinates durable creation intent and recovery without blind repeat inserts |
| `src/server/services/sync-task.ts` | Reconciles completion/deletion and Calendar timing, and cleans up future sessions |
| `src/server/services/task-workflow.ts` | Connects the services to user-scoped transactions and the existing scheduler |
| `POST /api/sync` | Syncs a page of three tasks and returns a cursor; the UI continues until all pages finish |
| `002_linked_completion.sql` | Adds fields to the existing tables without removing Milestone 1 records |

`users` gains the dedicated Google task-list ID. `tasks` gains its Google list/task IDs, optional safe web link, link-attempt state and ID, completion time, last successful sync time, and sync error. Its status can now also be `completed`, `closed_deleted`, or `needs_review`. `work_sessions` gains a sync time and a state: `scheduled`, `elapsed`, `moved_externally`, `removed_externally`, or `canceled`. A unique user/list/task index prevents duplicate local mappings, and a constraint requires the two Google Task IDs together. The database still has six tables including migration tracking.

## Creation and interruption recovery

The task form supplies structured title and duration, with an optional deadline. The server first saves the logical task, then commits a creation intent in a short transaction. Only the invocation receiving that intent's ticket may insert a Google Task. Each Task includes a stable local-task marker on its own line in Google notes. Recovery searches all pages, including completed, hidden and deleted Tasks, before considering a write.

An interrupted write leaves a committed intent. A later request can recover the original Task by marker; it cannot blindly insert another one. If the outcome stays unknown, the task is visibly uncertain and needs further sync or manual investigation. An explicit rejected insert can be retried after fixing the permission/API issue. A read failure before insertion is also safe to retry. Multiple marker matches require review. Removing the marker can prevent recovery of an uncertain write.

Once the Task is linked, completion is checked before any interrupted Calendar scheduling attempt. Closed tasks and review-needed sessions never enter the scheduler. Calendar retries retain the original deterministic event ID. Existing Milestone 1 tasks are linked during sync while retaining their event IDs; sync never creates Calendar sessions.

User-row locks serialize writes for each account. The creation intent survives a later transaction rollback or a lost HTTP response. Existing user-scoped repositories and composite session foreign keys remain in force. Mutation endpoints validate both the session and request origin, and the new Tasks scope is checked server-side.

## Sync behavior

Sync runs on signed-in app open/reload and on **Sync Google**. GET routes remain read-only; browser auto-sync calls the authenticated POST endpoint. Paging covers tasks beyond the 100 most recent displayed cards. Partial failures are reported per task and do not erase saved links or imply completion.

| Google change | Right Now result |
| --- | --- |
| Linked Task completed | Task becomes completed; future app work sessions are canceled |
| Linked Task deleted or missing | Task becomes intentionally closed; future app sessions are canceled |
| Task API permission/network failure | Preserve state and links; show a sync error |
| Work event moved | Save current Google start/end on the existing mapping; retain original task title |
| Work event deleted/cancelled | Session becomes removed externally; open task needs review; no replacement event |
| Event becomes all-day | Preserve last saved timed session and require review; do not invent timed boundaries |
| Task completed after a session starts | Preserve the started session; elapsed sessions remain historical |
| Calendar cleanup fails | Persist task closure and show an error; later Sync retries cleanup |
| Task later unchecked/reopened in Google | Keep the already closed Right Now task closed; automatic reopening is outside this milestone |

Cleanup reads the current Google event times before deciding whether a session is future. It deletes only the stored app-created Calendar event, never unrelated commitments. A tiny external-edit race remains between reading and deletion; Calendar does not provide a transaction across both APIs. Deletion is repeatable: 404/410 after an earlier successful delete is safe. Historical start/end values remain visible and labeled even after removal/cancellation.

## Date and UI feasibility spike

Google Tasks `due` is date-only, and the API discards its time portion. A new Task is initially undated. After the Calendar session mapping commits, we patch only `due` to the day after the session's start day in the user's Right Now timezone, encoded as UTC midnight. We add a calendar day rather than 24 hours so DST is handled correctly. The original deadline stays unchanged in our DB and the Task's notes; a blank deadline remains null even when the Google Task receives a session-based date. Tasks without a work session stay undated. The Calendar event is the timed work session. Do not describe these as one native timed Google Task.

Sync applies the same rule to existing open Tasks and externally moved Calendar sessions, skipping already correct dates. It does not redate completed/deleted Tasks or infer dates for deleted/all-day events. A failed patch preserves the committed event mapping and reports a sync error; retrying Sync can update the date without creating another Task or event. No additional database migration or Google scope is needed for this date rule.

Automated adapter tests verify request shape, date-only behavior and completion/deletion handling. They do not prove the exact appearance in Google Calendar or Google Tasks. The account-backed UI spike below remains required after consent: verify which surfaces show the API-created Task, whether it appears on the intended local day, where to mark it complete, and what deletion returns. The separate Calendar block must remain visible independently.

## Acceptance checks

1. Upgrade an existing Milestone 1 database without losing its tasks/events. A Calendar-only user sees the reconnect banner; after consent the app stores a dedicated task list.
2. Submit a new task. Confirm one Google Task and one feasible Calendar event, with both IDs in the database. A no-slot task still has a Google Task and a visible scheduling shortfall.
3. Mark the linked Google Task completed in Google's UI, then sync. Confirm completion, canceled future event, preserved historical sessions, and no further scheduling on submission retry.
4. Move the Calendar event directly, then reopen the app or Sync Google. Confirm exact new times, a Google Task date on the day after the new session's local start day, unchanged IDs, unchanged original deadline/title, and no duplicate Task or event.
5. Delete only a Calendar event, then sync repeatedly. Confirm review-needed state, an open linked Google Task, and no replacement event. Repeat with all-day conversion.
6. Delete the Google Task or its list. Confirm intentional closure and future-session cleanup without recreating the Google Task/list.
7. Simulate a dropped response after Google Task creation. Confirm marker recovery or an explicit uncertain state, never a blind duplicate insertion. Retry a failed cleanup and confirm closure persists.
8. Verify another user cannot read/sync another user's tasks. Exercise more than three tasks to verify cursor paging and an individual API error to verify partial failure reporting.
9. Submit with the deadline blank. Confirm the earliest feasible session is scheduled within the next 90 days, the database keeps both deadline fields null, Google Tasks is dated the day after the session's local start day, and the app shows **No deadline**. Mark it completed and sync; its future work block should be canceled just like a dated task's block.
10. Submit with a deadline next week and an available session tomorrow. Confirm the Calendar event is tomorrow, Google Tasks is dated the following day, and the original deadline is unchanged. Sync an existing open task to correct its old deadline-based Google date. Test a date patch failure and retry: the Calendar mapping must persist without duplicate Google objects. A no-slot task must remain undated.

Run `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`, and `npm.cmd run test:e2e`. Unit/UI/adapter tests use controlled provider responses; SQL tests use pg-mem. Live Google consent and UI visibility checks need a real account. No automatic completion claim should replace that live verification.

References: [Google Tasks scopes](https://developers.google.com/workspace/tasks/auth), [Task fields and date semantics](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks), [listing hidden/completed/deleted Tasks](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list), and [Calendar event deletion](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete).
