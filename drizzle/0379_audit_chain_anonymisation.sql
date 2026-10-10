-- REV-05.1 follow-up: the chain must survive the designed anonymisation of a
-- departed author.
--
-- api.change_events.actor_user_id is `on delete set null`, and the product relies
-- on that: a deleted author renders honestly as "departed" rather than as a
-- dangling id (tests/db/anchored-comments.test.ts). Hashing the actor therefore
-- made a documented privacy transition look exactly like tampering, and the
-- append-only trigger refused it, which also masked the real foreign-key error in
-- tests/db/submitted-revisions.test.ts.
--
-- Two corrections:
--   1. The entry hash covers the immutable content only. The actor is protected by
--      the append-only trigger instead: the single permitted update is the
--      null-out of a departed author, so the actor cannot be rewritten either.
--   2. The trigger permits that one transition and refuses everything else.

CREATE OR REPLACE FUNCTION internal.audit_entry_hash(
  p_previous_hash text,
  p_workspace_id uuid,
  p_sequence bigint,
  p_entity_type text,
  p_entity_uuid uuid,
  p_operation text,
  p_record_id uuid,
  p_project_id uuid,
  p_client_id text,
  p_payload jsonb,
  p_created_at timestamptz
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(
    coalesce(p_previous_hash, 'genesis') || '|' ||
    p_workspace_id::text || '|' || p_sequence::text || '|' ||
    p_entity_type || '|' || p_entity_uuid::text || '|' || p_operation || '|' ||
    coalesce(p_record_id::text, '') || '|' || coalesce(p_project_id::text, '') || '|' ||
    coalesce(p_client_id, '') || '|' || coalesce(p_payload, '{}'::jsonb)::text || '|' ||
    to_char(p_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'UTF8')), 'hex')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.audit_entry_hash(text,uuid,bigint,text,uuid,text,uuid,uuid,text,jsonb,timestamptz)
  FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
DROP FUNCTION IF EXISTS internal.audit_entry_hash(text,uuid,bigint,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,timestamptz);
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
    NEW.operation, NEW.record_id, NEW.project_id, NEW.client_id, NEW.payload,
    NEW.created_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.chain_audit_entry() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.refuse_change_event_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit entries are append-only' USING ERRCODE = 'SB121';
  END IF;
  -- The only permitted update is the documented anonymisation of a departed
  -- author, which the schema performs when internal."user" is deleted. Everything
  -- else - including the actor of a live user - is refused.
  IF NEW.id = OLD.id
     AND NEW.workspace_id = OLD.workspace_id
     AND NEW.sequence = OLD.sequence
     AND NEW.entity_type = OLD.entity_type
     AND NEW.entity_uuid = OLD.entity_uuid
     AND NEW.operation = OLD.operation
     AND NEW.record_id IS NOT DISTINCT FROM OLD.record_id
     AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id
     AND NEW.client_id IS NOT DISTINCT FROM OLD.client_id
     AND NEW.payload IS NOT DISTINCT FROM OLD.payload
     AND NEW.created_at = OLD.created_at
     AND NEW.previous_hash IS NOT DISTINCT FROM OLD.previous_hash
     AND NEW.entry_hash IS NOT DISTINCT FROM OLD.entry_hash
     AND NEW.actor_user_id IS NULL
     AND NEW.actor_credential_id IS NULL
     AND OLD.actor_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit entries are append-only' USING ERRCODE = 'SB121';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refuse_change_event_mutation() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- Re-chain the history under the corrected definition. The append-only trigger is
-- suspended for the rewrite; it is re-enabled immediately afterwards.
ALTER TABLE api.change_events DISABLE TRIGGER refuse_change_event_mutation;
--> statement-breakpoint
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
             r.operation, r.record_id, r.project_id, r.client_id, r.payload,
             r.created_at)
     WHERE id = r.id;
    SELECT entry_hash INTO v_previous FROM api.change_events WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE api.change_events ENABLE TRIGGER refuse_change_event_mutation;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.verify_audit_chain(p_workspace_id uuid)
RETURNS TABLE(ok boolean, checked integer, first_bad_sequence bigint, first_bad_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  v_previous text;
  v_expected text;
  v_checked integer := 0;
BEGIN
  FOR r IN SELECT * FROM api.change_events e WHERE e.workspace_id = p_workspace_id ORDER BY e.sequence LOOP
    v_expected := internal.audit_entry_hash(
      v_previous, r.workspace_id, r.sequence, r.entity_type, r.entity_uuid,
      r.operation, r.record_id, r.project_id, r.client_id, r.payload, r.created_at);
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
REVOKE ALL ON FUNCTION internal.verify_audit_chain(uuid) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
