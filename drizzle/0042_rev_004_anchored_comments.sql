-- REV-004: anchored comments and resolutions on submitted revisions.
--
-- Comments are anchored to an immutable revision (api.revisions) plus a
-- stable target descriptor, so later draft edits can never silently move a
-- comment to unrelated content. Targets reference entities by their stable
-- snapshot identity (block id, table id, row/column id) or a deterministic
-- diff change id between two immutable revisions; both sides are frozen, so
-- the anchor never drifts.
--
-- Threading uses root_id (self for top-level) and parent_id (direct parent).
-- Resolution is a thread-level state stored on the root comment; replies are
-- always 'open'. Author attribution is honest about departed users: the
-- author_user_id FK is ON DELETE SET NULL and the UI renders "Deleted user"
-- when it is null.
--
-- Writes happen only through SECURITY DEFINER RPCs (create/reply/resolve/
-- reopen); request roles get SELECT plus EXECUTE on the RPCs and nothing
-- else, so target validation, permission and mention checks are enforced in
-- one place. Each RPC emits a durable change event through the existing
-- internal.emit_change_event channel.

-- Widen the durable change-event vocabulary for comment entities and
-- resolution transitions.
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'comment'
  ));
--> statement-breakpoint
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_operation";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_operation"
  CHECK ("api"."change_events"."operation" IN (
    'create', 'update', 'move', 'delete', 'archive', 'restore',
    'link', 'unlink', 'quarantine', 'resolve', 'reopen'
  ));
--> statement-breakpoint

CREATE TABLE "api"."comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL
    REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  -- The immutable revision the comment is anchored to. Never cascades away;
  -- a record with a revision cannot be deleted (revisions RESTRICT), so the
  -- anchor is durable for the life of the evidence.
  "revision_id" uuid NOT NULL
    REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "record_id" uuid NOT NULL
    REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  -- Thread structure. root_id is self for a top-level comment; parent_id is
  -- the direct parent for a reply (null for top-level). Both RESTRICT so a
  -- comment with replies cannot be removed (no delete RPC exists today, but
  -- the constraint is defence-in-depth).
  "root_id" uuid NOT NULL
    REFERENCES "api"."comments"("id") ON DELETE RESTRICT,
  "parent_id" uuid
    REFERENCES "api"."comments"("id") ON DELETE RESTRICT,
  -- Anchored target within the immutable revision. target_kind + target.
  --   revision:     {} (the whole submitted revision)
  --   block:        {"blockId": "..."}
  --   table_region: {"tableId": "...", "rowId": "...?", "columnId": "...?"}
  --   diff:         {"comparisonRevisionId": "...", "changeId": "...",
  --                  "area": "...", "identity": "..."}
  "target_kind" text NOT NULL,
  "target" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "body" text NOT NULL,
  "mentions" text[] NOT NULL DEFAULT '{}',
  -- Thread-level resolution state. Only the root carries 'resolved'; replies
  -- are always 'open' and inherit the thread state for display.
  "state" text NOT NULL DEFAULT 'open',
  "resolved_at" timestamptz,
  "resolved_by_user_id" text
    REFERENCES "internal"."user"("id") ON DELETE SET NULL,
  "author_user_id" text
    REFERENCES "internal"."user"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_comments_target_kind"
    CHECK (target_kind IN ('revision', 'block', 'table_region', 'diff')),
  CONSTRAINT "chk_comments_state"
    CHECK (state IN ('open', 'resolved')),
  CONSTRAINT "chk_comments_body"
    CHECK (length(body) BETWEEN 1 AND 8000),
  CONSTRAINT "chk_comments_resolved_consistency"
    CHECK ((state = 'resolved') = (resolved_at IS NOT NULL)),
  CONSTRAINT "chk_comments_root_parent"
    CHECK ((parent_id IS NULL) = (root_id = id))
);
--> statement-breakpoint

