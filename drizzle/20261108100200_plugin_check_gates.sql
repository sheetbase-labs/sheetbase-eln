-- A gate can wait on a plugin check: "Titration data passes the range check".
--
-- Python cannot run inside the database, so the check runs in the app, over the
-- table as it is now, and the answer is stored here. The gate reads the stored
-- answer. It counts only while the table is unchanged since the check ran; an
-- edit to the table makes the gate ask for a fresh run.
--
-- Only the app can write an answer (internal.record_gate_check, not granted to
-- anyone), so a person cannot type "pass" into the table.

CREATE TABLE api.gate_check_results (
    record_id uuid NOT NULL,
    block_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    extension_key text NOT NULL,
    check_id text NOT NULL,
    status text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    -- Fingerprint of the table's columns and rows when the check ran.
    table_hash text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_by_user_id text,
    CONSTRAINT gate_check_results_pkey PRIMARY KEY (record_id, block_id, extension_key, check_id),
    CONSTRAINT gate_check_results_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT gate_check_results_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT gate_check_results_block_fk FOREIGN KEY (block_id) REFERENCES api.blocks(id) ON DELETE CASCADE,
    CONSTRAINT gate_check_results_user_fk FOREIGN KEY (checked_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_gate_check_results_status CHECK (status IN ('pass', 'warn', 'fail')),
    CONSTRAINT chk_gate_check_results_message CHECK (char_length(message) <= 300)
);
--> statement-breakpoint
ALTER TABLE api.gate_check_results OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.gate_check_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY gate_check_results_select ON api.gate_check_results FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY gate_check_results_select_api_client ON api.gate_check_results FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.gate_check_results TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.gate_check_results TO api_client;
--> statement-breakpoint

CREATE FUNCTION internal.gate_table_hash(p_payload jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT md5(coalesce(p_payload->'columns', '[]'::jsonb)::text || '|' || coalesce(p_payload->'rows', '[]'::jsonb)::text);
$$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_table_hash(jsonb) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.gate_table_hash(jsonb) TO authenticated, api_client;
--> statement-breakpoint

-- Written by the app after it runs the check; the table's fingerprint is taken
-- here, from the table itself, never passed in.
CREATE FUNCTION internal.record_gate_check(
    p_record_id uuid, p_block_id uuid, p_extension_key text, p_check_id text,
    p_status text, p_message text, p_actor text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_block api.blocks;
  v_workspace uuid;
BEGIN
  SELECT * INTO v_block FROM api.blocks
   WHERE id = p_block_id AND record_id = p_record_id AND type = 'table';
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'That table is not on this record' USING ERRCODE = '22023';
  END IF;
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = p_record_id;
  INSERT INTO api.gate_check_results
         (record_id, block_id, workspace_id, extension_key, check_id, status, message, table_hash, checked_at, checked_by_user_id)
  VALUES (p_record_id, p_block_id, v_workspace, p_extension_key, p_check_id, p_status,
          left(coalesce(p_message, ''), 300), internal.gate_table_hash(v_block.payload), now(), p_actor)
  ON CONFLICT (record_id, block_id, extension_key, check_id) DO UPDATE
     SET status = EXCLUDED.status, message = EXCLUDED.message, table_hash = EXCLUDED.table_hash,
         checked_at = EXCLUDED.checked_at, checked_by_user_id = EXCLUDED.checked_by_user_id;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.record_gate_check(uuid, uuid, text, text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_gate_check(uuid, uuid, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.gate_conditions_valid(jsonb)'::regprocedure) INTO v_def;
  IF position('''plugin_check''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.gate_conditions_valid';
    END IF;
    v_def := replace(v_def,
      '    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;',
      '    ELSIF v_kind = ''plugin_check'' THEN' || chr(10) ||
      '      IF internal.gate_uuid(v_c->>''blockId'') IS NULL' || chr(10) ||
      '         OR coalesce(v_c->>''extensionKey'', '''') !~ ''^[a-z][a-z0-9-]{0,48}$''' || chr(10) ||
      '         OR coalesce(v_c->>''checkId'', '''') !~ ''^[a-z][a-z0-9-]{0,48}$''' || chr(10) ||
      '         OR (v_c ? ''columns'' AND jsonb_typeof(v_c->''columns'') <> ''object'') THEN' || chr(10) ||
      '        RETURN false;' || chr(10) ||
      '      END IF;' || chr(10) ||
      '    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;');
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
  v_branch text := $pc$
    ELSIF v_kind = 'plugin_check' THEN
      SELECT * INTO v_block FROM api.blocks
       WHERE record_id = p_record_id AND id = internal.gate_uuid(v_c->>'blockId') AND type = 'table';
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''), 'The check');
      IF v_block.id IS NULL THEN
        v_text := 'A table this gate waits on has been removed';
      ELSE
        SELECT * INTO v_pc FROM api.gate_check_results r
         WHERE r.record_id = p_record_id AND r.block_id = v_block.id
           AND r.extension_key = v_c->>'extensionKey' AND r.check_id = v_c->>'checkId';
        IF v_pc.record_id IS NULL THEN
          v_text := v_label || ' has not been run yet';
        ELSIF v_pc.table_hash <> internal.gate_table_hash(v_block.payload) THEN
          v_text := v_label || ' was run before the table changed. Run it again';
        ELSIF v_pc.status = 'fail' THEN
          v_text := v_label || ' failed' || CASE WHEN v_pc.message <> '' THEN ': ' || v_pc.message ELSE '' END;
        ELSE
          v_met := true;
        END IF;
      END IF;
$pc$;
BEGIN
  SELECT pg_get_functiondef('internal.eval_gate_conditions(uuid,jsonb)'::regprocedure) INTO v_def;
  IF position('''plugin_check''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      v_text := ''Unknown condition'';' IN v_def) = 0
       OR position('  v_use_ds boolean;' || chr(10) IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.eval_gate_conditions';
    END IF;
    v_def := replace(v_def, '  v_use_ds boolean;' || chr(10),
                     '  v_use_ds boolean;' || chr(10) || '  v_pc api.gate_check_results;' || chr(10));
    v_def := replace(v_def, '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';',
                     v_branch || chr(10) || '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';');
    EXECUTE v_def;
  END IF;
END $$;
