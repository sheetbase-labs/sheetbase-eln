---
id: subtask-325
title: PIPE-05.1 — Channel types
type: subtask
status: todo
priority: low
created: "2026-09-27"
updated: "2026-09-27"
parent: task-324
tags:
  - PIPE-05.1
  - PIPE
---

# PIPE-05.1 — Channel types

Step 1 of 3 in [PIPE-05](../../tasks/PIPE.md#pipe-05--notification-channels); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: done. The email channel is implemented. api.webhook_subscriptions.channel_type now accepts 'email' (drizzle/0418_email_notification_channel.sql) and carries a nullable recipient_user_id that is required for email and forbidden otherwise; url became nullable for email only, keeping 0147's https and 2048-character rules for every other type. create_webhook_subscription takes p_channel_type and p_recipient_user_id, requires the recipient to be a member of the workspace being configured, refuses a URL on an email destination and a recipient on a webhook one, and returns no signing secret for email because an outbox row is not a signed request; the 9-argument overload is dropped, since CREATE OR REPLACE with a longer list makes an overload and would have left every existing 9-argument caller on the old signature. pipeline-notifications.server.ts enqueues an internal.email_deliveries row for an email destination, reading the address from the recipient's account so a changed address is not a stale copy in the destination, and emailMessage in notification-channels.ts is the subject-and-body template the step asks for. Verified with tests/db/email-notification-channel.test.ts (6 tests: configuration, no recipient, URL on email, recipient outside the workspace, recipient on a webhook, and the https rule still holding) plus the 8 channel-template units and the existing 47 webhook admin/DB tests; unit suite 390 files / 4043 tests.
  - 2026-10-10: CORRECTION to the earlier note - the email outbox does exist, and so does a transport. internal.email_deliveries (drizzle/0204_email_outbox.sql) is the durable queue, mirroring the webhook retry model, and src/lib/email-delivery.server.ts drains it (processEmailDeliveries, readSmtpConfig, createSmtpTransport); .env.example documents SMTP_HOST and friends with 'leave SMTP_HOST empty to disable email delivery; the outbox still records pending deliveries'. The earlier note said no outbox and no transport existed, which was wrong. What is actually blocking the email channel is a shape mismatch, not a missing dependency: the outbox is keyed by *person* (user_id plus to_email, both NOT NULL, with user_id a foreign key to internal."user"), while a notification subscription is keyed by a URL - so an email channel cannot be a subscription with a different channel_type, because it has nobody to send to. The decision that unblocks it: who an email notification goes to. The natural answer, and the one PIPE-05.2 already uses for the inbox item, is the pipeline's owner (api.pipeline_definitions.created_by_user_id), with the subscription naming the person or the config naming the owner; the message template is then a subject and body rather than a card.
  - 2026-10-10: partially implemented; stays open on the email channel. The Teams half and the message templates are in: api.webhook_subscriptions gains channel_type ('webhook' | 'teams', default 'webhook' so every existing subscription keeps its behaviour), and channelBody picks the body - the signed event payload for a webhook, a message card for Teams (src/lib/notification-channels.ts), with the notify path selecting the type. The destination URL and its signing secret are unchanged: they already live on the subscription and in internal.webhook_secrets, which is what 'configured once per workspace as a connector secret' means here. The type is stored rather than guessed because the same URL shape means different things and Teams answers 400 for a card it cannot render, which the delivery engine cannot tell from a transient failure. Five tests on the body selection and the card. NOT done: the email channel, because there is no transport for one. WORK-03 has an in-app notification model (api.my_notifications) but no outbox table and no mail transport, so an 'email' type would be a value nothing could deliver - and a destination that silently never sends is exactly the failure this step exists to prevent. Adding it needs a transport decision, not a type value.
