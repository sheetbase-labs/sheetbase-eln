-- Retention rules.
--
-- A rule says how long records of one model are kept after their last change.
-- Past that, a record is "due": it appears on the Retention page, and an
-- administrator can archive everything that is due in one step. Archiving is
-- reversible (a record can be restored) and nothing is ever deleted by a rule.
-- Records under a legal hold are never due and are never archived.

CREATE TABLE api.retention_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    keep_months integer NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    updated_by_user_id text,
    CONSTRAINT retention_rules_pkey PRIMARY KEY (id),
    CONSTRAINT retention_rules_unique UNIQUE (workspace_id, kind),
    CONSTRAINT chk_retention_rules_months CHECK (keep_months BETWEEN 1 AND 1200),
    CONSTRAINT chk_retention_rules_note CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE api.retention_rules OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.retention_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY retention_rules_select ON api.retention_rules FOR SELECT TO authenticated
    USING (api.has_settings_access(workspace_id, 'general', 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.retention_rules TO authenticated;
--> statement-breakpoint

-- Set or change the rule for a model; an empty number removes it.
CREATE FUNCTION api.set_retention_rule(p_kind text, p_keep_months integer, p_note text DEFAULT NULL)
RETURNS api.retention_rules
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_row api.retention_rules;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_keep_months IS NULL THEN
    DELETE FROM api.retention_rules WHERE workspace_id = v_workspace_id AND kind = p_kind
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_models m WHERE m.workspace_id = v_workspace_id AND m.key = p_kind) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.retention_rules (workspace_id, kind, keep_months, note, created_by_user_id, updated_by_user_id)
  VALUES (v_workspace_id, p_kind, p_keep_months, nullif(btrim(p_note), ''), api.current_user_id(), api.current_user_id())
  ON CONFLICT (workspace_id, kind) DO UPDATE
     SET keep_months = EXCLUDED.keep_months, note = EXCLUDED.note,
         updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(v_workspace_id, 'workspace_settings', v_row.id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'retention_rule', 'kind', p_kind, 'keepMonths', p_keep_months));
  RETURN v_row;
END $$;
--> statement-breakpoint

-- Records past their rule's keep time and not held.
CREATE FUNCTION api.retention_due(p_kind text DEFAULT NULL)
RETURNS TABLE (record_id uuid, identifier text, title text, kind text, project_id uuid,
               last_changed timestamp with time zone, keep_months integer,
               due_since timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'view') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  RETURN QUERY
  SELECT r.id, r.identifier, r.title, r.kind, r.project_id, r.updated_at, u.keep_months,
         r.updated_at + make_interval(months => u.keep_months)
    FROM api.records r
    JOIN api.retention_rules u ON u.workspace_id = r.workspace_id AND u.kind = r.kind
   WHERE r.workspace_id = v_workspace_id
     AND (p_kind IS NULL OR r.kind = p_kind)
     AND r.archived_at IS NULL AND r.deleted_at IS NULL
     AND r.updated_at + make_interval(months => u.keep_months) < now()
     AND internal.record_hold_name(r.workspace_id, r.id, r.project_id, r.kind) IS NULL
   ORDER BY r.updated_at, r.identifier;
END $$;
--> statement-breakpoint

-- Archive every record that is due. Returns how many were archived.
CREATE FUNCTION api.apply_retention(p_kind text DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_id uuid;
  v_ids uuid[];
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  SELECT coalesce(array_agg(d.record_id), '{}') INTO v_ids FROM api.retention_due(p_kind) d;
  UPDATE api.records
     SET archived_at = now(), metadata_version = metadata_version + 1,
         updated_by_user_id = api.current_user_id()
   WHERE id = ANY (v_ids) AND archived_at IS NULL;
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM internal.emit_change_event(v_workspace_id, 'record', v_id, 'archive', v_id, NULL,
      jsonb_build_object('effect', 'retention'));
  END LOOP;
  RETURN coalesce(cardinality(v_ids), 0);
END $$;
--> statement-breakpoint

ALTER FUNCTION api.set_retention_rule(text, integer, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.retention_due(text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.apply_retention(text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_retention_rule(text, integer, text), api.retention_due(text), api.apply_retention(text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_retention_rule(text, integer, text), api.retention_due(text), api.apply_retention(text) TO authenticated;
