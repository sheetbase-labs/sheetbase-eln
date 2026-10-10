---
id: subtask-120
title: WORK-03.4 — Email outbox internal.email_deliveries + server worker
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-116
tags:
  - WORK-03.4
  - WORK
---

# WORK-03.4 — Email outbox internal.email_deliveries + server worker

Step 4 of 4 in [WORK-03](../../tasks/WORK.md#work-03--notifications-and-preferences); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: internal.email_deliveries outbox (enqueue/claim/finish with exponential backoff and dead-letter) + src/lib/email-delivery.server.ts worker with an injected transport; DB and unit tests. SMTP transport, templates, quiet-hours hold and the digest job remain.
- 2026-09-28: PR #206: per-event email templates (renderEmail) and quiet-hours scheduling (nextSendAt; reviews/signatures always delivered) with unit tests. SMTP transport wiring and the digest job remain.
- 2026-09-28: PR #206: internal.enqueue_daily_digests — one digest email per user per day at their digest time (idempotent via digest_last_sent_on); DB test. Only the SMTP transport (needs a mail dependency/env) remains.
- 2026-09-28: PR #206: SMTP transport factory (readSmtpConfig + createSmtpTransport via optional nodemailer) and .env.example entries; unit test. Only wiring the worker/digest to a scheduled invocation remains.
- 2026-09-28: PR #206: email scheduler driver (unref interval: enqueue digests, then send due deliveries when SMTP configured) wired into the server start middleware like the pipeline scheduler. Remaining: apply quiet-hours nextSendAt when enqueuing non-urgent email.
- 2026-09-28: PR #206: quiet hours now enforced when claiming deliveries (internal.email_held_for_quiet_hours; reviews/signatures always delivered); DB test. WORK-03.4 complete: outbox, worker, templates, quiet hours, digest, SMTP transport, scheduled driver.
