-- An Inbox item a pipeline leaves for a person: "Assign a task in Inbox" and
-- "Mark the snapshot for review" in a Simple pipeline, and any pipeline step
-- that calls create_inbox_item. Like a plugin note it shows in the person's
-- Inbox (the item names a dataset or a snapshot when it is about one) and is
-- cleared the way any other Inbox item is: by opening it.

CREATE TABLE api.pipeline_inbox_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    created_by_user_id text,
    title text NOT NULL,
    body text,
    dataset_id uuid,
    dataset_version_id uuid,
    due_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_inbox_items_pkey PRIMARY KEY (id),
    CONSTRAINT pipeline_inbox_items_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT pipeline_inbox_items_user_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT pipeline_inbox_items_dataset_fk FOREIGN KEY (dataset_id) REFERENCES api.datasets(id) ON DELETE CASCADE,
    CONSTRAINT pipeline_inbox_items_version_fk FOREIGN KEY (dataset_version_id) REFERENCES api.dataset_versions(id) ON DELETE CASCADE,
    CONSTRAINT chk_pipeline_inbox_items_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_pipeline_inbox_items_body CHECK (body IS NULL OR char_length(body) <= 2000)
);
--> statement-breakpoint
ALTER TABLE api.pipeline_inbox_items OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_pipeline_inbox_items_user ON api.pipeline_inbox_items (workspace_id, user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.pipeline_inbox_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_inbox_items_select ON api.pipeline_inbox_items FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (user_id = api.current_user_id() OR created_by_user_id = api.current_user_id()));
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_inbox_items TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.create_inbox_item(
  p_workspace_id uuid, p_user_id text, p_title text, p_body text DEFAULT NULL,
  p_dataset_id uuid DEFAULT NULL, p_dataset_version_id uuid DEFAULT NULL,
  p_due_at timestamp with time zone DEFAULT NULL
) RETURNS api.pipeline_inbox_items
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.pipeline_inbox_items;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'inbox item denied' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'an Inbox item needs a title of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'the person is not in this workspace' USING ERRCODE = '22023';
  END IF;
  IF p_dataset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.datasets d WHERE d.id = p_dataset_id AND d.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'dataset not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_dataset_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.dataset_versions v WHERE v.id = p_dataset_version_id AND v.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'dataset version not found' USING ERRCODE = 'SB036';
  END IF;

  INSERT INTO api.pipeline_inbox_items
    (workspace_id, user_id, created_by_user_id, title, body, dataset_id, dataset_version_id, due_at)
  VALUES
    (p_workspace_id, p_user_id, api.current_user_id(), btrim(p_title), nullif(btrim(coalesce(p_body, '')), ''),
     p_dataset_id, p_dataset_version_id, p_due_at)
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_inbox_item(uuid, text, text, text, uuid, uuid, timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_inbox_item(uuid, text, text, text, uuid, uuid, timestamp with time zone) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.trg_change_event_pipeline_inbox_item() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'pipeline_inbox_item', NEW.id, 'create', NULL, NULL,
    jsonb_build_object('id', NEW.id, 'userId', NEW.user_id, 'title', NEW.title,
                       'datasetId', NEW.dataset_id, 'datasetVersionId', NEW.dataset_version_id,
                       'dueAt', NEW.due_at));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_pipeline_inbox_item() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_inbox_items AFTER INSERT ON api.pipeline_inbox_items
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_pipeline_inbox_item();
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES ('pipeline.inbox_item.created') ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The Inbox: a branch in the combined work items view, and the new kind in the
-- Inbox view's list of kinds (it files under Lab).
DO $$
DECLARE
  v_def text;
  v_branch text := $pi$
UNION ALL
 SELECT 'pipeline_item'::text AS kind,
        NULL::uuid AS record_id,
        NULL::text AS identifier,
        n.title AS title,
        NULL::uuid AS project_id,
        n.body AS reason,
        n.due_at AS due_at,
        'needs_action'::text AS state,
        n.created_at AS created_at,
        'pipeline_item'::text AS source_type,
        n.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        n.dataset_id AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.pipeline_inbox_items n
  WHERE n.workspace_id = api.current_workspace_id()
    AND n.user_id = api.current_user_id()
$pi$;
BEGIN
  v_def := pg_get_viewdef('internal.my_work_items_all'::regclass);
  IF position('''pipeline_item''' IN v_def) > 0 THEN
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW internal.my_work_items_all AS ' || rtrim(v_def, ';') || v_branch;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_viewdef('api.inbox_work_items'::regclass);
  IF position('''pipeline_item''' IN v_def) = 0 THEN
    IF position('''plugin_note''::text' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.inbox_work_items';
    END IF;
    v_def := replace(v_def, '''plugin_note''::text', '''plugin_note''::text, ''pipeline_item''::text');
    EXECUTE 'CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker=''true'') AS ' || rtrim(v_def, ';');
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('pipeline_item', 'inbox', ARRAY['pipeline_item'], false, false)
ON CONFLICT DO NOTHING;
