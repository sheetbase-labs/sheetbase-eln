-- Plate runs belong to experiments.
--
-- A plate run already has a record_id column (the experiment it belongs to) and
-- create_plate_run already takes one, but nothing could set it afterwards and a
-- notebook had no block to show the run in. This adds:
--
--   * api.link_plate_run(run, experiment): attach a run to an experiment, move
--     it to another, or detach it (experiment null). Sends plate_run.linked or
--     plate_run.unlinked.
--   * the `plate_run` notebook block: a live view of one run (plate map, Z-prime,
--     hits and curves). The block holds the run's id; a trigger checks that the
--     run is in the notebook's workspace and keeps a small pinned copy of the
--     result in the payload, so a submitted revision keeps what the run said when
--     it was submitted.

-- Notebook block type ----------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.blocks'::regclass AND conname = 'chk_blocks_type';
  IF v_def IS NULL OR position('::text])' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_blocks_type';
  END IF;
  IF position('''plate_run''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text])', '::text, ''plate_run''::text])');
    EXECUTE 'ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type';
    EXECUTE 'ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

-- The small copy of a run that a block pins: enough to read the result without
-- the run (what it was called, how good the plate was, what hit) and the
-- version of the run it was taken from.
CREATE FUNCTION internal.plate_run_pin(p_run api.plate_runs) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'reference', 'PLR-' || lpad(p_run.number::text, 4, '0'),
    'name', p_run.name,
    'format', p_run.format,
    'status', p_run.status,
    'qcStatus', p_run.qc_status,
    'metadataVersion', p_run.metadata_version,
    'analysedAt', p_run.analysed_at,
    'zPrime', p_run.results #> '{qc,zPrime}',
    'signalToBackground', p_run.results #> '{qc,signalToBackground}',
    'hitSamples', p_run.results #> '{summary,hitSamples}',
    'testedSamples', p_run.results #> '{summary,testedSamples}',
    'readWells', p_run.results #> '{summary,readWells}'));
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_run_pin(api.plate_runs) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plate_run_pin(api.plate_runs) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.blocks_plate_run_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid;
  v_run api.plate_runs;
  v_run_id uuid;
BEGIN
  IF NEW.type IS DISTINCT FROM 'plate_run' THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a plate run block needs an object payload' USING ERRCODE = '23514';
  END IF;
  -- The pin is the database's to write, never the caller's.
  NEW.payload := NEW.payload - 'pinned';
  IF NEW.payload ->> 'runId' IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_run_id := (NEW.payload ->> 'runId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'runId must be a plate run id' USING ERRCODE = '23514';
  END;
  SELECT workspace_id INTO v_workspace_id FROM api.records WHERE id = NEW.record_id;
  SELECT * INTO v_run FROM api.plate_runs WHERE id = v_run_id;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM v_workspace_id THEN
    RAISE EXCEPTION 'plate run not found in this workspace' USING ERRCODE = '23503';
  END IF;
  NEW.payload := jsonb_set(NEW.payload, '{pinned}', internal.plate_run_pin(v_run));
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.blocks_plate_run_guard() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.blocks_plate_run_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER trg_blocks_plate_run_guard
  BEFORE INSERT OR UPDATE OF payload, type ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.blocks_plate_run_guard();
--> statement-breakpoint

-- Search reads a plate run block's reference and name.
CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text text := '';
  v_id uuid;
  v_ref text;
BEGIN
  CASE p_type
    WHEN 'rich_text' THEN
      v_text := internal.rich_text_plain(v_p -> 'doc');

    WHEN 'checklist' THEN
      v_text := internal.jsonb_path_text(v_p, '$.items[*].text');

    WHEN 'callout' THEN
      v_text := coalesce(v_p ->> 'text', '');

    WHEN 'conclusion' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'basis',
        replace(coalesce(v_p ->> 'verdict', ''), '_', ' '));

    WHEN 'metric' THEN
      v_text := concat_ws(' ', v_p ->> 'label', v_p ->> 'value', v_p ->> 'unit',
        v_p ->> 'provenance');

    WHEN 'table' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.columns[*]'),
        internal.jsonb_path_text(v_p, '$.rows[*][*]'));

    WHEN 'procedure_step' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'note');

    WHEN 'signature_request' THEN
      v_text := concat_ws(' ', v_p ->> 'requestedUserName',
        replace(coalesce(v_p ->> 'meaning', ''), '-', ' '), v_p ->> 'note');

    WHEN 'corrective_actions' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].action'),
        internal.jsonb_path_text(v_p, '$.items[*].ownerName'),
        replace(internal.jsonb_path_text(v_p, '$.items[*].status'), '-', ' '));

    WHEN 'materials' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].identifier'),
        internal.jsonb_path_text(v_p, '$.items[*].title'),
        internal.jsonb_path_text(v_p, '$.items[*].note'),
        internal.jsonb_path_text(v_p, '$.items[*].unit.symbol'));

    WHEN 'linked_record' THEN
      v_text := concat_ws(' ', v_p ->> 'targetIdentifier', v_p ->> 'label',
        replace(coalesce(v_p ->> 'linkType', ''), '_', ' '), v_p ->> 'targetKind');
      v_id := internal.search_uuid(v_p ->> 'targetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', r.identifier, r.title) INTO v_ref
          FROM api.records r
         WHERE r.id = v_id AND r.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, r.project_id);
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'protocol_reference' THEN
      v_text := concat_ws(' ', v_p ->> 'protocolIdentifier', v_p ->> 'protocolTitle',
        v_p ->> 'version', replace(coalesce(v_p ->> 'approvalStatus', ''), '_', ' '));

    WHEN 'file' THEN
      v_text := concat_ws(' ', v_p ->> 'displayName', v_p ->> 'fileIdentifier',
        v_p ->> 'mediaType');
      v_id := internal.search_uuid(v_p ->> 'fileRecordId');
      IF v_id IS NOT NULL THEN
        -- What is written inside the attached file, so a notebook is found by
        -- the report it attaches. Only the version the block shows (its
        -- fileVersion, else the newest), capped, and only from a file in the
        -- notebook's own project.
        SELECT left(fo.extracted_text, 100000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id)
         ORDER BY (fo.version = internal.search_int(v_p ->> 'fileVersion')) DESC NULLS LAST,
                  fo.version DESC
         LIMIT 1;
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'sheet' THEN
      v_id := internal.search_uuid(v_p ->> 'instanceId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', si.display_id, si.name,
                 internal.jsonb_path_text(si.state, '$.localFields[*].label'))
          INTO v_text
          FROM api.sheet_instances si
         WHERE si.id = v_id AND si.lifecycle IN ('active', 'archived')
           AND internal.search_scope_ok(p_record_id, si.project_id);
      END IF;

    WHEN 'chart' THEN
      v_text := concat_ws(' ', v_p ->> 'title',
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.label'),
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.unit'),
        internal.jsonb_path_text(v_p, '$.spec.display.series[*].label'),
        internal.jsonb_path_text(v_p, '$.spec.display.annotations[*].label'),
        v_p #>> '{spec,display,caption}');
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.datasets[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT f.label, ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.fields.*.fieldId') x
        JOIN api.dataset_schema_version_fields f ON f.field_id = internal.search_uuid(x #>> '{}');

    WHEN 'analysis' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        v_p #>> '{frozen,definitionName}',
        internal.jsonb_path_text(v_p, '$.frozen.columns[*].label'));
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.frozen.datasetProvenance[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      v_id := internal.search_uuid(v_p ->> 'definitionId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, ad.name) INTO v_text
          FROM api.analysis_definitions ad WHERE ad.id = v_id;
      END IF;

    WHEN 'plate_map' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        internal.jsonb_path_text(v_p, '$.spec.wells[*].wellCode'),
        replace(internal.jsonb_path_text(v_p, '$.spec.wells[*].role'), '_', ' '),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.identifier'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.title'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].notes'));

    WHEN 'pipeline_output' THEN
      v_text := coalesce(v_p ->> 'label', '');
      v_id := internal.search_uuid(v_p ->> 'runId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, pd.display_id, pd.name) INTO v_text
          FROM api.pipeline_runs pr
          JOIN api.pipeline_definition_versions pv ON pv.id = pr.definition_version_id
          JOIN api.pipeline_definitions pd ON pd.id = pv.definition_id
         WHERE pr.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'dataset_import' THEN
      v_text := coalesce(v_p ->> 'sheetName', '');
      v_id := internal.search_uuid(v_p ->> 'fileId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, f.filename) INTO v_text
          FROM api.dataset_import_files f WHERE f.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'structure' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'name',
        v_p ->> 'formula', v_p ->> 'smiles');

    WHEN 'reaction' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'smiles',
        internal.jsonb_path_text(v_p, '$.rows[*].name'),
        internal.jsonb_path_text(v_p, '$.rows[*].formula'),
        internal.jsonb_path_text(v_p, '$.rows[*].note'));

    WHEN 'code_cell' THEN
      -- The code and the names of what it reads; never the output rows.
      v_text := concat_ws(' ', v_p ->> 'source',
        internal.jsonb_path_text(v_p, '$.inputs[*].alias'),
        internal.jsonb_path_text(v_p, '$.inputs[*].label'));

    WHEN 'gate' THEN
      v_text := concat_ws(' ', v_p ->> 'label',
        internal.jsonb_path_text(v_p, '$.conditions[*].label'),
        internal.jsonb_path_text(v_p, '$.conditions[*].column'));

    WHEN 'plate_run' THEN
      v_text := concat_ws(' ', v_p #>> '{pinned,reference}', v_p #>> '{pinned,name}');

    WHEN 'plugin' THEN
      -- The words in a plugin block's state: every text value of up to 500
      -- characters. Longer ones (a raw sequence) are not words and are left out.
      SELECT coalesce(string_agg(x #>> '{}', ' '), '') INTO v_text
        FROM jsonb_path_query(coalesce(v_p -> 'state', 'null'::jsonb), 'strict $.**') x
       WHERE jsonb_typeof(x) = 'string' AND length(x #>> '{}') <= 500;

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$$;
--> statement-breakpoint

-- Link a plate run to an experiment ----------------------------------------------
CREATE FUNCTION api.link_plate_run(p_plate_run_id uuid, p_record_id uuid DEFAULT NULL)
RETURNS api.plate_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.plate_runs;
  v_previous uuid;
  v_project uuid;
BEGIN
  SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_run.project_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('project', v_run.project_id, 'edit');
  END IF;
  IF v_run.status = 'archived' THEN
    RAISE EXCEPTION 'cannot change an archived plate run' USING ERRCODE = 'SB004';
  END IF;
  v_previous := v_run.record_id;
  v_project := v_run.project_id;
  IF p_record_id IS NOT NULL THEN
    SELECT project_id INTO v_project FROM api.records
     WHERE id = p_record_id AND workspace_id = v_run.workspace_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('record', p_record_id, 'edit');
    -- The experiment's team is who reads the result, so a run moves into its project.
    v_project := coalesce(v_project, v_run.project_id);
  END IF;
  IF v_previous IS NOT DISTINCT FROM p_record_id THEN
    RETURN v_run;
  END IF;
  UPDATE api.plate_runs SET
      record_id = p_record_id, project_id = v_project,
      metadata_version = metadata_version + 1, updated_at = now()
    WHERE id = p_plate_run_id
    RETURNING * INTO v_run;
  PERFORM internal.emit_change_event(v_run.workspace_id, 'plate_run', v_run.id, 'update',
    coalesce(v_run.record_id, v_previous), v_run.project_id,
    jsonb_build_object('change', CASE WHEN p_record_id IS NULL THEN 'unlinked' ELSE 'linked' END,
                       'plateRunId', v_run.id,
                       'reference', 'PLR-' || lpad(v_run.number::text, 4, '0'),
                       'name', v_run.name,
                       'recordId', p_record_id,
                       'previousRecordId', v_previous));
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.link_plate_run(p_plate_run_id uuid, p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.link_plate_run(p_plate_run_id uuid, p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.link_plate_run(p_plate_run_id uuid, p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Keep each block's pinned copy in step with its run. Best effort: a notebook that
-- is locked (submitted or signed) refuses the write and keeps the copy it had.
CREATE FUNCTION internal.plate_run_refresh_pins() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_block uuid;
BEGIN
  FOR v_block IN
    SELECT id FROM api.blocks WHERE type = 'plate_run' AND payload ->> 'runId' = NEW.id::text
  LOOP
    BEGIN
      UPDATE api.blocks SET payload = payload WHERE id = v_block;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_run_refresh_pins() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plate_run_refresh_pins() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER trg_plate_runs_refresh_pins
  AFTER UPDATE OF metadata_version ON api.plate_runs
  FOR EACH ROW EXECUTE FUNCTION internal.plate_run_refresh_pins();
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('plate_run.linked'), ('plate_run.unlinked')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('link_plate_run', '{"operation":"link_plate_run","rpc":"link_plate_run","label":"Add a plate run to an experiment","description":"Attaches a plate run to an experiment, moves it to another, or detaches it when no experiment is given. The run takes the experiment’s project. Show it in the notebook with `insert_block` and the block type `plate_run` (payload `{ \"runId\": \"<id>\" }`). Returns the run. Sends `plate_run.linked` or `plate_run.unlinked`.","arguments":[{"name":"p_plate_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_record_id","type":"uuid","required":false,"nullable":true}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
