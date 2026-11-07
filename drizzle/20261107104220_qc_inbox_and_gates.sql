-- Quality control reaches the Inbox and can hold a gate.
--
--   * internal.qc_open_breaches: one row per tracked series that is out of range
--     and still has a point that broke a rule nobody has looked at (a point is
--     looked at when it is acknowledged or left out of the limits).
--   * The Inbox shows those series, one item per instrument (or assay design),
--     to the person who set the series up and the instrument's owner, and the
--     item goes when every breach is acknowledged or the series is back in range.
--   * A gate condition `qc_in_control` (optionally for one series) is unmet while
--     a tracked series it covers has an open breach.

CREATE VIEW internal.qc_open_breaches AS
 SELECT s.id AS series_id,
        s.workspace_id,
        s.name,
        s.instrument_id,
        s.design_id,
        s.created_by_user_id,
        i.owner_id,
        count(p.id)::integer AS open_count,
        max(p.created_at) AS last_at,
        (SELECT string_agg(r, ', ' ORDER BY r)
           FROM (SELECT DISTINCT unnest(p2.violations) AS r
                   FROM api.qc_points p2
                  WHERE p2.series_id = s.id AND cardinality(p2.violations) > 0
                    AND p2.acknowledged_at IS NULL AND NOT p2.excluded) rules) AS rules
   FROM api.qc_series s
   JOIN api.qc_points p ON p.series_id = s.id
                       AND cardinality(p.violations) > 0
                       AND p.acknowledged_at IS NULL
                       AND NOT p.excluded
   LEFT JOIN api.instruments i ON i.id = s.instrument_id
  WHERE s.enabled AND s.state = 'out_of_control'
  GROUP BY s.id, s.workspace_id, s.name, s.instrument_id, s.design_id, s.created_by_user_id, i.owner_id;
--> statement-breakpoint
ALTER VIEW internal.qc_open_breaches OWNER TO migrator;
--> statement-breakpoint

-- The Inbox: add a branch to the combined work items view.
DO $$
DECLARE
  v_def text;
  v_branch text := $qc$
UNION ALL
 SELECT 'qc_violation'::text AS kind,
        NULL::uuid AS record_id,
        NULL::text AS identifier,
        coalesce(i.name, d.name, min(b.name)) AS title,
        NULL::uuid AS project_id,
        string_agg(b.name || ': ' || b.rules, '; ' ORDER BY b.name) AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        max(b.last_at) AS created_at,
        CASE WHEN b.instrument_id IS NOT NULL THEN 'instrument'
             WHEN b.design_id IS NOT NULL THEN 'plate_design'
             ELSE 'qc_series' END AS source_type,
        coalesce(b.instrument_id, b.design_id, (array_agg(b.series_id ORDER BY b.name))[1]) AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM internal.qc_open_breaches b
   LEFT JOIN api.instruments i ON i.id = b.instrument_id
   LEFT JOIN api.plate_designs d ON d.id = b.design_id AND b.instrument_id IS NULL
  WHERE b.workspace_id = api.current_workspace_id()
    AND api.current_user_id() IN (b.created_by_user_id, b.owner_id)
  GROUP BY b.instrument_id, b.design_id, i.name, d.name,
           CASE WHEN b.instrument_id IS NOT NULL OR b.design_id IS NOT NULL THEN NULL ELSE b.series_id END
$qc$;
BEGIN
  v_def := pg_get_viewdef('internal.my_work_items_all'::regclass);
  IF position('''qc_violation''' IN v_def) > 0 THEN
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW internal.my_work_items_all AS ' || rtrim(v_def, ';') || v_branch;
END $$;
--> statement-breakpoint

-- The Inbox groups it with the other lab items.
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_viewdef('api.inbox_work_items'::regclass);
  IF position('''qc_violation''' IN v_def) = 0 THEN
    IF position('''watcher_finding''::text' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.inbox_work_items';
    END IF;
    v_def := replace(v_def, '''watcher_finding''::text', '''watcher_finding''::text, ''qc_violation''::text');
    EXECUTE 'CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker=''true'') AS ' || rtrim(v_def, ';');
  END IF;
END $$;
--> statement-breakpoint

-- Muting a series going out of range in the app hides it from the Inbox too.
UPDATE api.notification_events SET inbox_kinds = ARRAY['qc_violation']::text[] WHERE event_type = 'qc_violation';
--> statement-breakpoint

-- Gates: a condition that waits for quality control to be in range.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.gate_conditions_valid(jsonb)'::regprocedure) INTO v_def;
  IF position('''qc_in_control''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.gate_conditions_valid';
    END IF;
    v_def := replace(v_def,
      '    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;',
      '    ELSIF v_kind = ''qc_in_control'' THEN' || chr(10) ||
      '      IF v_c ? ''seriesId'' AND internal.gate_uuid(v_c->>''seriesId'') IS NULL THEN' || chr(10) ||
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
  v_branch text := $qc$
    ELSIF v_kind = 'qc_in_control' THEN
      v_qc_id := internal.gate_uuid(v_c->>'seriesId');
      IF v_qc_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM api.qc_series s WHERE s.id = v_qc_id AND s.workspace_id = v_record.workspace_id) THEN
        v_text := 'A quality control series this gate waits on has been removed';
      ELSE
        SELECT coalesce(array_agg(b.name || ' (' || b.rules || ')' ORDER BY b.name), '{}') INTO v_names
          FROM internal.qc_open_breaches b
         WHERE b.workspace_id = v_record.workspace_id
           AND (v_qc_id IS NULL OR b.series_id = v_qc_id);
        v_met := coalesce(array_length(v_names, 1), 0) = 0;
        IF NOT v_met THEN
          v_text := 'Quality control is out of range: ' || array_to_string(v_names, ', ');
        END IF;
      END IF;
$qc$;
BEGIN
  SELECT pg_get_functiondef('internal.eval_gate_conditions(uuid,jsonb)'::regprocedure) INTO v_def;
  IF position('''qc_in_control''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      v_text := ''Unknown condition'';' IN v_def) = 0
       OR position('  v_use_ds boolean;' || chr(10) IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.eval_gate_conditions';
    END IF;
    v_def := replace(v_def, '  v_use_ds boolean;' || chr(10),
                     '  v_use_ds boolean;' || chr(10) || '  v_qc_id uuid;' || chr(10));
    v_def := replace(v_def, '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';',
                     v_branch || chr(10) || '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';');
    EXECUTE v_def;
  END IF;
END $$;
