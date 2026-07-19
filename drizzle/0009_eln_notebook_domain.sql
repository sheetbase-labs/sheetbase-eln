-- ELN-002: notebook domain RLS, grants, triggers, integrity constraints,
-- and the create_record RPC that assigns stable type-prefixed identifiers.
--
-- Decision record 0015 fixes the vocabulary. This migration makes the
-- tables introduced by 0008_powerful_celestials safe to expose through
-- PostgREST: every new table gets workspace RLS, the updated_at trigger,
-- and grants; record_links gets a cross-workspace guard; blocks get a
-- unique (record_id, order) so duplicate ordering positions are prevented
-- at the DB; the create_record RPC assigns EXP-/PRT-/RPT- identifiers
-- server-side so clients cannot collide or guess.
--
-- RLS is ENABLED but not FORCED, matching AUTH-004: request roles are not
-- the table owner, so RLS is authoritative for every API path; the owner
-- (migrator) bypasses for migrations/seed/bootstrap.

-- ---------------------------------------------------------------------------
-- Self-referencing FKs that drizzle-kit does not generate.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."folders"
  ADD CONSTRAINT "folders_parent_id_folders_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "api"."folders"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "api"."revisions"
  ADD CONSTRAINT "revisions_superseded_by_revision_id_revisions_id_fk"
  FOREIGN KEY ("superseded_by_revision_id")
  REFERENCES "api"."revisions"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Integrity: no duplicate ordering positions; positive order; revisions
-- reference a record that still exists (cascade handles deletes); record
-- links cannot cross workspaces when the target is a notebook record.
-- ---------------------------------------------------------------------------

-- Duplicate ordering positions are prevented at the DB. The move/insert
-- RPCs (ELN-003) rebalance when fractional-indexing precision runs out.
ALTER TABLE "api"."blocks"
  ADD CONSTRAINT "uq_blocks_record_order" UNIQUE ("record_id", "order");--> statement-breakpoint

-- Cross-workspace record_link guard. RLS already prevents reading across
-- workspaces; this trigger prevents a writer from linking its record to a
-- target in a different workspace when target_record_id is set.
CREATE OR REPLACE FUNCTION "api"."assert_record_link_same_workspace"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_ws uuid;
  v_target_ws uuid;
BEGIN
  SELECT workspace_id INTO v_source_ws
    FROM "api"."records" WHERE id = NEW.source_record_id;
  IF v_source_ws IS NULL THEN
    RAISE EXCEPTION 'source record not found' USING ERRCODE = '23503';
  END IF;

  IF NEW.target_record_id IS NOT NULL THEN
    SELECT workspace_id INTO v_target_ws
      FROM "api"."records" WHERE id = NEW.target_record_id;
    IF v_target_ws IS NULL THEN
      RAISE EXCEPTION 'target record not found' USING ERRCODE = '23503';
    END IF;
    IF v_target_ws <> v_source_ws THEN
      RAISE EXCEPTION 'record link crosses workspaces' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "assert_record_link_same_workspace"
  BEFORE INSERT OR UPDATE OF "source_record_id", "target_record_id"
  ON "api"."record_links"
  FOR EACH ROW EXECUTE FUNCTION "api"."assert_record_link_same_workspace"();--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."assert_record_link_same_workspace"() FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- updated_at triggers on the new api tables (reuses internal.set_updated_at
-- from 0001).
-- ---------------------------------------------------------------------------
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."folders"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."records"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."blocks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."record_links"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."revisions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants. anon gets nothing; authenticated gets full CRUD on the notebook
-- domain except deletes on revisions (revisions are immutable history).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "api"."folders", "api"."records", "api"."blocks", "api"."record_links"
  TO authenticated;--> statement-breakpoint

-- Revisions are append-only history. No UPDATE/DELETE through PostgREST.
GRANT SELECT, INSERT ON "api"."revisions" TO authenticated;--> statement-breakpoint

-- External api_client gets read-only access to the notebook domain and
-- can create records/blocks/links (write scope is still enforced at the
-- application proxy before the request reaches PostgREST, as for
-- projects). Revisions are read-only.
GRANT SELECT ON "api"."folders" TO api_client;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."records" TO api_client;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."blocks" TO api_client;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."record_links" TO api_client;--> statement-breakpoint
GRANT SELECT ON "api"."revisions" TO api_client;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-level security. Every new table is workspace-scoped; the workspace_id
-- is pinned to the active claim on every path. blocks, record_links and
-- revisions do not carry workspace_id themselves — they inherit it through
-- their parent record, so the policies join to `records` (or `folders`/
-- `projects`) to recover the workspace. This keeps the workspace root
-- authoritative (decision 0006) without duplicating workspace_id on every
-- descendant row.
-- ---------------------------------------------------------------------------

-- folders: workspace_id is on the row.
ALTER TABLE "api"."folders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "folders_select" ON "api"."folders"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "folders_insert" ON "api"."folders"
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "folders_update" ON "api"."folders"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "folders_delete" ON "api"."folders"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

