-- REV-05.1 — hash chain over the audit trail.
--
-- "Each audit entry stores the hash of the previous entry's hash and its own
-- content; insert-only grants." The chain is per workspace, ordered by the
-- sequence the emitter already assigns, and computed by a trigger so every writer
-- (the emit helper, the audit sources) is covered. Verification recomputes it and
-- reports the first entry that does not match.
ALTER TABLE api.change_events ADD COLUMN IF NOT EXISTS previous_hash text;
--> statement-breakpoint
ALTER TABLE api.change_events ADD COLUMN IF NOT EXISTS entry_hash text;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.audit_entry_hash(
  p_previous_hash text,
  p_workspace_id uuid,
  p_sequence bigint,
  p_entity_type text,
  p_entity_uuid uuid,
  p_operation text,
  p_record_id uuid,
  p_project_id uuid,
  p_actor_user_id text,
  p_actor_credential_id uuid,
  p_client_id text,
  p_payload jsonb,
  p_created_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(
    coalesce(p_previous_hash, 'genesis') || '|' ||
    p_workspace_id::text || '|' || p_sequence::text || '|' ||
    p_entity_type || '|' || p_entity_uuid::text || '|' || p_operation || '|' ||
    coalesce(p_record_id::text, '') || '|' || coalesce(p_project_id::text, '') || '|' ||
    coalesce(p_actor_user_id, '') || '|' || coalesce(p_actor_credential_id::text, '') || '|' ||
    coalesce(p_client_id, '') || '|' || coalesce(p_payload, '{}'::jsonb)::text || '|' ||
    to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8')), 'hex')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.audit_entry_hash(text,uuid,bigint,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.chain_audit_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_previous text;
BEGIN
  SELECT e.entry_hash INTO v_previous
    FROM api.change_events e
   WHERE e.workspace_id = NEW.workspace_id
     AND e.sequence < NEW.sequence
   ORDER BY e.sequence DESC
   LIMIT 1;
  NEW.previous_hash := v_previous;
  NEW.entry_hash := internal.audit_entry_hash(
    v_previous, NEW.workspace_id, NEW.sequence, NEW.entity_type, NEW.entity_uuid,
    NEW.operation, NEW.record_id, NEW.project_id, NEW.actor_user_id,
    NEW.actor_credential_id, NEW.client_id, NEW.payload, NEW.created_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.chain_audit_entry() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS chain_audit_entry ON api.change_events;
--> statement-breakpoint
CREATE TRIGGER chain_audit_entry BEFORE INSERT ON api.change_events
  FOR EACH ROW EXECUTE FUNCTION internal.chain_audit_entry();
--> statement-breakpoint

-- Backfill: the existing history is chained in sequence order.
DO $$ DECLARE
  r record;
  v_previous text;
  v_workspace uuid := NULL;
BEGIN
  FOR r IN SELECT * FROM api.change_events ORDER BY workspace_id, sequence LOOP
    IF v_workspace IS DISTINCT FROM r.workspace_id THEN
      v_previous := NULL;
      v_workspace := r.workspace_id;
    END IF;
    UPDATE api.change_events
       SET previous_hash = v_previous,
           entry_hash = internal.audit_entry_hash(
             v_previous, r.workspace_id, r.sequence, r.entity_type, r.entity_uuid,
             r.operation, r.record_id, r.project_id, r.actor_user_id,
             r.actor_credential_id, r.client_id, r.payload, r.created_at)
     WHERE id = r.id;
    SELECT entry_hash INTO v_previous FROM api.change_events WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- Insert-only: the chain is evidence, so the rows cannot be rewritten.
CREATE OR REPLACE FUNCTION internal.refuse_change_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- The chain trigger may fill the two hash columns once, on insert only.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit entries are append-only' USING ERRCODE = 'SB121';
  END IF;
  RAISE EXCEPTION 'audit entries are append-only' USING ERRCODE = 'SB121';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refuse_change_event_mutation() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS refuse_change_event_mutation ON api.change_events;
--> statement-breakpoint
CREATE TRIGGER refuse_change_event_mutation BEFORE UPDATE OR DELETE ON api.change_events
  FOR EACH ROW EXECUTE FUNCTION internal.refuse_change_event_mutation();
--> statement-breakpoint

-- Verification: recompute the chain and report the first entry that breaks it.
CREATE OR REPLACE FUNCTION api.verify_audit_chain(p_workspace_id uuid)
RETURNS TABLE(ok boolean, checked integer, first_bad_sequence bigint, first_bad_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  v_previous text;
  v_expected text;
  v_checked integer := 0;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT * FROM api.change_events e WHERE e.workspace_id = p_workspace_id ORDER BY e.sequence LOOP
    v_expected := internal.audit_entry_hash(
      v_previous, r.workspace_id, r.sequence, r.entity_type, r.entity_uuid,
      r.operation, r.record_id, r.project_id, r.actor_user_id,
      r.actor_credential_id, r.client_id, r.payload, r.created_at);
    v_checked := v_checked + 1;
    IF r.previous_hash IS DISTINCT FROM v_previous OR r.entry_hash IS DISTINCT FROM v_expected THEN
      RETURN QUERY SELECT false, v_checked, r.sequence, r.id;
      RETURN;
    END IF;
    v_previous := r.entry_hash;
  END LOOP;
  RETURN QUERY SELECT true, v_checked, NULL::bigint, NULL::uuid;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.verify_audit_chain(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.verify_audit_chain(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
