-- A registry model can name a plugin "same-thing rule": a plugin function that
-- turns an entry's fields into a key, so two entries with the same key are the
-- same thing (chemistry: the parent structure; sequences: a normalised string).
--
-- Python cannot run in the database, so the app computes the key and the
-- database keeps it. The warning before an entry is added, and the refusal when
-- someone adds a repeat, use the kept keys. An entry whose fields later change
-- loses its key until the app works it out again, so a stale key never matches
-- the wrong entry.

CREATE TABLE api.registry_sameness_rules (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    -- `plugin.<extension key>.<id>`
    plugin_item text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT registry_sameness_rules_pkey PRIMARY KEY (workspace_id, model_key),
    CONSTRAINT registry_sameness_rules_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_registry_sameness_item CHECK (plugin_item ~ '^plugin\.[a-z][a-z0-9-]{0,48}\.[a-z][a-z0-9-]{0,48}$')
);
--> statement-breakpoint
ALTER TABLE api.registry_sameness_rules OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.registry_sameness_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY registry_sameness_rules_select ON api.registry_sameness_rules FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY registry_sameness_rules_select_api_client ON api.registry_sameness_rules FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.registry_sameness_rules TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.registry_sameness_values (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    value text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registry_sameness_values_pkey PRIMARY KEY (record_id),
    CONSTRAINT registry_sameness_values_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT registry_sameness_values_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_registry_sameness_value CHECK (char_length(value) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE api.registry_sameness_values OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_registry_sameness_value ON api.registry_sameness_values (workspace_id, model_key, md5(value));
--> statement-breakpoint
-- Read only through the functions below, which apply the same access rules as
-- the records themselves.
ALTER TABLE api.registry_sameness_values ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Choose (or clear, with NULL) the rule a registry model uses.
CREATE FUNCTION api.set_registry_sameness_rule(p_model_key text, p_plugin_item text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key AND m.is_registry) THEN
    RAISE EXCEPTION 'that model is not a registry' USING ERRCODE = '22023';
  END IF;
  IF nullif(p_plugin_item, '') IS NULL THEN
    DELETE FROM api.registry_sameness_rules WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
    DELETE FROM api.registry_sameness_values WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
  ELSE
    INSERT INTO api.registry_sameness_rules (workspace_id, model_key, plugin_item, updated_by_user_id)
    VALUES (v_workspace_id, p_model_key, p_plugin_item, api.current_user_id())
    ON CONFLICT (workspace_id, model_key) DO UPDATE
       SET plugin_item = EXCLUDED.plugin_item, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id;
    -- A different rule makes every kept key meaningless.
    DELETE FROM api.registry_sameness_values WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_registry_sameness_rule(text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_registry_sameness_rule(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_registry_sameness_rule(text, text) TO authenticated;
--> statement-breakpoint

-- Entries of a registry that already have this key, as the person may see them.
CREATE FUNCTION api.registry_sameness_matches(p_model_key text, p_value text, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, identifier text, title text, archived boolean, match text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.identifier, r.title, (r.archived_at IS NOT NULL), 'exact'::text
      FROM api.registry_sameness_values v
      JOIN api.records r ON r.id = v.record_id
     WHERE v.workspace_id = v_workspace_id AND v.model_key = p_model_key
       AND md5(v.value) = md5(p_value) AND v.value = p_value
       AND r.deleted_at IS NULL
       AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
       AND internal.can_access_object('record', r.id, 'view')
     ORDER BY r.identifier;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.registry_sameness_matches(text, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.registry_sameness_matches(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.registry_sameness_matches(text, text, uuid) TO authenticated;
--> statement-breakpoint

-- Keep the key the app worked out for an entry. Refuses a repeat unless the
-- person has seen the warning and registers it anyway.
CREATE FUNCTION api.set_registry_sameness_value(p_record_id uuid, p_value text, p_allow_duplicate boolean DEFAULT false)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_record api.records;
  v_dup text;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id AND deleted_at IS NULL;
  IF v_record.id IS NULL OR v_record.workspace_id <> v_workspace_id
     OR NOT internal.can_access_object('record', v_record.id, 'edit') THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.registry_sameness_rules s
                  WHERE s.workspace_id = v_workspace_id AND s.model_key = v_record.kind) THEN
    RAISE EXCEPTION 'that model has no same-thing rule' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_value, '')), '') IS NULL THEN
    DELETE FROM api.registry_sameness_values WHERE record_id = p_record_id;
    RETURN;
  END IF;
  IF NOT coalesce(p_allow_duplicate, false) THEN
    SELECT string_agg(d.identifier, ', ') INTO v_dup
      FROM api.registry_sameness_matches(v_record.kind, p_value, p_record_id) d;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
    END IF;
  END IF;
  INSERT INTO api.registry_sameness_values (record_id, workspace_id, model_key, value)
  VALUES (p_record_id, v_workspace_id, v_record.kind, p_value)
  ON CONFLICT (record_id) DO UPDATE SET value = EXCLUDED.value, computed_at = now();
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_registry_sameness_value(uuid, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_registry_sameness_value(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_registry_sameness_value(uuid, text, boolean) TO authenticated;
--> statement-breakpoint

-- Fields changed: the kept key may no longer describe the entry.
CREATE FUNCTION internal.registry_sameness_stale() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.custom_fields IS DISTINCT FROM OLD.custom_fields OR NEW.title IS DISTINCT FROM OLD.title THEN
    DELETE FROM api.registry_sameness_values WHERE record_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.registry_sameness_stale() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.registry_sameness_stale() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER records_registry_sameness_stale AFTER UPDATE OF title, custom_fields ON api.records
    FOR EACH ROW EXECUTE FUNCTION internal.registry_sameness_stale();
