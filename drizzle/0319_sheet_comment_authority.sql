-- SHEET-03 extends the existing comments authority. Live threads follow the
-- Instance; revision threads follow immutable evidence, not current data.
CREATE FUNCTION internal.validate_sheet_comment_shape(p_kind text, p_target jsonb)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE instance_id uuid; n_rows integer; n_fields integer; identity text;
BEGIN
  IF p_kind NOT IN ('sheet_cell','sheet_row','sheet_range')
     OR jsonb_typeof(p_target) IS DISTINCT FROM 'object'
     OR p_target-ARRAY['instanceId','rowKeys','fieldIds'] <> '{}'::jsonb
     OR jsonb_typeof(p_target->'rowKeys') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_target->'fieldIds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid Sheet comment anchor' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements((p_target->'rowKeys')||(p_target->'fieldIds')) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'Sheet comment identities must be strings' USING ERRCODE='22023';
  END IF;
  instance_id:=internal.sheet_definition_uuid(p_target->>'instanceId','comment instance');
  n_rows:=jsonb_array_length(p_target->'rowKeys');
  n_fields:=jsonb_array_length(p_target->'fieldIds');
  IF n_rows NOT BETWEEN 1 AND 500 OR n_fields>256
     OR (p_kind='sheet_cell' AND (n_rows<>1 OR n_fields<>1))
     OR (p_kind='sheet_row' AND (n_rows<>1 OR n_fields<>0))
     OR (p_kind='sheet_range' AND n_fields=0)
     OR n_rows<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(p_target->'rowKeys'))
     OR n_fields<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(p_target->'fieldIds')) THEN
    RAISE EXCEPTION 'invalid Sheet comment cardinality' USING ERRCODE='22023';
  END IF;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'rowKeys') LOOP
    IF identity !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       AND identity !~ '^sb-row-v1:[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Sheet comment requires stable row identities' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'fieldIds') LOOP
    PERFORM internal.sheet_definition_uuid(identity,'comment field');
  END LOOP;
  RETURN instance_id;
END $$;
REVOKE ALL ON FUNCTION internal.validate_sheet_comment_shape(text,jsonb) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- Retain all existing revision target validation and add canonical Sheet targets.
ALTER FUNCTION internal.validate_comment_target(uuid,text,jsonb) RENAME TO validate_comment_target_legacy;
CREATE FUNCTION internal.validate_comment_target(p_revision_id uuid,p_target_kind text,p_target jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE revision api.revisions; evidence api.revision_sheet_evidence; v_instance_id uuid; identity text;
BEGIN
  SELECT * INTO revision FROM api.revisions WHERE id=p_revision_id;
  IF revision.id IS NULL THEN RAISE EXCEPTION 'revision not found' USING ERRCODE='22023'; END IF;
  IF internal.revision_integrity_digest(revision.canonical_snapshot) IS DISTINCT FROM revision.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity mismatch' USING ERRCODE='SB092';
  END IF;
  IF p_target_kind NOT IN ('sheet_cell','sheet_row','sheet_range') THEN
    PERFORM internal.validate_comment_target_legacy(p_revision_id,p_target_kind,p_target);
    RETURN;
  END IF;
  v_instance_id:=internal.validate_sheet_comment_shape(p_target_kind,p_target);
  SELECT e.* INTO evidence FROM api.revision_sheet_evidence e
    WHERE e.revision_id=p_revision_id AND e.instance_id=v_instance_id
      AND e.workspace_id=revision.workspace_id;
  IF evidence.id IS NULL OR jsonb_typeof(evidence.composed_grid->'rowKeys') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'canonical Sheet identities unavailable in frozen evidence' USING ERRCODE='SB002';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(revision.canonical_snapshot->'sheetEvidence','[]')) s
    WHERE s->>'blockId'=evidence.block_id::text AND s->>'instanceId'=evidence.instance_id::text
      AND s->'instanceState'=evidence.instance_state AND (s->>'instanceRevision')::bigint=evidence.instance_revision) THEN
    RAISE EXCEPTION 'frozen Sheet evidence does not match verified revision' USING ERRCODE='SB092';
  END IF;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'rowKeys') LOOP
    IF NOT evidence.composed_grid->'rowKeys' ? identity THEN
      RAISE EXCEPTION 'row absent from frozen Sheet evidence' USING ERRCODE='SB002';
    END IF;
  END LOOP;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'fieldIds') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence.composed_grid->'columns') c WHERE c->>'id'=identity) THEN
      RAISE EXCEPTION 'field absent from frozen Sheet evidence' USING ERRCODE='SB002';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION internal.validate_comment_target(uuid,text,jsonb) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION internal.guard_comment_anchor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_workspace uuid; owner_record uuid; root api.comments; instance api.sheet_instances;
