-- Notes from plugin event reactions. A plugin can react to what happens in the
-- workspace (a sample is released, an experiment is signed) by leaving a note
-- for the person whose change caused it. A note never changes a record; it
-- shows in the Inbox for two weeks.
--
-- Only the app writes notes (after it runs the plugin); a person can read their
-- own.

CREATE TABLE api.plugin_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    extension_key text NOT NULL,
    extension_name text NOT NULL,
    hook_id text NOT NULL,
    -- The change event that set the reaction off, so a retry leaves one note.
    event_id uuid NOT NULL,
    title text NOT NULL,
    body text,
    record_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_notes_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_notes_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT plugin_notes_user_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT plugin_notes_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT chk_plugin_notes_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_plugin_notes_body CHECK (body IS NULL OR char_length(body) <= 2000)
);
--> statement-breakpoint
ALTER TABLE api.plugin_notes OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_plugin_notes_event ON api.plugin_notes (event_id, extension_key, hook_id, title, user_id);
--> statement-breakpoint
CREATE INDEX idx_plugin_notes_user ON api.plugin_notes (workspace_id, user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.plugin_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plugin_notes_select ON api.plugin_notes FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND user_id = api.current_user_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.plugin_notes TO authenticated;
--> statement-breakpoint

-- The Inbox: add a branch to the combined work items view.
DO $$
DECLARE
  v_def text;
  v_branch text := $pn$
UNION ALL
 SELECT 'plugin_note'::text AS kind,
        n.record_id AS record_id,
        NULL::text AS identifier,
        n.title AS title,
        NULL::uuid AS project_id,
        coalesce(n.body, n.extension_name) AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        n.created_at AS created_at,
        'plugin_note'::text AS source_type,
        n.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.plugin_notes n
  WHERE n.workspace_id = api.current_workspace_id()
    AND n.user_id = api.current_user_id()
    AND n.created_at > now() - interval '14 days'
$pn$;
BEGIN
  v_def := pg_get_viewdef('internal.my_work_items_all'::regclass);
  IF position('''plugin_note''' IN v_def) > 0 THEN
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
  IF position('''plugin_note''' IN v_def) = 0 THEN
    IF position('''qc_violation''::text' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.inbox_work_items';
    END IF;
    v_def := replace(v_def, '''qc_violation''::text', '''qc_violation''::text, ''plugin_note''::text');
    EXECUTE 'CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker=''true'') AS ' || rtrim(v_def, ';');
  END IF;
END $$;
