-- PIPE-05.1 — the email channel.
--
-- The outbox and its transport already exist (drizzle/0204_email_outbox.sql,
-- src/lib/email-delivery.server.ts), so nothing has to be built to send mail. What the channel
-- needs is a recipient: internal.email_deliveries is keyed by person (user_id plus to_email),
-- while a notification subscription is keyed by a URL. An email destination therefore names a
-- person, and the address is read from their account rather than typed into the destination —
-- so a changed address is not a stale copy sitting in a subscription.
--
-- The check keeps the two shapes honest: a webhook or Teams destination needs a URL and no
-- recipient, an email destination needs a recipient. A destination with both, or neither, is a
-- configuration mistake rather than a choice.

ALTER TABLE api.webhook_subscriptions
  DROP CONSTRAINT chk_webhook_subscriptions_channel_type;
--> statement-breakpoint
ALTER TABLE api.webhook_subscriptions
  ADD CONSTRAINT chk_webhook_subscriptions_channel_type
  CHECK (channel_type IN ('webhook', 'teams', 'email'));
--> statement-breakpoint

-- A webhook destination is addressed by its URL, so the column was NOT NULL; an email
-- destination has no URL, and its address is the recipient's account. The paired check keeps
-- a URL where one is meaningful and refuses one where it is not.
ALTER TABLE api.webhook_subscriptions ALTER COLUMN url DROP NOT NULL;
--> statement-breakpoint
-- 0147 already constrains the URL to https and 2048 characters; this widens it rather than
-- replacing it, so a webhook destination keeps exactly the URL rules it had.
ALTER TABLE api.webhook_subscriptions DROP CONSTRAINT chk_webhook_subscriptions_url;
--> statement-breakpoint
ALTER TABLE api.webhook_subscriptions
  ADD CONSTRAINT chk_webhook_subscriptions_url CHECK (
    (channel_type = 'email' AND url IS NULL)
    OR (channel_type <> 'email' AND url ~ '^https://' AND length(url) <= 2048)
  );
--> statement-breakpoint

ALTER TABLE api.webhook_subscriptions
  ADD COLUMN recipient_user_id text REFERENCES internal."user"(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE api.webhook_subscriptions
  ADD CONSTRAINT chk_webhook_subscriptions_recipient CHECK (
    (channel_type = 'email' AND recipient_user_id IS NOT NULL)
    OR (channel_type <> 'email' AND recipient_user_id IS NULL)
  );
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
--> statement-breakpoint
-- PIPE-05.1 — let a destination be an email address rather than a URL.
--
-- create_webhook_subscription required an https URL, so an email destination could not be
-- configured at all even though the outbox could deliver one. The destination's type now
-- decides what it must carry: webhook and teams need a URL and no recipient; email needs a
-- recipient and no URL. A URL is still required to be https, and the recipient must be a
-- member of the workspace being configured, so an email destination cannot be pointed at
-- somebody outside it.
--
-- Email destinations get no signing secret: the secret exists so a receiver can verify that a
-- request came from us, and an outbox row is not a request. Returning one anyway would invite
-- a caller to treat it as meaningful.

-- CREATE OR REPLACE with a longer parameter list makes an overload rather than replacing the
-- function, and a 9-argument call would then keep resolving to the old signature - so the new
-- parameters would be unreachable for every existing caller. Drop the old signature first.
DROP FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text, integer);