-- records: workspace_id is on the row.
ALTER TABLE "api"."records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "records_select" ON "api"."records"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "records_insert" ON "api"."records"
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
    AND created_by_user_id = "api"."current_user_id"()
  );--> statement-breakpoint

CREATE POLICY "records_update" ON "api"."records"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "records_delete" ON "api"."records"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

-- blocks: workspace inherited through record_id. Members read/write blocks
-- of records in their workspace; the record must not be soft-deleted for
-- writes (reads still see soft-deleted records' blocks for audit).
ALTER TABLE "api"."blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "blocks_select" ON "api"."blocks"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
    )
  );--> statement-breakpoint

CREATE POLICY "blocks_insert" ON "api"."blocks"
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY "blocks_update" ON "api"."blocks"
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY "blocks_delete" ON "api"."blocks"
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

-- record_links: workspace inherited through source_record_id.
ALTER TABLE "api"."record_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "record_links_select" ON "api"."record_links"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_insert" ON "api"."record_links"
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_update" ON "api"."record_links"
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_delete" ON "api"."record_links"
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
  );--> statement-breakpoint

-- revisions: workspace inherited through record_id; read by members, write
-- by members when the record is not deleted. No UPDATE/DELETE through RLS
-- (grants already prevent it; policies mirror that).
ALTER TABLE "api"."revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "revisions_select" ON "api"."revisions"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = revisions.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
    )
  );--> statement-breakpoint

CREATE POLICY "revisions_insert" ON "api"."revisions"
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = revisions.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
        AND "api"."is_workspace_member"(r.workspace_id)
        AND r.deleted_at IS NULL
    )
    AND created_by_user_id = "api"."current_user_id"()
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_client RLS: workspace_id pinned to the active claim, same shape as
-- the projects api_client policies (0007). No delete for any notebook
-- domain table through api_client.
-- ---------------------------------------------------------------------------
CREATE POLICY "folders_select_api_client" ON "api"."folders"
  FOR SELECT TO api_client
  USING (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "records_select_api_client" ON "api"."records"
  FOR SELECT TO api_client
  USING (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "records_insert_api_client" ON "api"."records"
  FOR INSERT TO api_client
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "records_update_api_client" ON "api"."records"
  FOR UPDATE TO api_client
  USING (workspace_id = "api"."current_workspace_id"())
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "blocks_select_api_client" ON "api"."blocks"
  FOR SELECT TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "blocks_insert_api_client" ON "api"."blocks"
  FOR INSERT TO api_client
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "blocks_update_api_client" ON "api"."blocks"
  FOR UPDATE TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = blocks.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_select_api_client" ON "api"."record_links"
  FOR SELECT TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_insert_api_client" ON "api"."record_links"
  FOR INSERT TO api_client
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "record_links_update_api_client" ON "api"."record_links"
  FOR UPDATE TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = record_links.source_record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

CREATE POLICY "revisions_select_api_client" ON "api"."revisions"
  FOR SELECT TO api_client
  USING (
    EXISTS (
      SELECT 1 FROM "api"."records" r
      WHERE r.id = revisions.record_id
        AND r.workspace_id = "api"."current_workspace_id"()
    )
  );--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_record RPC: assigns a stable, type-prefixed, project-scoped
-- identifier (EXP-/PRT-/RPT-YYYY-NNNN) server-side so clients cannot
-- collide, pick poor identifiers, or guess other projects' identifiers.
-- Runs as the caller (SECURITY INVOKER); the INSERT inside is still subject
-- to the records_insert RLS policy (defence in depth).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_record"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}'
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_prefix text;
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
  v_identifier text;
  v_row "api"."records";
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  -- Kind → prefix. Widen here when a new record kind is added to the check
  -- constraint (decision 0015).
  v_prefix := CASE p_kind
    WHEN 'experiment' THEN 'EXP'
    WHEN 'protocol_template' THEN 'PRT'
    WHEN 'report' THEN 'RPT'
    ELSE NULL
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'unsupported record kind: %', p_kind USING ERRCODE = '23514';
  END IF;

  -- Verify the project is in the caller's workspace (RLS also enforces this
  -- on the INSERT, but checking here gives a clear error before the INSERT).
  IF NOT EXISTS (
    SELECT 1 FROM "api"."projects" p
    WHERE p.id = p_project_id
      AND p.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Per-(project, prefix, year) sequence from the existing identifiers.
  -- Project-scoped per decision 0015. lpad to 4 digits matches the mockups.
  SELECT count(*) + 1 INTO v_seq
    FROM "api"."records"
    WHERE project_id = p_project_id
      AND identifier LIKE v_prefix || '-' || v_year || '-%';

  v_identifier := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  -- Normalise the title.
  p_title := btrim(coalesce(p_title, ''));
  IF p_title = '' THEN
    p_title := v_identifier;
  END IF;

  INSERT INTO "api"."records"
    (workspace_id, project_id, kind, identifier, title, status, tags, created_by_user_id)
  VALUES
    (v_workspace_id, p_project_id, p_kind, v_identifier, p_title, p_status, p_tags, "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[]) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
