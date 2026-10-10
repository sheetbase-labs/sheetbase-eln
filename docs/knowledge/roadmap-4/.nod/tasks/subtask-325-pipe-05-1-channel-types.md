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
  - 2026-10-10: CORRECTION to the earlier note - the email outbox does exist, and so does a transport. internal.email_deliveries (drizzle/0204_email_outbox.sql) is the durable queue, mirroring the webhook retry model, and src/lib/email-delivery.server.ts drains it (processEmailDeliveries, readSmtpConfig, createSmtpTransport); .env.example documents SMTP_HOST and friends with 'leave SMTP_HOST empty to disable email delivery; the outbox still records pending deliveries'. The earlier note said no outbox and no transport existed, which was wrong. What is actually blocking the email channel is a shape mismatch, not a missing dependency: the outbox is keyed by *person* (user_id plus to_email, both NOT NULL, with user_id a foreign key to internal."user"), while a notification subscription is keyed by a URL - so an email channel cannot be a subscription with a different channel_type, because it has nobody to send to. The decision that unblocks it: who an email notification goes to. The natural answer, and the one PIPE-05.2 already uses for the inbox item, is the pipeline's owner (api.pipeline_definitions.created_by_user_id), with the subscription naming the person or the config naming the owner; the message template is then a subject and body rather than a card.
  - 2026-10-10: partially implemented; stays open on the email channel. The Teams half and the message templates are in: api.webhook_subscriptions gains channel_type ('webhook' | 'teams', default 'webhook' so every existing subscription keeps its behaviour), and channelBody picks the body - the signed event payload for a webhook, a message card for Teams (src/lib/notification-channels.ts), with the notify path selecting the type. The destination URL and its signing secret are unchanged: they already live on the subscription and in internal.webhook_secrets, which is what 'configured once per workspace as a connector secret' means here. The type is stored rather than guessed because the same URL shape means different things and Teams answers 400 for a card it cannot render, which the delivery engine cannot tell from a transient failure. Five tests on the body selection and the card. NOT done: the email channel, because there is no transport for one. WORK-03 has an in-app notification model (api.my_notifications) but no outbox table and no mail transport, so an 'email' type would be a value nothing could deliver - and a destination that silently never sends is exactly the failure this step exists to prevent. Adding it needs a transport decision, not a type value.