CREATE OR REPLACE FUNCTION api.create_webhook_subscription(
  p_workspace_id uuid,
  p_key text,
  p_url text,
  p_event_types jsonb DEFAULT '[]'::jsonb,
  p_description text DEFAULT NULL::text,
  p_max_retries integer DEFAULT 5,
  p_failure_threshold integer DEFAULT 10,
  p_signing_secret text DEFAULT NULL::text,
  p_rate_limit_per_minute integer DEFAULT NULL::integer,
  p_channel_type text DEFAULT 'webhook',
  p_recipient_user_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_secret_text text;
  v_et jsonb;
  v_item text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_channel_type NOT IN ('webhook', 'teams', 'email') THEN
    RAISE EXCEPTION 'unsupported destination type: %', p_channel_type USING ERRCODE = 'SB034';
  END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid webhook key' USING ERRCODE = 'SB034';
  END IF;

  IF p_channel_type = 'email' THEN
    IF p_recipient_user_id IS NULL THEN
      RAISE EXCEPTION 'an email destination needs a recipient' USING ERRCODE = 'SB034';
    END IF;
    IF p_url IS NOT NULL AND btrim(p_url) <> '' THEN
      RAISE EXCEPTION 'an email destination does not take a URL' USING ERRCODE = 'SB034';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM api.workspace_memberships m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = p_recipient_user_id
    ) THEN
      RAISE EXCEPTION 'the recipient is not a member of this workspace' USING ERRCODE = 'SB033';
    END IF;
  ELSE
    IF p_recipient_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'only an email destination names a recipient' USING ERRCODE = 'SB034';
    END IF;
    IF p_url IS NULL OR p_url !~ '^https://' OR length(p_url) > 2048 THEN
      RAISE EXCEPTION 'webhook URL must be https and at most 2048 characters' USING ERRCODE = 'SB034';
    END IF;
  END IF;

  IF p_description IS NOT NULL AND length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = 'SB034';
  END IF;
  IF p_max_retries IS NULL OR p_max_retries NOT BETWEEN 0 AND 25 THEN
    RAISE EXCEPTION 'max_retries must be between 0 and 25' USING ERRCODE = 'SB034';
  END IF;
  IF p_failure_threshold IS NULL OR p_failure_threshold NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'failure_threshold must be between 0 and 100' USING ERRCODE = 'SB034';
  END IF;
  IF p_rate_limit_per_minute IS NOT NULL
     AND (p_rate_limit_per_minute < 1 OR p_rate_limit_per_minute > 60000) THEN
    RAISE EXCEPTION 'rate_limit_per_minute must be between 1 and 60000' USING ERRCODE = 'SB034';
  END IF;

  v_et := COALESCE(p_event_types, '[]'::jsonb);
  IF jsonb_typeof(v_et) <> 'array' THEN
    RAISE EXCEPTION 'event_types must be a JSON array' USING ERRCODE = 'SB034';
  END IF;
  FOR v_item IN SELECT value::text FROM jsonb_array_elements_text(v_et) LOOP
    IF v_item !~ '^[a-z][a-z0-9._]{2,63}$' THEN
      RAISE EXCEPTION 'invalid event type: %', v_item USING ERRCODE = 'SB034';
    END IF;
  END LOOP;

  INSERT INTO api.webhook_subscriptions(
    workspace_id, key, description, url, event_types, channel_type, recipient_user_id,
    max_retries, failure_threshold, rate_limit_per_minute, status,
    created_by_user_id, created_by_credential_id,
    updated_by_user_id, updated_by_credential_id
  ) VALUES (
    p_workspace_id, p_key, nullif(btrim(p_description), ''),
    nullif(btrim(p_url), ''), v_et, p_channel_type, p_recipient_user_id, p_max_retries,
    p_failure_threshold, p_rate_limit_per_minute, 'active',
    v_actor_user, v_actor_credential,
    v_actor_user, v_actor_credential
  ) RETURNING * INTO v;

  IF p_channel_type = 'email' THEN
    RETURN jsonb_build_object('subscription', to_jsonb(v), 'signing_secret', NULL);
  END IF;

  v_secret_text := COALESCE(p_signing_secret, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  INSERT INTO internal.webhook_secrets(workspace_id, subscription_id, secret_name, ciphertext, created_by_user_id)
  VALUES (p_workspace_id, v.id, 'signing_secret', convert_to(v_secret_text, 'UTF8'), v_actor_user);

  RETURN jsonb_build_object('subscription', to_jsonb(v), 'signing_secret', v_secret_text);
END $function$;

NOTIFY pgrst, 'reload schema';