CREATE INDEX "idx_comments_workspace_revision"
  ON "api"."comments" ("workspace_id", "revision_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_comments_root"
  ON "api"."comments" ("workspace_id", "root_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_comments_record"
  ON "api"."comments" ("workspace_id", "record_id");
--> statement-breakpoint

ALTER TABLE "api"."comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "comments_select" ON "api"."comments"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );
--> statement-breakpoint

-- No INSERT/UPDATE/DELETE grants to request roles: writes go through the
-- SECURITY DEFINER RPCs below, which run as the table owner and bypass RLS.
GRANT SELECT ON "api"."comments" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Target validation. Validates the anchored target against the immutable
-- revision snapshot so a comment can never be created against a target that
-- does not exist in the frozen evidence. SECURITY DEFINER (migrator-owned)
-- so it can read the revision row regardless of caller role.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."validate_comment_target"(
  p_revision_id uuid,
  p_target_kind text,
  p_target jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_revision api.revisions;
  v_snapshot jsonb;
  v_block_id text;
  v_table_id text;
  v_row_id text;
  v_column_id text;
  v_comparison_revision_id text;
  v_comparison_record_id uuid;
BEGIN
  SELECT * INTO v_revision FROM api.revisions WHERE id = p_revision_id;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found' USING ERRCODE = '22023';
  END IF;
  v_snapshot := v_revision.canonical_snapshot;

  IF p_target_kind = 'revision' THEN
    RETURN;
  ELSIF p_target_kind = 'block' THEN
    v_block_id := p_target->>'blockId';
    IF v_block_id IS NULL OR v_block_id = '' THEN
      RAISE EXCEPTION 'block target requires blockId' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_snapshot->'blocks') = 'array'
          THEN v_snapshot->'blocks' ELSE '[]'::jsonb END
      ) block WHERE block->>'id' = v_block_id
    ) THEN
      RAISE EXCEPTION 'block target is not present in the revision snapshot'
        USING ERRCODE = 'SB002';
    END IF;
  ELSIF p_target_kind = 'table_region' THEN
    v_table_id := p_target->>'tableId';
    IF v_table_id IS NULL OR v_table_id = '' THEN
      RAISE EXCEPTION 'table_region target requires tableId'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_snapshot->'scientificTables') = 'array'
          THEN v_snapshot->'scientificTables' ELSE '[]'::jsonb END
      ) tbl WHERE tbl->>'id' = v_table_id
    ) THEN
      RAISE EXCEPTION 'table target is not present in the revision snapshot'
        USING ERRCODE = 'SB002';
    END IF;
    -- rowId/columnId are optional (a region may target the whole table). When
    -- supplied, validate them against the snapshot's rows/columns.
    v_row_id := p_target->>'rowId';
    v_column_id := p_target->>'columnId';
    IF v_column_id IS NOT NULL AND v_column_id <> '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_snapshot->'scientificTables') = 'array'
            THEN v_snapshot->'scientificTables' ELSE '[]'::jsonb END
        ) tbl,
        jsonb_array_elements(
          CASE WHEN jsonb_typeof(tbl->'columns') = 'array'
            THEN tbl->'columns' ELSE '[]'::jsonb END
        ) col
        WHERE tbl->>'id' = v_table_id AND col->>'id' = v_column_id
      ) THEN
        RAISE EXCEPTION 'column target is not present in the revision snapshot'
          USING ERRCODE = 'SB002';
      END IF;
    END IF;
    IF v_row_id IS NOT NULL AND v_row_id <> '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_snapshot->'scientificTables') = 'array'
            THEN v_snapshot->'scientificTables' ELSE '[]'::jsonb END
        ) tbl,
        jsonb_array_elements(
          CASE WHEN jsonb_typeof(tbl->'rows') = 'array'
            THEN tbl->'rows' ELSE '[]'::jsonb END
        ) row
        WHERE tbl->>'id' = v_table_id AND row->>'id' = v_row_id
      ) THEN
        RAISE EXCEPTION 'row target is not present in the revision snapshot'
          USING ERRCODE = 'SB002';
      END IF;
    END IF;
  ELSIF p_target_kind = 'diff' THEN
    v_comparison_revision_id := p_target->>'comparisonRevisionId';
    IF v_comparison_revision_id IS NULL OR v_comparison_revision_id = '' THEN
      RAISE EXCEPTION 'diff target requires comparisonRevisionId'
        USING ERRCODE = '22023';
    END IF;
    IF (p_target->>'changeId') IS NULL OR (p_target->>'changeId') = '' THEN
      RAISE EXCEPTION 'diff target requires changeId' USING ERRCODE = '22023';
    END IF;
    -- The comparison revision must exist and belong to the same workspace
    -- and record, so the diff (and its deterministic change ids) is stable.
    SELECT record_id INTO v_comparison_record_id FROM api.revisions
    WHERE id = v_comparison_revision_id::uuid
      AND workspace_id = v_revision.workspace_id
      AND record_id = v_revision.record_id;
    IF v_comparison_record_id IS NULL THEN
      RAISE EXCEPTION 'diff comparison revision is not in this workspace/record'
        USING ERRCODE = 'SB002';
    END IF;
  ELSE
    RAISE EXCEPTION 'unknown comment target kind' USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."validate_comment_target"(uuid, text, jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- Normalise and validate mention user ids against workspace membership.
CREATE FUNCTION "internal"."normalise_mentions"(
  p_workspace_id uuid,
  p_mentions text[]
)
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_normalised text[];
BEGIN
  SELECT coalesce(array_agg(mention ORDER BY mention), ARRAY[]::text[]) INTO v_normalised
  FROM (SELECT DISTINCT unnest(coalesce(p_mentions, ARRAY[]::text[])) mention) mentions
  WHERE mention IS NOT NULL AND mention <> ''
    AND EXISTS (
      SELECT 1 FROM api.workspace_memberships m
      WHERE m.workspace_id = p_workspace_id AND m.user_id = mention
    );
  RETURN v_normalised;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."normalise_mentions"(uuid, text[])
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create_comment: anchor a new top-level comment to an immutable revision.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."create_comment"(
  p_revision_id uuid,
  p_target_kind text,
  p_target jsonb,
  p_body text,
  p_mentions text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_revision api.revisions;
  v_record_workspace uuid;
  v_record_project uuid;
  v_id uuid;
  v_mentions text[];
  v_row api.comments;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  IF v_workspace IS NULL OR v_actor IS NULL
     OR (v_claims->>'role') <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'comment body is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_revision FROM api.revisions
  WHERE id = p_revision_id AND workspace_id = v_workspace;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- Enforce workspace membership over the revision's record as well.
  SELECT workspace_id, project_id INTO v_record_workspace, v_record_project
  FROM api.records WHERE id = v_revision.record_id;
  IF v_record_workspace IS NULL OR v_record_workspace <> v_workspace THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  PERFORM internal.validate_comment_target(p_revision_id, p_target_kind, p_target);
  v_mentions := internal.normalise_mentions(v_workspace, p_mentions);

  v_id := gen_random_uuid();
  INSERT INTO api.comments (
    id, workspace_id, revision_id, record_id, root_id, parent_id,
    target_kind, target, body, mentions, state, author_user_id
  ) VALUES (
    v_id, v_workspace, p_revision_id, v_revision.record_id, v_id, NULL,
    p_target_kind, COALESCE(p_target, '{}'::jsonb), p_body, v_mentions, 'open',
    v_actor
  ) RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(
    v_workspace, 'comment', v_row.id, 'create', v_revision.record_id,
    v_record_project,
    jsonb_build_object(
      'commentId', v_row.id, 'revisionId', p_revision_id,
      'threadRootId', v_row.root_id, 'parentId', NULL,
      'targetKind', p_target_kind, 'state', 'open'
    )
  );

  RETURN jsonb_build_object(
    'id', v_row.id, 'revisionId', p_revision_id, 'rootId', v_row.root_id,
    'parentId', NULL, 'targetKind', p_target_kind, 'target', v_row.target,
    'body', v_row.body, 'mentions', v_row.mentions, 'state', v_row.state,
    'authorUserId', v_row.author_user_id, 'createdAt', v_row.created_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."create_comment"(uuid, text, jsonb, text, text[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."create_comment"(uuid, text, jsonb, text, text[])
  TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- reply_to_comment: append a reply inheriting the thread's anchor and root.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."reply_to_comment"(
  p_parent_id uuid,
  p_body text,
  p_mentions text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_parent api.comments;
  v_record_project uuid;
  v_id uuid;
  v_mentions text[];
  v_row api.comments;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  IF v_workspace IS NULL OR v_actor IS NULL
     OR (v_claims->>'role') <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'comment body is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_parent FROM api.comments
  WHERE id = p_parent_id AND workspace_id = v_workspace;
  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT project_id INTO v_record_project FROM api.records
  WHERE id = v_parent.record_id;

  v_mentions := internal.normalise_mentions(v_workspace, p_mentions);
  v_id := gen_random_uuid();
  INSERT INTO api.comments (
    id, workspace_id, revision_id, record_id, root_id, parent_id,
    target_kind, target, body, mentions, state, author_user_id
  ) VALUES (
    v_id, v_workspace, v_parent.revision_id, v_parent.record_id,
    v_parent.root_id, v_parent.id, v_parent.target_kind, v_parent.target,
    p_body, v_mentions, 'open', v_actor
  ) RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(
    v_workspace, 'comment', v_row.id, 'create', v_parent.record_id,
    v_record_project,
    jsonb_build_object(
      'commentId', v_row.id, 'revisionId', v_parent.revision_id,
      'threadRootId', v_row.root_id, 'parentId', v_parent.id,
      'targetKind', v_parent.target_kind, 'state', 'open'
    )
  );

  RETURN jsonb_build_object(
    'id', v_row.id, 'revisionId', v_parent.revision_id, 'rootId', v_row.root_id,
    'parentId', v_parent.id, 'targetKind', v_parent.target_kind,
    'target', v_row.target, 'body', v_row.body, 'mentions', v_row.mentions,
    'state', v_row.state, 'authorUserId', v_row.author_user_id,
    'createdAt', v_row.created_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."reply_to_comment"(uuid, text, text[])
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."reply_to_comment"(uuid, text, text[])
  TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- resolve_comment_thread / reopen_comment_thread: thread-level resolution
-- state transitions on the root comment. Any workspace member may resolve or
-- reopen; the workspace membership is the permission boundary for a
-- collaborative ELN review.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."resolve_comment_thread"(p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_root api.comments;
  v_record_project uuid;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  IF v_workspace IS NULL OR v_actor IS NULL
     OR (v_claims->>'role') <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_root FROM api.comments
  WHERE id = p_comment_id AND workspace_id = v_workspace;
  IF v_root.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  -- Resolve at the thread root.
  IF v_root.root_id <> v_root.id THEN
    SELECT * INTO v_root FROM api.comments
    WHERE id = v_root.root_id AND workspace_id = v_workspace;
  END IF;
  IF v_root.state = 'resolved' THEN
    RAISE EXCEPTION 'thread is already resolved' USING ERRCODE = 'SB003';
  END IF;

  SELECT project_id INTO v_record_project FROM api.records
  WHERE id = v_root.record_id;

  UPDATE api.comments
  SET state = 'resolved', resolved_at = clock_timestamp(),
      resolved_by_user_id = v_actor, updated_at = clock_timestamp()
  WHERE id = v_root.id;

  PERFORM internal.emit_change_event(
    v_workspace, 'comment', v_root.id, 'resolve', v_root.record_id,
    v_record_project,
    jsonb_build_object(
      'commentId', v_root.id, 'revisionId', v_root.revision_id,
      'threadRootId', v_root.id, 'resolvedByUserId', v_actor,
      'state', 'resolved'
    )
  );

  RETURN jsonb_build_object(
    'id', v_root.id, 'state', 'resolved', 'resolvedByUserId', v_actor,
    'resolvedAt', clock_timestamp()
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."resolve_comment_thread"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."resolve_comment_thread"(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."reopen_comment_thread"(p_comment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_root api.comments;
  v_record_project uuid;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  IF v_workspace IS NULL OR v_actor IS NULL
     OR (v_claims->>'role') <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_root FROM api.comments
  WHERE id = p_comment_id AND workspace_id = v_workspace;
  IF v_root.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF v_root.root_id <> v_root.id THEN
    SELECT * INTO v_root FROM api.comments
    WHERE id = v_root.root_id AND workspace_id = v_workspace;
  END IF;
  IF v_root.state = 'open' THEN
    RAISE EXCEPTION 'thread is already open' USING ERRCODE = 'SB003';
  END IF;

  SELECT project_id INTO v_record_project FROM api.records
  WHERE id = v_root.record_id;

  UPDATE api.comments
  SET state = 'open', resolved_at = NULL, resolved_by_user_id = NULL,
      updated_at = clock_timestamp()
  WHERE id = v_root.id;

  PERFORM internal.emit_change_event(
    v_workspace, 'comment', v_root.id, 'reopen', v_root.record_id,
    v_record_project,
    jsonb_build_object(
      'commentId', v_root.id, 'revisionId', v_root.revision_id,
      'threadRootId', v_root.id, 'reopenedByUserId', v_actor,
      'state', 'open'
    )
  );

  RETURN jsonb_build_object(
    'id', v_root.id, 'state', 'open'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."reopen_comment_thread"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."reopen_comment_thread"(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
