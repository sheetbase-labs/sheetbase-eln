# WORK — Home, Inbox, Schedule and Notifications

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#work) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below. WORK-01 is a dependency for Home, Inbox, the phone Inbox and navigation counts.

## Programme goal

Give each person one trustworthy list of what is waiting on them, a home page
built from it, a schedule of their bookings, and notifications they control.

## Baseline at `main` `9538f36`

- `/` renders a dashboard from `src/lib/dashboard-data.ts`.
- `collaboration/notification-inbox.tsx` shows Liveblocks inbox notifications
  (comments and mentions). There is no server-side model of work waiting on a
  person across reviews, data issues, runs, signatures and materials.
- `/reviews` lists review submissions; `/calendar` shows `calendar_bookings`.
- Durable `change_events` and outbound `webhook_deliveries` exist. There is no
  per-user notification preference, email transport, digest or quiet hours.

## WORK-01 — Work items

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#work-01).

**Original decision/dependency note:** Original proposal.

### Goal

A server-side, permission-safe list of items that need a person's action or
that they follow.

### Design

`canvas/HomeTriage.dc.html`, `canvas/InboxEmpty.dc.html`, `canvas/PhoneInbox.dc.html`.

### Scope

- Kinds: review requested, signature requested, data issue (validation error,
  missing unit, out-of-range value), run waiting for a person (PIPE-02), run
  failed, material or sample expiring, model or protocol awaiting approval,
  conflict to resolve.
- States: needs action, following, done today; due dates and grouping (today,
  next 7 days, later); type filter counts.
- Derived from canonical state where possible (a review item exists while the
  submission is assigned and open), stored only where there is no source of
  truth (follow, dismiss). RLS enforced.
- Change events keep the list live.
- Liveblocks notifications remain for comment/mention delivery only.

### Start here

- Sources of work today: `api.review_submissions` (`assigned_reviewer_user_ids`,
  `state`, `submitted_at`; **no due date**), `src/lib/reviews.ts`,
  `src/lib/dashboard-data.ts` (`fetchMyPendingReviews`, `isReviewDueSoon`,
  `fetchMyMentions`), validation state on sheets/datasets
  (`src/lib/canonical-sheet-grid.ts`, dataset validation in `src/lib/`),
  `api.pipeline_runs.status`, reagent expiry in `src/lib/reagent-data.ts`,
  `api.change_events` for "done today".
- Pattern for a derived, RLS-safe read: a `security_invoker` view in `api`
  (see "Object conventions" in `docs/development/database-access.md`).
- Design: render `HomeTriage`, `InboxEmpty`, `PhoneInbox`; read
  `screen-text/HomeTriage.txt` for every item type and wording.

### Steps (PRs)

1. **Due dates.** Add `due_at` to review submissions (set from the project's
   default review period, overridable at submit), expose it in the review RPCs
   and `reviews.ts`. DB test.
2. **Work item view.** `api.my_work_items` (security invoker) unioning the
   sources that exist today: reviews assigned to me, validation errors on
   records I own, failed runs of pipelines I own, reagents/materials expiring
   in my projects. Columns: `kind`, `record_id`, `identifier`, `title`,
   `project_id`, `reason`, `due_at`, `state` (`needs_action | following | done_today`).
   DB tests: success, other workspace sees nothing, viewer sees only readable
   records.
3. **Follow and dismiss.** `api.work_item_follows` (user, record) with RLS
   own-rows; RPCs `follow_record`, `unfollow_record`; following items appear in
   the view.
4. **Later kinds.** Signature requests (REV-02), data issues from flags
   (DSET-01), runs waiting (PIPE-02), approvals (MDL-03, LAB-07), conflicts
   (EXP-05) are added to the view by those tasks; each of their step lists
   says so.
5. **Data module.** `src/lib/work-items/data.ts` with query keys, grouping
   (today, next 7 days, later) and type counts; invalidated by change events
   (`src/lib/live-events.ts`).

### Check it

`pnpm test:db work-items`, `pnpm test src/lib/work-items`; the view returns
Gareth P.'s items for the design seed.

### Exit

For the seeded scenario the Inbox shows exactly the design's items for Gareth
P.; completing the underlying action removes the item without a manual
dismiss; a user never sees an item for an object they cannot read.

## WORK-02 — Home and Inbox pages

