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
  - 2026-10-10: partially implemented; stays open on the email channel. The Teams half and the message templates are in: api.webhook_subscriptions gains channel_type ('webhook' | 'teams', default 'webhook' so every existing subscription keeps its behaviour), and channelBody picks the body - the signed event payload for a webhook, a message card for Teams (src/lib/notification-channels.ts), with the notify path selecting the type. The destination URL and its signing secret are unchanged: they already live on the subscription and in internal.webhook_secrets, which is what 'configured once per workspace as a connector secret' means here. The type is stored rather than guessed because the same URL shape means different things and Teams answers 400 for a card it cannot render, which the delivery engine cannot tell from a transient failure. Five tests on the body selection and the card. NOT done: the email channel, because there is no transport for one. WORK-03 has an in-app notification model (api.my_notifications) but no outbox table and no mail transport, so an 'email' type would be a value nothing could deliver - and a destination that silently never sends is exactly the failure this step exists to prevent. Adding it needs a transport decision, not a type value.
