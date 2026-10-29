# Notifications, Inbox and email

One list of events decides what a person can mute or email. It sits behind the
Inbox, the bell, email, the daily digest and Settings > Notifications.

## The list

`NOTIFICATION_EVENTS` in `src/lib/notification-preferences.ts` names each event,
its label and group, whether email is on by default, and its `source`:

- `notification`: a row is written to `internal.notifications` when it happens
  (a review is requested, a comment arrives). The bell, email and the digest
  all follow that row.
- `inbox`: the item only exists as a derived Inbox row (a run failed, a
  calibration fell due, an access request). There is no row to follow, so email
  comes from a sweep.

`api.notification_events` holds the same keys, the Inbox kinds each event
covers (`inbox_kinds`) and the email default. Preferences point at it, and
`tests/db/notify-events.test.ts` fails when code and database drift.

## What each choice does

- **In app off** mutes the event. `api.my_work_items` (which the Inbox list,
  its counts and Home all read) leaves out the Inbox kinds the event covers,
  and `api.my_notifications` leaves out its notifications.
- **Email on** queues an email. For a `notification` event, an insert trigger
  on `internal.notifications` queues it. For an `inbox` event the email
  scheduler runs `sweepInboxEmails` (`src/lib/inbox-email.server.ts`) as each
  subscriber and queues one email per new item. The first sweep after Email is
  turned on only records what is waiting, so nobody is sent a backlog.
- **Daily digest** lists the unread `notification` events ticked for it. For
  Inbox-only events the same sweep records each new item in
  `internal.inbox_digest_items`, and the digest reads those too. Like email,
  the first sweep after ticking an event only learns what is already waiting.

The outbox (`internal.email_deliveries`) holds email through quiet hours and
retries it. A pending email older than three days is marked dead, so setting up
SMTP later does not send old mail. Email is only sent when the server has SMTP
configured; Settings > Notifications says when it does not.

## Adding an event

1. Add it to `NOTIFICATION_EVENTS` and to `api.notification_events` in a new
   migration (with the `inbox_kinds` it covers).
2. For a `notification` event, write the row where it happens
   (`internal.notify_from_change_event`) and check
   `internal.notification_recipient_enabled`.
3. A new Inbox kind must appear in some event's `inbox_kinds`; the test above
   fails otherwise.

## Webhooks

Webhooks use the event catalogue (`src/lib/event-catalogue.ts`), not this list.
See [`docs/api/event-catalogue.md`](../api/event-catalogue.md).