BEGIN
  IF NEW.revision_id IS NULL AND (TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
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
  ELSE
    SELECT workspace_id,notebook_record_id INTO owner_workspace,owner_record FROM api.sheet_instances WHERE id=NEW.sheet_instance_id;
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
CREATE TRIGGER guard_comment_anchor BEFORE INSERT OR UPDATE ON api.comments FOR EACH ROW EXECUTE FUNCTION internal.guard_comment_anchor();
REVOKE ALL ON FUNCTION internal.guard_comment_anchor() FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- Invoker read checks deliberately consult the actual Instance/Record RLS,
-- including future project ACL changes, rather than copying a visibility policy.
DROP POLICY comments_select ON api.comments;
CREATE POLICY comments_select ON api.comments FOR SELECT TO authenticated USING (
  workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)
  AND (record_id IS NULL OR EXISTS(SELECT 1 FROM api.records r WHERE r.id=comments.record_id))
  AND (sheet_instance_id IS NULL OR EXISTS(SELECT 1 FROM api.sheet_instances s WHERE s.id=comments.sheet_instance_id))
  AND (revision_id IS NULL OR EXISTS(SELECT 1 FROM api.revisions r WHERE r.id=comments.revision_id))
);
--> statement-breakpoint

CREATE FUNCTION api.create_sheet_comment(p_instance_id uuid,p_expected_instance_revision bigint,p_target_kind text,p_target jsonb,p_body text,p_mentions text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; config jsonb; field_ids text[]; row_ids text[];
  identity text; page jsonb; offset_value integer:=0; item jsonb; comment api.comments; id uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE sheet_instances.id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR instance.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' OR api.current_user_id() IS NULL
     OR NOT api.is_workspace_writer(instance.workspace_id) THEN
    RAISE EXCEPTION 'Sheet comment denied' USING ERRCODE='42501';
  END IF;
  IF instance.lifecycle<>'active' OR instance.revision IS DISTINCT FROM p_expected_instance_revision THEN
    RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073';
  END IF;
  IF instance.project_id IS NOT NULL AND internal.project_is_archived(instance.project_id) THEN
    RAISE EXCEPTION 'project is archived' USING ERRCODE='SB004';
  END IF;
  IF internal.validate_sheet_comment_shape(p_target_kind,p_target)<>instance.id THEN
    RAISE EXCEPTION 'Sheet comment Instance mismatch' USING ERRCODE='22023';
  END IF;
  IF p_body IS NULL OR length(p_body) NOT BETWEEN 1 AND 8000 THEN
    RAISE EXCEPTION 'comment body is required' USING ERRCODE='22023';
  END IF;
  IF instance.source_definition_version_id IS NOT NULL THEN
    SELECT configuration INTO config FROM api.sheet_definition_versions WHERE sheet_definition_versions.id=instance.source_definition_version_id;
  END IF;
  field_ids:=ARRAY(SELECT f->>'fieldId' FROM jsonb_array_elements(instance.state->'localFields') f WHERE f->>'lifecycle'='active')
    || ARRAY(SELECT c->>'id' FROM jsonb_array_elements(coalesce(config->'columns','[]')) c)
    || ARRAY(SELECT c->'outputField'->>'fieldId' FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]')) c WHERE c->>'lifecycle'='active');
  row_ids:=ARRAY(SELECT key FROM jsonb_each(instance.state->'localValues') WHERE key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
  IF instance.state->'resolvedRowIdentity'->>'kind' IN ('source','composite') THEN
    LOOP
      page:=api.query_sheet_instance_rows_core036(instance.id,200,offset_value);
      FOR item IN SELECT value FROM jsonb_array_elements(page->'rows') LOOP
        row_ids:=array_append(row_ids,internal.sheet_row_identity_key(instance.state->'resolvedRowIdentity',item->'identityValues'));
      END LOOP;
      EXIT WHEN NOT (page->>'hasMore')::boolean OR offset_value=10000;
      offset_value:=offset_value+200;
    END LOOP;
  END IF;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'rowKeys') LOOP
    IF identity<>ALL(row_ids) THEN RAISE EXCEPTION 'row absent from current Sheet' USING ERRCODE='SB002'; END IF;
  END LOOP;
  FOR identity IN SELECT value FROM jsonb_array_elements_text(p_target->'fieldIds') LOOP
    IF identity<>ALL(field_ids) THEN RAISE EXCEPTION 'field absent from current Sheet' USING ERRCODE='SB002'; END IF;
  END LOOP;
  INSERT INTO api.comments(id,workspace_id,record_id,revision_id,sheet_instance_id,root_id,target_kind,target,body,mentions,author_user_id)
    VALUES(id,instance.workspace_id,instance.notebook_record_id,NULL,instance.id,id,p_target_kind,p_target,p_body,internal.normalise_mentions(instance.workspace_id,p_mentions),api.current_user_id()) RETURNING * INTO comment;
  PERFORM internal.emit_change_event(instance.workspace_id,'comment',comment.id,'create',comment.record_id,instance.project_id,
    jsonb_build_object('commentId',comment.id,'sheetInstanceId',instance.id,'revisionId',NULL,'threadRootId',comment.id,'parentId',NULL,'targetKind',p_target_kind,'state','open'));
  RETURN jsonb_build_object('id',comment.id,'revisionId',NULL,'sheetInstanceId',instance.id,'rootId',comment.id,'parentId',NULL,'targetKind',p_target_kind,'target',comment.target,'body',comment.body,'mentions',comment.mentions,'state',comment.state,'authorUserId',comment.author_user_id,'createdAt',comment.created_at);
END $$;
REVOKE ALL ON FUNCTION api.create_sheet_comment(uuid,bigint,text,jsonb,text,text[]) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.create_sheet_comment(uuid,bigint,text,jsonb,text,text[]) TO authenticated;
--> statement-breakpoint

-- Extend the existing RPCs, preserving their current writer/actor checks and
-- review behavior. Refuse to silently migrate an unexpected function body.
DO $$
DECLARE name text; definition text;
BEGIN
  FOREACH name IN ARRAY ARRAY['api.create_comment(uuid,text,jsonb,text,text[])','api.reply_to_comment(uuid,text,text[])','api.resolve_comment_thread(uuid)','api.reopen_comment_thread(uuid)'] LOOP
    definition:=pg_get_functiondef(name::regprocedure);
    IF strpos(definition,'api.is_workspace_writer(v_workspace)')=0 THEN RAISE EXCEPTION 'comment writer guard missing: %',name; END IF;
    IF name LIKE 'api.create_comment%' THEN
      definition:=replace(definition,'id, workspace_id, revision_id, record_id, root_id, parent_id,','id, workspace_id, revision_id, record_id, sheet_instance_id, root_id, parent_id,');
      definition:=replace(definition,'v_id, v_workspace, p_revision_id, v_revision.record_id, v_id, NULL,',
        'v_id, v_workspace, p_revision_id, v_revision.record_id, CASE WHEN p_target_kind IN (''sheet_cell'',''sheet_row'',''sheet_range'') THEN (p_target->>''instanceId'')::uuid END, v_id, NULL,');
    ELSIF name LIKE 'api.reply_to_comment%' THEN
      definition:=replace(definition,'id, workspace_id, revision_id, record_id, root_id, parent_id,','id, workspace_id, revision_id, record_id, sheet_instance_id, root_id, parent_id,');
      definition:=replace(definition,'v_id, v_workspace, v_parent.revision_id, v_parent.record_id,','v_id, v_workspace, v_parent.revision_id, v_parent.record_id, v_parent.sheet_instance_id,');
    END IF;
    definition:=replace(definition,'''commentId'', v_row.id,','''sheetInstanceId'', v_row.sheet_instance_id, ''commentId'', v_row.id,');
    definition:=replace(definition,'''id'', v_row.id,','''sheetInstanceId'', v_row.sheet_instance_id, ''id'', v_row.id,');
    definition:=replace(definition,'''commentId'', v_root.id,','''sheetInstanceId'', v_root.sheet_instance_id, ''commentId'', v_root.id,');
    IF name NOT LIKE 'api.create_comment%' THEN
      -- Live standalone Instances can carry project provenance without a Record.
      definition:=replace(definition,'WHERE id = v_parent.record_id;', 'WHERE id = v_parent.record_id; IF v_parent.revision_id IS NULL THEN SELECT project_id INTO v_record_project FROM api.sheet_instances WHERE id=v_parent.sheet_instance_id; END IF;');
      definition:=replace(definition,'WHERE id = v_root.record_id;', 'WHERE id = v_root.record_id; IF v_root.revision_id IS NULL THEN SELECT project_id INTO v_record_project FROM api.sheet_instances WHERE id=v_root.sheet_instance_id; END IF;');
    END IF;
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint

CREATE FUNCTION api.record_comments(p_record_id uuid) RETURNS SETOF api.comments
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT c.* FROM api.comments c
  WHERE EXISTS(SELECT 1 FROM api.records r WHERE r.id=p_record_id)
    AND (c.record_id=p_record_id OR (c.revision_id IS NULL AND EXISTS(
      SELECT 1 FROM api.blocks b WHERE b.record_id=p_record_id AND b.type='sheet'
        AND b.payload->>'instanceId'=c.sheet_instance_id::text)))
  ORDER BY c.created_at,c.id
$$;
REVOKE ALL ON FUNCTION api.record_comments(uuid) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.record_comments(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_comments(p_query text,p_limit integer DEFAULT 20)
RETURNS TABLE(comment_id uuid,record_id uuid,identifier text,target_kind text,anchor jsonb,body text,author_user_id text,created_at timestamptz,rank real)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,api AS $$
  SELECT c.id,c.record_id,r.identifier,c.target_kind,c.target,c.body,c.author_user_id,c.created_at,
    ts_rank(c.search_vector,plainto_tsquery('english',p_query))
  FROM api.comments c LEFT JOIN api.records r ON r.id=c.record_id
  WHERE coalesce(btrim(p_query),'')<>'' AND c.search_vector @@ plainto_tsquery('english',p_query)
    AND (c.record_id IS NULL OR r.id IS NOT NULL)
  ORDER BY 9 DESC,c.created_at DESC
  LIMIT greatest(1,least(coalesce(p_limit,20),100))
$$;
NOTIFY pgrst,'reload schema';
