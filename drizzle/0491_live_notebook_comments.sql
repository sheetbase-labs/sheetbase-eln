-- Phase 6 (bench) — notebook comments without a review.
--
-- Until now an api.comments row was anchored either to an immutable revision
-- (review comments) or to a live Sheet Instance. A notebook (or one of its
-- blocks) could be discussed only through the Liveblocks collaboration room, so
-- a deployment without that substrate had no way to comment on a notebook at
-- all. This adds the third anchor the same table can carry: a live notebook
-- record, optionally narrowed to one of its blocks.
--
--   target_kind 'record'  target {}                     the whole notebook
--   target_kind 'block'   target {"blockId": "<uuid>"}  one block (revision_id NULL)
--
-- A reply, a resolve and a reopen need no new function: reply_to_comment
-- inherits the anchor of its parent and resolve/reopen change state only, and
-- the guard trigger below now authorises all three for a live record comment.
-- @mentions are stored on the row exactly as for review comments, so the
-- existing comment_or_mention notification fires for the people named.

-- 1. The anchor constraints learn the live record anchor.
ALTER TABLE "api"."comments" DROP CONSTRAINT "chk_comments_target_kind";
--> statement-breakpoint
ALTER TABLE "api"."comments" DROP CONSTRAINT "chk_comments_anchor_owner";
--> statement-breakpoint
ALTER TABLE "api"."comments" ADD CONSTRAINT "chk_comments_target_kind"
  CHECK (target_kind IN ('revision', 'block', 'table_region', 'diff', 'record', 'sheet_cell', 'sheet_row', 'sheet_range'));
--> statement-breakpoint
ALTER TABLE "api"."comments" ADD CONSTRAINT "chk_comments_anchor_owner"
  CHECK (
    (
      (target_kind IN ('sheet_cell', 'sheet_row', 'sheet_range') AND sheet_instance_id IS NOT NULL)
      OR (target_kind IN ('revision', 'block', 'table_region', 'diff', 'record') AND sheet_instance_id IS NULL)
    )
    AND (
      revision_id IS NOT NULL
      OR sheet_instance_id IS NOT NULL
      OR (target_kind IN ('record', 'block') AND record_id IS NOT NULL)
    )
    AND (revision_id IS NULL OR record_id IS NOT NULL)
  );
--> statement-breakpoint

-- 2. The anchor guard authorises a live record comment: a workspace writer on a
-- record that is not archived and not in an archived project.
CREATE OR REPLACE FUNCTION internal.guard_comment_anchor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_workspace uuid; owner_record uuid; root api.comments; instance api.sheet_instances; rec api.records;
BEGIN
  IF NEW.revision_id IS NULL AND NEW.sheet_instance_id IS NULL
     AND (TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    SELECT * INTO rec FROM api.records WHERE id=NEW.record_id;
    IF rec.id IS NULL OR rec.workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
       OR NOT api.is_workspace_writer(rec.workspace_id) THEN
      RAISE EXCEPTION 'Notebook comment denied' USING ERRCODE='42501';
    END IF;
    IF rec.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'record is archived' USING ERRCODE='SB004';
    END IF;
    IF rec.project_id IS NOT NULL AND internal.project_is_archived(rec.project_id) THEN
      RAISE EXCEPTION 'project is archived' USING ERRCODE='SB004';
    END IF;
  ELSIF NEW.revision_id IS NULL AND (TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    SELECT * INTO instance FROM api.sheet_instances WHERE id=NEW.sheet_instance_id;
    IF instance.workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
       OR NOT api.is_workspace_writer(instance.workspace_id) THEN
      RAISE EXCEPTION 'Sheet comment denied' USING ERRCODE='42501';
    END IF;
    IF instance.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet is archived' USING ERRCODE='SB073'; END IF;
    IF instance.project_id IS NOT NULL AND internal.project_is_archived(instance.project_id) THEN
      RAISE EXCEPTION 'project is archived' USING ERRCODE='SB004';
    END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.workspace_id,NEW.record_id,NEW.revision_id,NEW.sheet_instance_id,NEW.root_id,NEW.parent_id,NEW.target_kind,NEW.target)
       IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.record_id,OLD.revision_id,OLD.sheet_instance_id,OLD.root_id,OLD.parent_id,OLD.target_kind,OLD.target) THEN
      RAISE EXCEPTION 'comment ownership and anchor are immutable' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.revision_id IS NOT NULL THEN
    SELECT workspace_id,record_id INTO owner_workspace,owner_record FROM api.revisions WHERE id=NEW.revision_id;
  ELSIF NEW.sheet_instance_id IS NOT NULL THEN
    SELECT workspace_id,notebook_record_id INTO owner_workspace,owner_record FROM api.sheet_instances WHERE id=NEW.sheet_instance_id;
  ELSE
    SELECT workspace_id,id INTO owner_workspace,owner_record FROM api.records WHERE id=NEW.record_id;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM owner_workspace OR NEW.record_id IS DISTINCT FROM owner_record THEN
    RAISE EXCEPTION 'comment ownership mismatch' USING ERRCODE='42501';
  END IF;
  IF NEW.sheet_instance_id IS NOT NULL AND NEW.target->>'instanceId' IS DISTINCT FROM NEW.sheet_instance_id::text THEN
    RAISE EXCEPTION 'comment Instance mismatch' USING ERRCODE='42501';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO root FROM api.comments WHERE id=NEW.root_id;
    IF (NEW.workspace_id,NEW.record_id,NEW.revision_id,NEW.sheet_instance_id,NEW.target_kind,NEW.target)
       IS DISTINCT FROM (root.workspace_id,root.record_id,root.revision_id,root.sheet_instance_id,root.target_kind,root.target)
       OR NOT EXISTS(SELECT 1 FROM api.comments WHERE id=NEW.parent_id AND root_id=NEW.root_id) THEN
      RAISE EXCEPTION 'reply must inherit root ownership and anchor' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- 3. Start a thread on a live notebook, or on one of its blocks.
