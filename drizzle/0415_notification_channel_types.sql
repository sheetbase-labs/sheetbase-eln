-- PIPE-05.1 — a notification destination is a typed channel.
--
-- A subscription today is a webhook: a URL that receives a signed JSON body. The design's
-- Teams destination is also a URL, but it is not the same thing — a Teams incoming webhook
-- expects a message card, not an arbitrary signed payload, and it does not verify a signature.
-- Without a type, the delivery engine would post a payload Teams cannot render and report it
-- as delivered.
--
-- So the type is stored. `webhook` stays the default, so every existing subscription keeps
-- exactly the behaviour it has today, and `teams` selects the card body. The destination URL
-- and its signing secret are unchanged: they already live on the subscription and in
-- internal.webhook_secrets, which is what "configured once per workspace as a connector
-- secret" means here.
--
-- The email channel is not added: it needs a transport, and there is none. WORK-03 has an
-- in-app notification model (api.my_notifications) but no outbox and no mail transport, so an
-- `email` type would be a value nothing could deliver. Recording that as a type would be worse
-- than leaving it out, because a destination that silently never sends is exactly the failure
-- this step exists to prevent.

ALTER TABLE api.webhook_subscriptions
  ADD COLUMN channel_type text NOT NULL DEFAULT 'webhook';
--> statement-breakpoint
ALTER TABLE api.webhook_subscriptions
  ADD CONSTRAINT chk_webhook_subscriptions_channel_type
  CHECK (channel_type IN ('webhook', 'teams'));
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
