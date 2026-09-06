ALTER TABLE "api"."webhook_subscriptions" ADD COLUMN "rate_limit_per_minute" integer;--> statement-breakpoint
ALTER TABLE "api"."webhook_deliveries" DROP CONSTRAINT "chk_webhook_deliveries_status";--> statement-breakpoint
ALTER TABLE "api"."webhook_deliveries" ADD CONSTRAINT "chk_webhook_deliveries_status" CHECK ("api"."webhook_deliveries"."status" IN ('pending', 'delivered', 'failed', 'retrying', 'dead_letter'));--> statement-breakpoint
ALTER TABLE "api"."webhook_subscriptions" ADD CONSTRAINT "chk_webhook_subscriptions_rate_limit" CHECK ("api"."webhook_subscriptions"."rate_limit_per_minute" IS NULL OR ("api"."webhook_subscriptions"."rate_limit_per_minute" BETWEEN 1 AND 60000));
--> statement-breakpoint
COMMENT ON TABLE api.webhook_deliveries IS
  'Webhook delivery history. One row per delivery attempt; replay creates a new row. EVENT-02: terminal poison state is dead_letter (retries exhausted); failed is retained for pre-existing rows and manual operator marking.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- EVENT-02: create_webhook_subscription gains p_rate_limit_per_minute.
-- NULL = unlimited. The engine defers (never drops) over-budget attempts.
-- ---------------------------------------------------------------------------

