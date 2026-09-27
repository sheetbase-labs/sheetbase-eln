# WORK — Home, Inbox, Schedule and Notifications

**Status (2026-09-27):** Proposed; not assigned. WORK-01 is a dependency for Home, Inbox, the phone Inbox and navigation counts.

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

**Status:** proposed.

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

### Exit

For the seeded scenario the Inbox shows exactly the design's items for Gareth
P.; completing the underlying action removes the item without a manual
dismiss; a user never sees an item for an object they cannot read.

## WORK-02 — Home and Inbox pages

**Status:** proposed.

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

### Exit

Home, first-run and Inbox match their design screens on seeded data; the old
dashboard and `/reviews` list are deleted.

## WORK-03 — Notifications and preferences

**Status:** proposed.

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

### Exit

Each of the eight design event types can be routed to each channel; emails are
sent through a durable outbox and are auditable; quiet hours hold email but
not in-app items.

## WORK-04 — Schedule

**Status:** proposed; booking checks depend on LAB-06.

### Design

`canvas/HomeBench.dc.html`, `canvas/ScheduleEmpty.dc.html`, book-instrument
dialog in `canvas/DialogsRecord.dc.html`, `design-system/components/Calendar/README.md`.

### Scope

Day/week timeline of instruments and your bookings with the current-time line
and unavailable hours hatched; my active experiments with next step and
blocking issue; reviews due; materials for today. Booking dialog shows the
clash and offers the next free slot, and shows qualification and calibration
status (LAB-06).

### Exit

`/schedule` replaces `/calendar`; a clash is shown before booking; bookings for
an instrument the user is not qualified on, or whose calibration has lapsed,
are refused with the reason.