**Status (2026-10-02):** done; nod `done` — closed 2026-10-02 by `468b7e95` (see [update since the 2 October audit](../RECONCILIATION.md#update-since-this-audit)). [Evidence and remaining work](../RECONCILIATION.md#work-02).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/Main.dc.html`, `canvas/HomeFirstRun.dc.html`, `canvas/HomeTriage.dc.html`,
`canvas/InboxEmpty.dc.html`, `canvas/HelpRecords.dc.html`.

### Scope

- Home: date line, counts, awaiting your review, continue working (recently
  viewed/edited), today's bookings, needs attention, recent activity.
- First run: setup checklist (signature, first project, first experiment),
  your projects, people to know, help links.
- Inbox: tabs, type filter, grouped list with J/K, inspector with the review
  summary, changes since last review and open comment; empty state with
  coming-up and done today.
- Help page for records, reviews and signatures.

### Start here

`src/routes/index.tsx` (1,631 lines, current dashboard), `src/lib/dashboard-data.ts`,
`src/routes/reviews.tsx` (982 lines, review inbox), `src/lib/recents.ts`
(continue working), `src/lib/calendar.ts` (today's bookings),
`tests/browser/reviews-inbox.test.ts`.

### Steps (PRs)

1. Home (`/`): rebuild against `Main` using WORK-01 counts and lists,
   `recents.ts`, today's bookings and change events for recent activity.
   Delete superseded dashboard code in `index.tsx` and unused
   `dashboard-data.ts` functions.
2. First-run state (`HomeFirstRun`): shown when the user has no recents; setup
   checklist items read real state (signature certified, project membership,
   experiments created).
3. Inbox route `/inbox` with tabs, type filter, J/K navigation (SHELL-03),
   inspector summary; empty state (`InboxEmpty`). Delete `/reviews` list and
   point its links to `/inbox`.
4. Help page (`HelpRecords`) as a static route with the design copy.

### Check it

Component tests for each state; update `tests/browser/reviews-inbox.test.ts`
to the new route; parity for `Main`, `HomeFirstRun`, `HomeTriage`,
`InboxEmpty`, `HelpRecords`.

### Exit

Home, first-run and Inbox match their design screens on seeded data; the old
dashboard and `/reviews` list are deleted.

## WORK-03 — Notifications and preferences

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#work-03).

**Original decision/dependency note:** Original proposal.

### Design

Notifications popover in `canvas/Main.dc.html`; `canvas/SettingsNotifications.dc.html`;
`design-system/components/Notifications/README.md`.

### Scope

- Bell popover over WORK-01 events: unread dot, mark all read, link to Inbox
  and settings, each row linking to its record.
- Per-user preferences per event × channel (in app, email, daily digest);
  quiet hours; digest time; reviews due today and signature requests always
  delivered.
- Email transport with templates and an outbox (reusing the webhook delivery
  retry model); per-workspace sender configuration.

### Start here

Bell today: `src/components/collaboration/notification-inbox.tsx` (Liveblocks
inbox, 471 lines). Outbox pattern to copy: `api.webhook_deliveries` and
`src/lib/webhook-delivery.ts` (attempts, backoff, `next_attempt_at`).
Design: `SettingsNotifications`, the notifications popover in `Main`.

### Steps (PRs)

1. `api.notification_preferences` (user, event type, in_app, email, digest)
   with own-row RLS, quiet hours and digest time on `user_preferences`
   (SHELL-02); RPC to save; settings page `SettingsNotifications`.
2. `internal.notifications` written by a trigger on `api.change_events` for
   the eight design event types, addressed to the right people; read view
   `api.my_notifications`; mark-read RPC.
3. Bell popover reading `my_notifications` (unread dot, mark all read, rows
   linking to records). Liveblocks stays only for comment threads.
4. Email outbox `internal.email_deliveries` + server worker
   (`src/lib/email-delivery.server.ts`) reusing backoff from
   `webhook-delivery.ts`; SMTP settings from environment (`.env.example`
   entries, no secrets committed); templates per event; quiet hours hold
   non-urgent email; daily digest job.

### Check it

DB tests for addressing and preference filtering; unit tests for quiet-hours
and digest scheduling; the email transport faked at the adapter in tests.

### Exit

Each of the eight design event types can be routed to each channel; emails are
sent through a durable outbox and are auditable; quiet hours hold email but
not in-app items.

## WORK-04 — Schedule

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#work-04).

**Original decision/dependency note:** booking checks depend on LAB-06.

### Design

`canvas/HomeBench.dc.html`, `canvas/ScheduleEmpty.dc.html`, book-instrument
dialog in `canvas/DialogsRecord.dc.html`, `design-system/components/Calendar/README.md`.

### Scope

Day/week timeline of instruments and your bookings with the current-time line
and unavailable hours hatched; my active experiments with next step and
blocking issue; reviews due; materials for today. Booking dialog shows the
clash and offers the next free slot, and shows qualification and calibration
status (LAB-06).

### Start here

`src/routes/calendar.tsx`, `src/lib/calendar.ts`, `src/components/calendar/`
(booking dialog, filters, inspector), `src/components/reui/event-calendar`,
`tests/db/calendar.test.ts` (overlap detection exists).

### Steps (PRs)

1. `/schedule` route: day/week timeline (instrument rows, current-time line,
   hatched unavailable hours from resource availability), my active
   experiments, reviews due (WORK-01), materials for today. Delete `/calendar`
   after moving any capability it has that the design keeps.
2. Booking dialog: clash shown before booking with "next free slot" computed
   server-side (`api.next_free_slot(resource, from, duration)`), qualification
   and calibration status from LAB-06; booking refused on the server when the
   user is not qualified or calibration has lapsed.

### Check it

DB tests for next-free-slot and refusal reasons; parity for `HomeBench`,
`ScheduleEmpty` and the booking dialog in `DialogsRecord`.

### Exit

`/schedule` replaces `/calendar`; a clash is shown before booking; bookings for
an instrument the user is not qualified on, or whose calibration has lapsed,
are refused with the reason.
