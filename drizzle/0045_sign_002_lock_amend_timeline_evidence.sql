-- SIGN-002: lock approved records, amendment workflow, complete history
-- timeline and machine-readable evidence export.
--
-- Locking follows the SIGN-001 approve-for-record signature. When the first
-- approve-for-record signature is recorded against an approved submission,
-- the owning record's scientific evidence becomes locked against ordinary
-- CRUD: block insert/update/delete, record metadata update/delete, record
-- link insert/update/delete, scientific-row CRUD (via the existing
-- assert_scientific_record_writable guard) and formula-definition writes all
-- fail with SB011. The approved revision itself was already immutable
-- (REV-002); the lock now freezes the live draft too.
--
-- A new draft can only begin through the explicit, traceable
-- api.create_amendment RPC, which records an 'amend' revision, supersedes
-- the locked revision and unlocks the record so the author can edit again.
--
-- Two read-only RPCs expose the complete history and a stable evidence
-- export:
--   * api.record_timeline(p_record_id)  — chronological timeline of every
--     creation, edit, submission, decision, check, signature, comment and
--     amendment event for a record.
--   * api.export_revision_evidence(p_revision_id) — machine-readable JSON
--     bundle of the revision, its submission, decisions, check results,
--     signatures and comments.
--
-- Defence in depth: RLS write policies on records/blocks/record_links now
-- require the owning record not be locked, AND BEFORE UPDATE/DELETE triggers
-- on records, blocks and formula_definitions reject mutations of locked
-- evidence for every application role (migrator retains fixture cleanup).

-- ---------------------------------------------------------------------------
-- Widen vocabularies: 'lock' and 'amend' change-event operations, 'amend'
-- revision reason.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_operation";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_operation"
  CHECK (operation IN (
    'create', 'update', 'move', 'delete', 'archive', 'restore',
    'link', 'unlink', 'quarantine', 'resolve', 'reopen',
    'lock', 'amend'
  ));
--> statement-breakpoint