CREATE OR REPLACE FUNCTION api.create_record_comment(
  p_record_id uuid,
  p_target_kind text,
  p_target jsonb,
  p_body text,
  p_mentions text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rec api.records;
  v_target jsonb;
  v_id uuid := gen_random_uuid();
  v_row api.comments;
BEGIN
  SELECT * INTO v_rec FROM api.records WHERE id = p_record_id;
  IF v_rec.id IS NULL
     OR v_rec.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
     OR api.current_user_id() IS NULL
     OR NOT api.is_workspace_writer(v_rec.workspace_id)
     OR NOT internal.can_access_object('record', v_rec.id, 'view') THEN
    RAISE EXCEPTION 'Notebook comment denied' USING ERRCODE = '42501';
  END IF;
  IF p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'comment body is required' USING ERRCODE = '22023';
  END IF;
  IF p_target_kind = 'record' THEN
    v_target := '{}'::jsonb;
  ELSIF p_target_kind = 'block' THEN
    IF jsonb_typeof(p_target) IS DISTINCT FROM 'object'
       OR (p_target - 'blockId') <> '{}'::jsonb
       OR coalesce(p_target->>'blockId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid block comment anchor' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM api.blocks b
       WHERE b.id = (p_target->>'blockId')::uuid AND b.record_id = v_rec.id
    ) THEN
      RAISE EXCEPTION 'block is not part of this notebook' USING ERRCODE = 'SB002';
    END IF;
    v_target := jsonb_build_object('blockId', lower(p_target->>'blockId'));
  ELSE
    RAISE EXCEPTION 'a notebook comment is anchored to the notebook or to a block' USING ERRCODE = '22023';
  END IF;

  -- The guard trigger enforces writer access and the archive checks on insert.
  INSERT INTO api.comments (
    id, workspace_id, revision_id, record_id, sheet_instance_id, root_id, parent_id,
    target_kind, target, body, mentions, state, author_user_id
  ) VALUES (
    v_id, v_rec.workspace_id, NULL, v_rec.id, NULL, v_id, NULL,
    p_target_kind, v_target, p_body,
    internal.normalise_mentions(v_rec.workspace_id, p_mentions), 'open',
    api.current_user_id()
  ) RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(
    v_rec.workspace_id, 'comment', v_row.id, 'create', v_rec.id, v_rec.project_id,
    jsonb_build_object(
      'commentId', v_row.id, 'revisionId', NULL, 'threadRootId', v_row.id,
      'parentId', NULL, 'targetKind', p_target_kind, 'state', 'open'
    )
  );

  RETURN jsonb_build_object(
    'id', v_row.id, 'revisionId', NULL, 'rootId', v_row.id, 'parentId', NULL,
    'targetKind', v_row.target_kind, 'target', v_row.target, 'body', v_row.body,
    'mentions', v_row.mentions, 'state', v_row.state,
    'authorUserId', v_row.author_user_id, 'createdAt', v_row.created_at
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_record_comment(uuid, text, jsonb, text, text[]) FROM PUBLIC, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_record_comment(uuid, text, jsonb, text, text[]) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