DROP FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_webhook_subscription(
  p_workspace_id uuid,
  p_key text,
  p_url text,
  p_event_types jsonb DEFAULT '[]'::jsonb,
  p_description text DEFAULT NULL,
  p_max_retries integer DEFAULT 5,
  p_failure_threshold integer DEFAULT 10,
  p_signing_secret text DEFAULT NULL,
  p_rate_limit_per_minute integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid webhook key' USING ERRCODE = 'SB034';
  END IF;
  IF p_url IS NULL OR p_url !~ '^https://' OR length(p_url) > 2048 THEN
    RAISE EXCEPTION 'webhook URL must be https and at most 2048 characters' USING ERRCODE = 'SB034';
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
    workspace_id, key, description, url, event_types,
    max_retries, failure_threshold, rate_limit_per_minute, status,
    created_by_user_id, created_by_credential_id,
    updated_by_user_id, updated_by_credential_id
  ) VALUES (
    p_workspace_id, p_key, nullif(btrim(p_description), ''),
    p_url, v_et, p_max_retries, p_failure_threshold,
    p_rate_limit_per_minute, 'active',
    v_actor_user, v_actor_credential,
    v_actor_user, v_actor_credential
  ) RETURNING * INTO v;

  v_secret_text := COALESCE(p_signing_secret, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
  INSERT INTO internal.webhook_secrets(workspace_id, subscription_id, secret_name, ciphertext, created_by_user_id)
  VALUES (p_workspace_id, v.id, 'signing_secret', convert_to(v_secret_text, 'UTF8'), v_actor_user);

  RETURN jsonb_build_object('subscription', to_jsonb(v), 'signing_secret', v_secret_text);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_webhook_subscription(uuid, text, text, jsonb, text, integer, integer, text, integer) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- EVENT-02: update_webhook_subscription gains p_rate_limit_per_minute.
-- NULL leaves the current limit unchanged.
-- ---------------------------------------------------------------------------

DROP FUNCTION api.update_webhook_subscription(uuid, uuid, text, jsonb, text, text, integer, integer);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.update_webhook_subscription(
  p_workspace_id uuid,
  p_subscription_id uuid,
  p_url text DEFAULT NULL,
  p_event_types jsonb DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_max_retries integer DEFAULT NULL,
  p_failure_threshold integer DEFAULT NULL,
  p_rate_limit_per_minute integer DEFAULT NULL
)
RETURNS api.webhook_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_subscriptions;
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_et jsonb;
  v_item text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.webhook_subscriptions
   WHERE id = p_subscription_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_url IS NOT NULL THEN
    IF p_url !~ '^https://' OR length(p_url) > 2048 THEN
      RAISE EXCEPTION 'webhook URL must be https and at most 2048 characters' USING ERRCODE = 'SB034';
    END IF;
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'paused', 'disabled', 'archived') THEN
    RAISE EXCEPTION 'invalid webhook status' USING ERRCODE = 'SB034';
  END IF;
  IF p_max_retries IS NOT NULL AND (p_max_retries < 0 OR p_max_retries > 25) THEN
    RAISE EXCEPTION 'max_retries must be between 0 and 25' USING ERRCODE = 'SB034';
  END IF;
  IF p_failure_threshold IS NOT NULL AND (p_failure_threshold < 0 OR p_failure_threshold > 100) THEN
    RAISE EXCEPTION 'failure_threshold must be between 0 and 100' USING ERRCODE = 'SB034';
  END IF;
  IF p_rate_limit_per_minute IS NOT NULL
     AND (p_rate_limit_per_minute < 1 OR p_rate_limit_per_minute > 60000) THEN
    RAISE EXCEPTION 'rate_limit_per_minute must be between 1 and 60000' USING ERRCODE = 'SB034';
  END IF;
  IF p_description IS NOT NULL AND length(btrim(p_description)) > 2000 THEN
    RAISE EXCEPTION 'description too long' USING ERRCODE = 'SB034';
  END IF;
  IF p_event_types IS NOT NULL THEN
    v_et := p_event_types;
    IF jsonb_typeof(v_et) <> 'array' THEN
      RAISE EXCEPTION 'event_types must be a JSON array' USING ERRCODE = 'SB034';
    END IF;
    FOR v_item IN SELECT value::text FROM jsonb_array_elements_text(v_et) LOOP
      IF v_item !~ '^[a-z][a-z0-9._]{2,63}$' THEN
        RAISE EXCEPTION 'invalid event type: %', v_item USING ERRCODE = 'SB034';
      END IF;
    END LOOP;
  END IF;

  -- Re-enabling resets consecutive_failures.
  IF p_status = 'active' AND v.status IN ('disabled', 'paused') THEN
    UPDATE api.webhook_subscriptions SET
      url = COALESCE(p_url, url),
      event_types = COALESCE(p_event_types, event_types),
      description = COALESCE(nullif(btrim(p_description), ''), description),
      status = p_status,
      max_retries = COALESCE(p_max_retries, max_retries),
      failure_threshold = COALESCE(p_failure_threshold, failure_threshold),
      rate_limit_per_minute = COALESCE(p_rate_limit_per_minute, rate_limit_per_minute),
      consecutive_failures = 0,
      updated_at = now(),
      updated_by_user_id = v_actor_user,
      updated_by_credential_id = v_actor_credential
    WHERE id = p_subscription_id RETURNING * INTO v;
  ELSE
    UPDATE api.webhook_subscriptions SET
      url = COALESCE(p_url, url),
      event_types = COALESCE(p_event_types, event_types),
      description = COALESCE(nullif(btrim(p_description), ''), description),
      status = COALESCE(p_status, status),
      max_retries = COALESCE(p_max_retries, max_retries),
      failure_threshold = COALESCE(p_failure_threshold, failure_threshold),
      rate_limit_per_minute = COALESCE(p_rate_limit_per_minute, rate_limit_per_minute),
      updated_at = now(),
      updated_by_user_id = v_actor_user,
      updated_by_credential_id = v_actor_credential
    WHERE id = p_subscription_id RETURNING * INTO v;
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_webhook_subscription(uuid, uuid, text, jsonb, text, text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_webhook_subscription(uuid, uuid, text, jsonb, text, text, integer, integer, integer) TO authenticated, api_client;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- EVENT-02: list_webhook_deliveries gains event-type and time-window filters.
-- ---------------------------------------------------------------------------

DROP FUNCTION api.list_webhook_deliveries(uuid, uuid, integer, integer, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.list_webhook_deliveries(
  p_workspace_id uuid,
  p_subscription_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_event_type text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) AND
     coalesce(api.claim_probe()->>'role', '') <> 'api_client' THEN
    IF api.current_user_id() IS NULL AND api.current_credential_id() IS NULL THEN
      RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('pending', 'delivered', 'failed', 'retrying', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid delivery status' USING ERRCODE = 'SB034';
  END IF;

  SELECT count(*) INTO v_total FROM api.webhook_deliveries d
   WHERE d.workspace_id = p_workspace_id
     AND (p_subscription_id IS NULL OR d.subscription_id = p_subscription_id)
     AND (p_status IS NULL OR d.status = p_status)
     AND (p_event_type IS NULL OR d.event_type = p_event_type)
     AND (p_since IS NULL OR d.created_at >= p_since)
     AND (p_until IS NULL OR d.created_at <= p_until);

  SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM api.webhook_deliveries
       WHERE workspace_id = p_workspace_id
         AND (p_subscription_id IS NULL OR subscription_id = p_subscription_id)
         AND (p_status IS NULL OR status = p_status)
         AND (p_event_type IS NULL OR event_type = p_event_type)
         AND (p_since IS NULL OR created_at >= p_since)
         AND (p_until IS NULL OR created_at <= p_until)
       ORDER BY created_at DESC
       LIMIT v_limit OFFSET v_offset
    ) d;

  RETURN jsonb_build_object(
    'data', v_rows,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_webhook_deliveries(uuid, uuid, integer, integer, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_webhook_deliveries(uuid, uuid, integer, integer, text, text, timestamptz, timestamptz) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- EVENT-02: replay_webhook_delivery — terminal-only guard + audit event.
-- Replays reuse the original body/signature (same idempotency key), so
-- receivers that deduplicate on the event id never see a duplicate effect.
-- The replay row's replay_of_delivery_id lineage plus a webhook_delivery
-- change event (actor-attributed when invoked with request claims) form the
-- audit trail. Never automatic: only this RPC, the bulk window RPC below,
-- and the engine retry sweep create delivery rows.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.replay_webhook_delivery(
  p_workspace_id uuid,
  p_delivery_id uuid
)
RETURNS api.webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_original api.webhook_deliveries;
  v_new api.webhook_deliveries;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_original FROM api.webhook_deliveries
   WHERE id = p_delivery_id AND workspace_id = p_workspace_id;
  IF v_original.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = 'SB036';
  END IF;
  -- Only terminal deliveries may be replayed. pending/retrying rows are
  -- owned by the retry sweep; replaying them would double-deliver.
  IF v_original.status NOT IN ('delivered', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'only terminal deliveries can be replayed' USING ERRCODE = 'SB034';
  END IF;

  INSERT INTO api.webhook_deliveries(
    workspace_id, subscription_id, change_event_id, event_type,
    payload, body, signature, attempt, status, next_attempt_at,
    replay_of_delivery_id
  ) VALUES (
    p_workspace_id, v_original.subscription_id, v_original.change_event_id,
    v_original.event_type, v_original.payload, v_original.body, v_original.signature,
    0, 'pending', now(), p_delivery_id
  ) RETURNING * INTO v_new;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'webhook_delivery', v_new.id, 'create', NULL, NULL,
    jsonb_build_object(
      'replay_of', p_delivery_id,
      'subscription_id', v_new.subscription_id,
      'event_type', v_new.event_type
    )
  );
  RETURN v_new;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.replay_webhook_delivery(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.replay_webhook_delivery(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- RPC: replay_webhook_deliveries — operator-invoked replay by subscription
-- and/or time window. Reuses each original's body/signature (same
-- idempotency key: no downstream duplication for receivers that
-- deduplicate). Only original (non-replay) terminal rows are eligible, and
-- originals with a pending/retrying replay already queued are skipped, so
-- re-running a window is safe. One summary change event audits the action.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.replay_webhook_deliveries(
  p_workspace_id uuid,
  p_subscription_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_status text DEFAULT 'dead_letter',
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count bigint;
  v_ids uuid[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('dead_letter', 'failed', 'delivered') THEN
    RAISE EXCEPTION 'replay status must be dead_letter, failed, or delivered' USING ERRCODE = 'SB034';
  END IF;
  IF p_subscription_id IS NOT NULL THEN
    PERFORM 1 FROM api.webhook_subscriptions
     WHERE id = p_subscription_id AND workspace_id = p_workspace_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
    END IF;
  END IF;

  WITH candidates AS (
    SELECT d.*
      FROM api.webhook_deliveries d
     WHERE d.workspace_id = p_workspace_id
       AND (p_subscription_id IS NULL OR d.subscription_id = p_subscription_id)
       AND d.status = p_status
       AND d.replay_of_delivery_id IS NULL
       AND (p_since IS NULL OR d.created_at >= p_since)
       AND (p_until IS NULL OR d.created_at <= p_until)
       AND NOT EXISTS (
         SELECT 1 FROM api.webhook_deliveries r
          WHERE r.replay_of_delivery_id = d.id
            AND r.status IN ('pending', 'retrying')
       )
     ORDER BY d.created_at ASC
     LIMIT v_limit
  ),
  inserted AS (
    INSERT INTO api.webhook_deliveries(
      workspace_id, subscription_id, change_event_id, event_type,
      payload, body, signature, attempt, status, next_attempt_at,
      replay_of_delivery_id
    )
    SELECT p_workspace_id, c.subscription_id, c.change_event_id,
      c.event_type, c.payload, c.body, c.signature,
      0, 'pending', now(), c.id
    FROM candidates c
    RETURNING id, replay_of_delivery_id
  )
  SELECT count(*), coalesce(array_agg(i.replay_of_delivery_id), ARRAY[]::uuid[])
    INTO v_count, v_ids
    FROM inserted i;

  PERFORM internal.emit_change_event(
    p_workspace_id, 'webhook_delivery', gen_random_uuid(), 'create', NULL, NULL,
    jsonb_build_object(
      'bulk_replay', true,
      'replayed_count', v_count,
      'status', p_status,
      'subscription_id', p_subscription_id,
      'since', p_since,
      'until', p_until
    )
  );
  RETURN jsonb_build_object('replayed_count', v_count, 'delivery_ids', to_jsonb(v_ids));
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.replay_webhook_deliveries(uuid, uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.replay_webhook_deliveries(uuid, uuid, timestamptz, timestamptz, text, integer) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPC: get_webhook_endpoint_health — per-endpoint delivery health for
-- operators. 24h success-rate window, last error, consecutive failures,
-- auto-disable state, and retry debt. Read-only; re-enable via
-- update_webhook_subscription(status => 'active'), which resets
-- consecutive_failures. Full platform-health surfacing stays ADMIN-03.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.get_webhook_endpoint_health(
  p_workspace_id uuid,
  p_subscription_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) AND
     coalesce(api.claim_probe()->>'role', '') <> 'api_client' THEN
    IF api.current_user_id() IS NULL AND api.current_credential_id() IS NULL THEN
      RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_subscription_id IS NOT NULL THEN
    PERFORM 1 FROM api.webhook_subscriptions
     WHERE id = p_subscription_id AND workspace_id = p_workspace_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'webhook subscription not found' USING ERRCODE = 'SB036';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(h ORDER BY h.key), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT
        s.id AS subscription_id,
        s.key AS key,
        s.url AS url,
        s.status AS status,
        s.consecutive_failures AS consecutive_failures,
        s.failure_threshold AS failure_threshold,
        s.max_retries AS max_retries,
        s.rate_limit_per_minute AS rate_limit_per_minute,
        w.total_24h AS total_24h,
        w.delivered_24h AS delivered_24h,
        w.failed_24h AS failed_24h,
        w.dead_letter_24h AS dead_letter_24h,
        w.retrying_24h AS retrying_24h,
        w.pending_24h AS pending_24h,
        CASE
          WHEN w.total_24h > 0
          THEN round((w.delivered_24h::numeric / w.total_24h::numeric), 4)
          ELSE NULL
        END AS success_rate_24h,
        w.last_delivered_at AS last_delivered_at,
        w.oldest_pending_at AS oldest_pending_at,
        CASE
          WHEN e.delivery_id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'code', e.error_code,
            'message', e.error_message,
            'at', e.error_at,
            'delivery_id', e.delivery_id
          )
        END AS last_error
      FROM api.webhook_subscriptions s
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE d.created_at > now() - interval '24 hours') AS total_24h,
          count(*) FILTER (WHERE d.status = 'delivered' AND d.created_at > now() - interval '24 hours') AS delivered_24h,
          count(*) FILTER (WHERE d.status = 'failed' AND d.created_at > now() - interval '24 hours') AS failed_24h,
          count(*) FILTER (WHERE d.status = 'dead_letter' AND d.created_at > now() - interval '24 hours') AS dead_letter_24h,
          count(*) FILTER (WHERE d.status = 'retrying') AS retrying_24h,
          count(*) FILTER (WHERE d.status = 'pending') AS pending_24h,
          max(d.delivered_at) AS last_delivered_at,
          min(d.created_at) FILTER (WHERE d.status IN ('pending', 'retrying')) AS oldest_pending_at
        FROM api.webhook_deliveries d
        WHERE d.subscription_id = s.id
      ) w ON true
      LEFT JOIN LATERAL (
        SELECT d.error_code, d.error_message, d.updated_at AS error_at, d.id AS delivery_id
          FROM api.webhook_deliveries d
         WHERE d.subscription_id = s.id
           AND d.error_code IS NOT NULL
         ORDER BY d.updated_at DESC
         LIMIT 1
      ) e ON true
      WHERE s.workspace_id = p_workspace_id
        AND (p_subscription_id IS NULL OR s.id = p_subscription_id)
    ) h;

  RETURN jsonb_build_object('data', v_rows, 'generated_at', now());
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.get_webhook_endpoint_health(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_webhook_endpoint_health(uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- EVENT-02: record_webhook_delivery_result — exhausted backoff lands in the
-- explicit dead_letter state. 'failed' stays accepted for pre-existing rows
-- and manual operator marking; both count toward auto-disablement.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.record_webhook_delivery_result(
  p_workspace_id uuid,
  p_delivery_id uuid,
  p_status text,
  p_response_status integer DEFAULT NULL,
  p_response_body text DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_next_attempt_at timestamptz DEFAULT NULL
)
RETURNS api.webhook_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.webhook_deliveries;
  v_sub api.webhook_subscriptions;
BEGIN
  SELECT * INTO v FROM api.webhook_deliveries
   WHERE id = p_delivery_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_status NOT IN ('delivered', 'failed', 'retrying', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid delivery status' USING ERRCODE = 'SB034';
  END IF;

  UPDATE api.webhook_deliveries SET
    status = p_status,
    attempt = CASE WHEN p_status IN ('retrying', 'failed', 'dead_letter') THEN attempt + 1 ELSE attempt END,
    response_status = p_response_status,
    response_body = CASE
      WHEN p_response_body IS NOT NULL AND length(p_response_body) > 10000
      THEN left(p_response_body, 10000)
      ELSE p_response_body
    END,
    error_code = p_error_code,
    error_message = p_error_message,
    next_attempt_at = p_next_attempt_at,
    delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
    updated_at = now()
  WHERE id = p_delivery_id RETURNING * INTO v;

  IF p_status = 'delivered' THEN
    UPDATE api.webhook_subscriptions SET consecutive_failures = 0, updated_at = now()
     WHERE id = v.subscription_id;
  ELSIF p_status IN ('failed', 'retrying', 'dead_letter') THEN
    SELECT * INTO v_sub FROM api.webhook_subscriptions WHERE id = v.subscription_id FOR UPDATE;
    IF v_sub.id IS NOT NULL THEN
      UPDATE api.webhook_subscriptions SET
        consecutive_failures = consecutive_failures + 1,
        status = CASE
          WHEN v_sub.failure_threshold > 0
               AND v_sub.consecutive_failures + 1 >= v_sub.failure_threshold
          THEN 'disabled'
          ELSE status
        END,
        updated_at = now()
       WHERE id = v.subscription_id;
    END IF;
  END IF;

  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.record_webhook_delivery_result(uuid, uuid, text, integer, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