ALTER TABLE "api"."revisions" DROP CONSTRAINT "chk_revisions_reason";
--> statement-breakpoint
ALTER TABLE "api"."revisions" ADD CONSTRAINT "chk_revisions_reason"
  CHECK (reason IN ('submit', 'sign', 'manual', 'validate', 'amend'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Record lock columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."records"
  ADD COLUMN "locked_at" timestamptz,
  ADD COLUMN "locked_by_revision_id" uuid
    REFERENCES "api"."revisions"("id") ON DELETE RESTRICT;
--> statement-breakpoint

ALTER TABLE "api"."records" ADD CONSTRAINT "chk_records_locked_consistency"
  CHECK ((locked_at IS NULL) = (locked_by_revision_id IS NULL));
--> statement-breakpoint

CREATE INDEX "idx_records_locked"
  ON "api"."records" ("locked_at") WHERE "locked_at" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- internal.record_is_locked — stable helper used by the defence-in-depth
-- triggers and the amendment RPC. SECURITY DEFINER so it can read the record
-- regardless of caller role; not executable by request roles.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."record_is_locked"(p_record_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_locked timestamptz;
BEGIN
  SELECT locked_at INTO v_locked FROM api.records WHERE id = p_record_id;
  RETURN v_locked IS NOT NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."record_is_locked"(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "internal"."record_is_locked"(uuid)
  TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- internal.lock_record — the single writer of the lock columns. Called by the
-- signature AFTER INSERT trigger. SECURITY DEFINER (migrator-owned) so it can
-- UPDATE records bypassing RLS and emit a change event.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."lock_record"(
  p_record_id uuid,
  p_revision_id uuid,
  p_locked_at timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid;
  v_project uuid;
  v_already_locked_by uuid;
BEGIN
  SELECT workspace_id, locked_by_revision_id INTO v_workspace, v_already_locked_by
  FROM api.records WHERE id = p_record_id FOR UPDATE;
  IF v_workspace IS NULL THEN
    RETURN;
  END IF;
  -- Idempotent: a witness signature after the approve-for-record signature
  -- must not error or overwrite the lock.
  IF v_already_locked_by IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE api.records
    SET locked_at = p_locked_at,
        locked_by_revision_id = p_revision_id,
        updated_at = now()
    WHERE id = p_record_id;
  SELECT project_id INTO v_project FROM api.records WHERE id = p_record_id;
  PERFORM internal.emit_change_event(
    v_workspace, 'record', p_record_id, 'lock', p_record_id, v_project,
    jsonb_build_object(
      'revisionId', p_revision_id,
      'lockedAt', p_locked_at
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."lock_record"(uuid, uuid, timestamptz)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- lock_record_after_signature — AFTER INSERT trigger on api.signatures. When
-- an 'approve-for-record' signature is recorded, lock the owning record. The
-- signature row is only ever inserted by the SECURITY DEFINER sign_revision
-- RPC, so the trigger inherits the migrator context and can call lock_record.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."lock_record_after_signature"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.signature_meaning = 'approve-for-record' THEN
    PERFORM internal.lock_record(NEW.record_id, NEW.revision_id, NEW.signed_at);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."lock_record_after_signature"()
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE TRIGGER "lock_record_after_signature"
  AFTER INSERT ON "api"."signatures"
  FOR EACH ROW EXECUTE FUNCTION "internal"."lock_record_after_signature"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Defence-in-depth triggers. RLS is the primary enforcer; these triggers make
-- mutation of locked evidence fail for every application role even if a grant
-- or policy is widened later. The migrator retains fixture cleanup access.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."prevent_locked_record_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
    END IF;
    -- A non-locked record may be deleted; return OLD so the row is removed.
    RETURN OLD;
  END IF;
  -- TG_OP = 'UPDATE': a locked record may not be edited through ordinary
  -- roles. The lock columns themselves are only cleared by the amendment RPC
  -- (SECURITY DEFINER, runs as migrator and is exempted above).
  IF OLD.locked_at IS NOT NULL
     AND NEW.locked_at IS NOT NULL
     AND NEW.locked_at IS NOT DISTINCT FROM OLD.locked_at
     AND NEW.locked_by_revision_id IS NOT DISTINCT FROM OLD.locked_by_revision_id THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_locked_record_mutation"()
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_locked_record_mutation" ON "api"."records";
CREATE TRIGGER "prevent_locked_record_mutation"
  BEFORE UPDATE OR DELETE ON "api"."records"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_locked_record_mutation"();
--> statement-breakpoint

CREATE FUNCTION "internal"."prevent_locked_block_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF internal.record_is_locked(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END
  ) THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_locked_block_mutation"()
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_locked_block_mutation" ON "api"."blocks";
CREATE TRIGGER "prevent_locked_block_mutation"
  BEFORE INSERT OR UPDATE OR DELETE ON "api"."blocks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_locked_block_mutation"();
--> statement-breakpoint

CREATE FUNCTION "internal"."prevent_locked_formula_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF internal.record_is_locked(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END
  ) THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_locked_formula_mutation"()
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "prevent_locked_formula_mutation" ON "api"."formula_definitions";
CREATE TRIGGER "prevent_locked_formula_mutation"
  BEFORE INSERT OR UPDATE OR DELETE ON "api"."formula_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_locked_formula_mutation"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen internal.assert_scientific_record_writable to also reject writes when
-- the owning record is locked. This single change locks scientific-row CRUD
-- across every generated table and every scientific mutation RPC that calls
-- the helper. Migrator fixture cleanup is exempt (session_user check, since
-- the function is SECURITY DEFINER).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."assert_scientific_record_writable"(
  p_table_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  writable boolean;
  v_locked timestamptz;
  v_record_id uuid;
BEGIN
  SELECT true, r.locked_at, r.id INTO writable, v_locked, v_record_id
  FROM api.scientific_tables t JOIN api.records r ON r.id = t.record_id
  WHERE t.id = p_table_id AND r.archived_at IS NULL AND r.deleted_at IS NULL
  FOR UPDATE OF r;
  IF writable IS NOT TRUE THEN
    RAISE EXCEPTION 'owning record is not writable' USING ERRCODE = '42501';
  END IF;
  IF v_locked IS NOT NULL AND session_user <> 'migrator' THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen internal.prepare_revision_insert to block a 'submit' revision from
-- being created against a locked record. An amendment (reason='amend') is the
-- only revision allowed on a locked record; it is created by the amendment
-- RPC and unlocks the record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."prepare_revision_insert"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO NEW.workspace_id FROM api.records WHERE id = NEW.record_id;
  END IF;
  IF NEW.canonical_snapshot IS NULL THEN
    NEW.canonical_snapshot := jsonb_build_object(
      'formatVersion', 0,
      'record', NEW.metadata_snapshot,
      'blocks', NEW.block_snapshot,
      'links', '[]'::jsonb,
      'scientificTables', '[]'::jsonb,
      'formulas', '[]'::jsonb,
      'files', '[]'::jsonb
    );
  END IF;
  IF NEW.integrity_digest IS NULL THEN
    NEW.integrity_digest := internal.revision_integrity_digest(NEW.canonical_snapshot);
  END IF;
  IF NEW.reason = 'submit' AND internal.record_is_locked(NEW.record_id) THEN
    RAISE EXCEPTION 'record is locked; create an amendment instead'
      USING ERRCODE = 'SB011';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS: widen write policies on records, blocks and record_links so ordinary
-- CRUD fails for locked records. The lock/unlock writers run as SECURITY
-- DEFINER (migrator) and bypass RLS.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "records_update" ON "api"."records";
--> statement-breakpoint
CREATE POLICY "records_update" ON "api"."records"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
    AND locked_at IS NULL
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());
--> statement-breakpoint

DROP POLICY IF EXISTS "records_delete" ON "api"."records";
--> statement-breakpoint
CREATE POLICY "records_delete" ON "api"."records"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
    AND locked_at IS NULL
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "records_update_api_client" ON "api"."records";
--> statement-breakpoint
CREATE POLICY "records_update_api_client" ON "api"."records"
  FOR UPDATE TO api_client
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND locked_at IS NULL
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());
--> statement-breakpoint

DROP POLICY IF EXISTS "blocks_insert" ON "api"."blocks";
--> statement-breakpoint
CREATE POLICY "blocks_insert" ON "api"."blocks"
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "blocks_update" ON "api"."blocks";
--> statement-breakpoint
CREATE POLICY "blocks_update" ON "api"."blocks"
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "blocks_delete" ON "api"."blocks";
--> statement-breakpoint
CREATE POLICY "blocks_delete" ON "api"."blocks"
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "blocks_insert_api_client" ON "api"."blocks";
--> statement-breakpoint
CREATE POLICY "blocks_insert_api_client" ON "api"."blocks"
  FOR INSERT TO api_client
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "blocks_update_api_client" ON "api"."blocks";
--> statement-breakpoint
CREATE POLICY "blocks_update_api_client" ON "api"."blocks"
  FOR UPDATE TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "record_links_insert" ON "api"."record_links";
--> statement-breakpoint
CREATE POLICY "record_links_insert" ON "api"."record_links"
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "record_links_update" ON "api"."record_links";
--> statement-breakpoint
CREATE POLICY "record_links_update" ON "api"."record_links"
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "record_links_delete" ON "api"."record_links";
--> statement-breakpoint
CREATE POLICY "record_links_delete" ON "api"."record_links"
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "record_links_insert_api_client" ON "api"."record_links";
--> statement-breakpoint
CREATE POLICY "record_links_insert_api_client" ON "api"."record_links"
  FOR INSERT TO api_client
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "record_links_update_api_client" ON "api"."record_links";
--> statement-breakpoint
CREATE POLICY "record_links_update_api_client" ON "api"."record_links"
  FOR UPDATE TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND r.locked_at IS NULL
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.create_amendment — the only way to begin a new draft from a locked
-- record. Records an 'amend' revision capturing the current live envelope,
-- supersedes the locked revision, unlocks the record, and emits a traceable
-- change event. SECURITY DEFINER (migrator-owned), executable by authenticated.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."create_amendment"(
  p_record_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_session text;
  v_role text;
  v_record api.records;
  v_locked_revision_id uuid;
  v_project uuid;
  v_envelope jsonb;
  v_digest text;
  v_new_revision_id uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  v_session := nullif(v_claims->>'session_id', '');
  v_role := nullif(v_claims->>'role', '');
  IF v_workspace IS NULL OR v_actor IS NULL OR v_session IS NULL
     OR v_role <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_note IS NOT NULL AND length(p_note) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'note must be 1–8000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_record FROM api.records
  WHERE id = p_record_id AND workspace_id = v_workspace
  FOR UPDATE;
  IF v_record.id IS NULL OR v_record.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  -- The record must be locked — amendments only begin from a locked record.
  IF v_record.locked_at IS NULL THEN
    RAISE EXCEPTION 'record is not locked; nothing to amend'
      USING ERRCODE = 'SB012';
  END IF;
  v_locked_revision_id := v_record.locked_by_revision_id;

  v_envelope := internal.build_revision_envelope(v_record.id);
  v_digest := internal.revision_integrity_digest(v_envelope);

  INSERT INTO api.revisions (
    record_id, workspace_id, structure_version, metadata_version,
    metadata_snapshot, block_snapshot, canonical_snapshot,
    integrity_algorithm, integrity_digest, reason, created_at, updated_at,
    created_by_user_id
  ) VALUES (
    v_record.id, v_record.workspace_id, v_record.structure_version,
    v_record.metadata_version, v_envelope->'record', v_envelope->'blocks',
    v_envelope, 'sha256', v_digest, 'amend', v_now, v_now, v_actor
  ) RETURNING id INTO v_new_revision_id;

  -- Supersede the locked revision so history shows the amendment branch.
  IF v_locked_revision_id IS NOT NULL THEN
    UPDATE api.revisions
      SET superseded_by_revision_id = v_new_revision_id
      WHERE id = v_locked_revision_id;
  END IF;

  -- Unlock the record so the author can edit the new draft. Runs as migrator
  -- (SECURITY DEFINER), bypassing the locked-record mutation trigger.
  UPDATE api.records
    SET locked_at = NULL,
        locked_by_revision_id = NULL,
        updated_at = now(),
        updated_by_user_id = v_actor
    WHERE id = v_record.id;

  v_project := v_record.project_id;
  PERFORM internal.emit_change_event(
    v_workspace, 'record', v_record.id, 'amend', v_record.id, v_project,
    jsonb_build_object(
      'revisionId', v_new_revision_id,
      'supersedesRevisionId', v_locked_revision_id,
      'actorUserId', v_actor,
      'note', p_note
    )
  );

  RETURN jsonb_build_object(
    'revisionId', v_new_revision_id,
    'supersedesRevisionId', v_locked_revision_id,
    'recordId', v_record.id,
    'integrityDigest', v_digest,
    'unlockedAt', v_now
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."create_amendment"(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."create_amendment"(uuid, text)
  TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.record_timeline — chronological history of a record aggregating
-- change_events, revisions, review_submissions, review_decisions,
-- review_check_results, signatures and comments. STABLE SECURITY DEFINER,
-- executable by authenticated; enforces workspace membership.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."record_timeline"(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid;
BEGIN
  v_workspace := nullif(api.claim_probe()->>'workspace_id', '')::uuid;
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.records
    WHERE id = p_record_id AND workspace_id = v_workspace
  ) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(event ORDER BY (event->>'ts')::timestamptz, (event->>'seq')::bigint), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'type', 'change_event',
        'id', e.id,
        'seq', e.sequence,
        'ts', to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'eventType', e.entity_type,
        'operation', e.operation,
        'actorUserId', e.actor_user_id,
        'title', e.entity_type || ' ' || e.operation,
        'payload', e.payload
      ) AS event
      FROM api.change_events e
      WHERE e.workspace_id = v_workspace AND e.record_id = p_record_id

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'revision',
        'id', r.id,
        'seq', NULL,
        'ts', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'reason', r.reason,
        'actorUserId', r.created_by_user_id,
        'title', 'revision ' || r.reason,
        'integrityDigest', r.integrity_digest,
        'supersededByRevisionId', r.superseded_by_revision_id
      )
      FROM api.revisions r
      WHERE r.record_id = p_record_id AND r.workspace_id = v_workspace

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'submission',
        'id', s.id,
        'seq', NULL,
        'ts', to_char(s.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'state', s.state,
        'actorUserId', s.submitted_by_user_id,
        'title', 'review ' || s.state,
        'revisionId', s.revision_id
      )
      FROM api.review_submissions s
      WHERE s.record_id = p_record_id AND s.workspace_id = v_workspace

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'decision',
        'id', d.id,
        'seq', NULL,
        'ts', to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'decision', d.decision,
        'actorUserId', d.actor_user_id,
        'title', 'review ' || d.decision,
        'note', d.note
      )
      FROM api.review_decisions d
      WHERE d.record_id = p_record_id AND d.workspace_id = v_workspace

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'check',
        'id', c.id,
        'seq', NULL,
        'ts', to_char(c.run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'overallStatus', c.overall_status,
        'actorUserId', c.run_by_user_id,
        'title', 'checks ' || c.overall_status,
        'revisionId', c.revision_id
      )
      FROM api.review_check_results c
      WHERE c.record_id = p_record_id AND c.workspace_id = v_workspace

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'signature',
        'id', sg.id,
        'seq', NULL,
        'ts', to_char(sg.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'signatureMeaning', sg.signature_meaning,
        'actorUserId', sg.signer_user_id,
        'title', 'signature ' || sg.signature_meaning,
        'revisionId', sg.revision_id
      )
      FROM api.signatures sg
      WHERE sg.record_id = p_record_id AND sg.workspace_id = v_workspace

      UNION ALL

      SELECT jsonb_build_object(
        'type', 'comment',
        'id', cm.id,
        'seq', NULL,
        'ts', to_char(cm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'state', cm.state,
        'actorUserId', cm.author_user_id,
        'title', 'comment ' || cm.state,
        'body', cm.body
      )
      FROM api.comments cm
      WHERE cm.record_id = p_record_id AND cm.workspace_id = v_workspace
    ) events
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."record_timeline"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."record_timeline"(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.export_revision_evidence — stable, machine-readable JSON bundle of the
-- review and signature evidence for a revision. SECURITY DEFINER STABLE,
-- executable by authenticated; enforces workspace membership. The bundle
-- includes the revision identity + canonical snapshot, its submission, every
-- decision, the latest check results, every signature and every comment.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."export_revision_evidence"(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid;
  v_revision api.revisions;
  v_submission jsonb;
  v_decisions jsonb;
  v_checks jsonb;
  v_signatures jsonb;
  v_comments jsonb;
BEGIN
  v_workspace := nullif(api.claim_probe()->>'workspace_id', '')::uuid;
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_revision FROM api.revisions
  WHERE id = p_revision_id AND workspace_id = v_workspace;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(s) INTO v_submission
  FROM api.review_submissions s
  WHERE s.revision_id = v_revision.id AND s.workspace_id = v_workspace
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at), '[]'::jsonb)
  INTO v_decisions
  FROM api.review_decisions d
  WHERE d.revision_id = v_revision.id AND d.workspace_id = v_workspace;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.run_at), '[]'::jsonb)
  INTO v_checks
  FROM api.review_check_results c
  WHERE c.revision_id = v_revision.id AND c.workspace_id = v_workspace;

  SELECT COALESCE(jsonb_agg(to_jsonb(sg) ORDER BY sg.signed_at), '[]'::jsonb)
  INTO v_signatures
  FROM api.signatures sg
  WHERE sg.revision_id = v_revision.id AND sg.workspace_id = v_workspace;

  SELECT COALESCE(jsonb_agg(to_jsonb(cm) ORDER BY cm.created_at), '[]'::jsonb)
  INTO v_comments
  FROM api.comments cm
  WHERE cm.revision_id = v_revision.id AND cm.workspace_id = v_workspace;

  RETURN jsonb_build_object(
    'formatVersion', 1,
    'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'workspaceId', v_workspace,
    'revision', jsonb_build_object(
      'id', v_revision.id,
      'record_id', v_revision.record_id,
      'reason', v_revision.reason,
      'structure_version', v_revision.structure_version,
      'metadata_version', v_revision.metadata_version,
      'integrity_algorithm', v_revision.integrity_algorithm,
      'integrity_digest', v_revision.integrity_digest,
      'canonical_snapshot', v_revision.canonical_snapshot,
      'superseded_by_revision_id', v_revision.superseded_by_revision_id,
      'created_at', v_revision.created_at,
      'created_by_user_id', v_revision.created_by_user_id
    ),
    'submission', COALESCE(v_submission, 'null'::jsonb),
    'decisions', v_decisions,
    'checkResults', v_checks,
    'signatures', v_signatures,
    'comments', v_comments
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."export_revision_evidence"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."export_revision_evidence"(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
