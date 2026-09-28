-- WORK-03.4 — the email outbox.
--
-- internal.email_deliveries mirrors the webhook delivery retry model: a row is
-- enqueued, claimed by the worker, and marked sent or scheduled with
-- exponential backoff until it dead-letters. The transport itself is the
-- server worker's responsibility; this is the durable queue.

CREATE TABLE internal.email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  event_type text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT chk_email_deliveries_status
    CHECK (status IN ('pending', 'sending', 'sent', 'dead')),
  CONSTRAINT chk_email_deliveries_attempt CHECK (attempt >= 0)
);
--> statement-breakpoint
CREATE INDEX idx_email_deliveries_due
  ON internal.email_deliveries (next_attempt_at)
  WHERE status IN ('pending', 'sending');
--> statement-breakpoint
REVOKE ALL ON internal.email_deliveries FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.enqueue_email_delivery(
  p_workspace_id uuid,
  p_user_id text,
  p_event_type text,
  p_subject text,
  p_body text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_id uuid;
BEGIN
  SELECT email INTO v_email FROM internal."user" WHERE id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'unknown recipient' USING ERRCODE = '42501';
  END IF;
  INSERT INTO internal.email_deliveries
    (workspace_id, user_id, to_email, event_type, subject, body)
  VALUES (p_workspace_id, p_user_id, v_email, p_event_type, p_subject, p_body)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enqueue_email_delivery(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- Claim due deliveries for the worker: mark them sending and bump the attempt.
CREATE OR REPLACE FUNCTION internal.claim_due_email_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF internal.email_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE internal.email_deliveries d
     SET status = 'sending', attempt = d.attempt + 1, updated_at = now()
   WHERE d.id IN (
     SELECT id FROM internal.email_deliveries
      WHERE status IN ('pending', 'sending')
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at ASC
      LIMIT greatest(1, least(p_limit, 200))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_due_email_deliveries(integer) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.finish_email_delivery(
  p_id uuid,
  p_sent boolean,
  p_error text DEFAULT NULL
)
RETURNS internal.email_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v internal.email_deliveries;
  v_delay_ms bigint;
BEGIN
  IF p_sent THEN
    UPDATE internal.email_deliveries
       SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now()
     WHERE id = p_id RETURNING * INTO v;
    RETURN v;
  END IF;
  SELECT * INTO v FROM internal.email_deliveries WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = '42501';
  END IF;
  IF v.attempt >= 5 THEN
    UPDATE internal.email_deliveries
       SET status = 'dead', last_error = p_error, updated_at = now()
     WHERE id = v.id RETURNING * INTO v;
    RETURN v;
  END IF;
  -- Exponential backoff: 30s, 60s, 120s, 240s (capped), with jitter.
  v_delay_ms := least((30000::bigint * (1 << (v.attempt - 1))), 6 * 3600 * 1000);
  v_delay_ms := v_delay_ms + (random() * v_delay_ms * 0.1)::bigint;
  UPDATE internal.email_deliveries
     SET status = 'pending',
         next_attempt_at = now() + make_interval(secs => v_delay_ms / 1000.0),
         last_error = p_error,
         updated_at = now()
   WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.finish_email_delivery(uuid, boolean, text) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
