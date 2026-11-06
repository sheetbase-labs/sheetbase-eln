-- Plate assays: bigger plates, plate runs with analysis, and liquid handler
-- worklists.
--
--   * Plates from 6 to 1536 wells (the standard SBS formats) for designs,
--     layout templates and the notebook plate map.
--   * api.plate_runs: one physical plate read on an instrument. It keeps a
--     snapshot of the layout (which well holds a sample, a control or a blank,
--     and at what dose), the raw readout, the analysis settings and the last
--     analysis (normalisation to the plate's own controls, Z', hits, curves).
--     Editing the layout, readout or settings clears the analysis, so a saved
--     result always matches what is stored beside it.
--   * api.plate_worklists: transfers from a source plate to a destination
--     plate, exported for a robot, then completed from the robot's log. Completing
--     one withdraws the volumes moved from the source samples, which also links
--     each sample to the experiment.
--   * Events: plate_run.created / analysed / archived and
--     plate_worklist.created / completed on the change feed.

-- Format helpers, so one list of plate formats serves every check.
CREATE FUNCTION internal.plate_format_rows(p_format text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE p_format
    WHEN '6_well' THEN 2 WHEN '12_well' THEN 3 WHEN '24_well' THEN 4 WHEN '48_well' THEN 6
    WHEN '96_well' THEN 8 WHEN '384_well' THEN 16 WHEN '1536_well' THEN 32 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_format_rows(p_format text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.plate_format_cols(p_format text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE p_format
    WHEN '6_well' THEN 3 WHEN '12_well' THEN 4 WHEN '24_well' THEN 6 WHEN '48_well' THEN 8
    WHEN '96_well' THEN 12 WHEN '384_well' THEN 24 WHEN '1536_well' THEN 48 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_format_cols(p_format text) OWNER TO migrator;
--> statement-breakpoint
-- Row 0 is A, row 25 is Z, row 26 is AA (the 1536-well plate runs to AF).
CREATE FUNCTION internal.plate_row_label(p_row integer) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN p_row < 26 THEN chr(65 + p_row)
              ELSE chr(65 + (p_row / 26) - 1) || chr(65 + (p_row % 26)) END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_row_label(p_row integer) OWNER TO migrator;
--> statement-breakpoint
-- Row index of a well code like "B12" or "AA3"; null when malformed.
CREATE FUNCTION internal.plate_well_row(p_code text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_code ~ '^[A-Z][1-9][0-9]?$' THEN ascii(substr(p_code, 1, 1)) - 65
    WHEN p_code ~ '^[A-Z]{2}[1-9][0-9]?$' THEN (ascii(substr(p_code, 1, 1)) - 64) * 26 + (ascii(substr(p_code, 2, 1)) - 65)
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_well_row(p_code text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.plate_well_col(p_code text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN p_code ~ '^[A-Z]{1,2}[1-9][0-9]?$' THEN substring(p_code from '[0-9]+$')::integer - 1 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.plate_well_col(p_code text) OWNER TO migrator;
--> statement-breakpoint

-- Bigger plates on designs and layout templates.
ALTER TABLE api.plate_designs DROP CONSTRAINT chk_plate_designs_format;
--> statement-breakpoint
ALTER TABLE api.plate_designs DROP CONSTRAINT chk_plate_designs_rows;
--> statement-breakpoint
ALTER TABLE api.plate_designs DROP CONSTRAINT chk_plate_designs_cols;
--> statement-breakpoint
ALTER TABLE api.plate_designs ADD CONSTRAINT chk_plate_designs_format
  CHECK (internal.plate_format_rows(format) IS NOT NULL);
--> statement-breakpoint
ALTER TABLE api.plate_designs ADD CONSTRAINT chk_plate_designs_rows CHECK (rows > 0 AND rows <= 32);
--> statement-breakpoint
ALTER TABLE api.plate_designs ADD CONSTRAINT chk_plate_designs_cols CHECK (cols > 0 AND cols <= 48);
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates DROP CONSTRAINT chk_plate_layout_templates_format;
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates DROP CONSTRAINT chk_plate_layout_templates_rows;
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates DROP CONSTRAINT chk_plate_layout_templates_cols;
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates ADD CONSTRAINT chk_plate_layout_templates_format
  CHECK (internal.plate_format_rows(format) IS NOT NULL);
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates ADD CONSTRAINT chk_plate_layout_templates_rows CHECK (rows > 0 AND rows <= 32);
--> statement-breakpoint
ALTER TABLE api.plate_layout_templates ADD CONSTRAINT chk_plate_layout_templates_cols CHECK (cols > 0 AND cols <= 48);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.validate_scientific_block() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text; cparam_key text; analysis_definition_id uuid;
  -- plate_map locals
  pm_spec jsonb; pm_wells jsonb; pm_well jsonb; pm_code text; pm_row int; pm_col int;
  pm_seen jsonb; pm_sref jsonb; pm_vol jsonb;
  pm_target api.records;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials','file','chart','analysis','plate_map') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.type IS NOT DISTINCT FROM OLD.type
    AND NEW.payload_schema_version IS NOT DISTINCT FROM OLD.payload_schema_version
    AND NEW.payload IS NOT DISTINCT FROM OLD.payload THEN RETURN NEW; END IF;
  IF NEW.payload_schema_version <> 1 OR jsonb_typeof(NEW.payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid SCI-002 payload schema' USING ERRCODE='23514';
  END IF;
  SELECT * INTO owner FROM api.records WHERE id=NEW.record_id;
  IF owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE='23503'; END IF;

  IF NEW.type='protocol_reference' THEN
    IF NEW.payload='{}'::jsonb THEN
      IF owner.kind <> 'experiment' THEN RAISE EXCEPTION 'protocol draft requires experiment' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    IF current_user IN ('authenticated','api_client') THEN
      RAISE EXCEPTION 'populated protocol references require pin_protocol_reference' USING ERRCODE='42501';
    END IF;
    BEGIN
      SELECT * INTO target FROM api.records WHERE id=(NEW.payload->>'protocolRecordId')::uuid;
      SELECT * INTO rev FROM api.revisions WHERE id=(NEW.payload->>'protocolRevisionId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid protocol UUID' USING ERRCODE='23514'; END;
    IF TG_OP='UPDATE' AND OLD.payload <> '{}'::jsonb AND NEW.payload IS DISTINCT FROM OLD.payload THEN
      RAISE EXCEPTION 'pinned protocol reference is immutable' USING ERRCODE='23514';
    END IF;
    IF owner.kind<>'experiment' OR target.id IS NULL OR rev.id IS NULL OR target.deleted_at IS NOT NULL
       OR target.kind<>'protocol_template' OR target.workspace_id<>owner.workspace_id OR rev.record_id<>target.id
       OR NEW.payload->>'protocolIdentifier' IS DISTINCT FROM rev.metadata_snapshot->>'identifier'
       OR NEW.payload->>'protocolTitle' IS DISTINCT FROM rev.metadata_snapshot->>'title'
       OR NEW.payload->>'version' IS DISTINCT FROM COALESCE(rev.metadata_snapshot#>>'{properties,version}',rev.metadata_version::text)
       OR NEW.payload->>'approvalStatus' IS DISTINCT FROM rev.metadata_snapshot->>'status'
       OR (NEW.payload->>'pinnedAt')::timestamptz IS DISTINCT FROM rev.created_at
       OR NEW.payload->>'pinnedByUserId' IS DISTINCT FROM rev.created_by_user_id THEN
      RAISE EXCEPTION 'invalid pinned protocol reference' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.type='procedure_step' THEN
    IF jsonb_typeof(NEW.payload->'text') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'stepNumber') IS DISTINCT FROM 'number'
      OR (NEW.payload->>'stepNumber')::numeric <> trunc((NEW.payload->>'stepNumber')::numeric) THEN
      RAISE EXCEPTION 'invalid procedure definition' USING ERRCODE='23514';
    END IF;
    IF owner.kind='protocol_template' THEN
      IF NEW.payload ?| ARRAY['sourceProtocolRevisionId','sourceStepBlockId','completed','note','completedAt','completedByUserId'] THEN
        RAISE EXCEPTION 'protocol definition cannot carry execution state' USING ERRCODE='23514';
      END IF;
    ELSIF owner.kind='experiment' THEN
      actor := api.current_user_id();
      IF TG_OP='INSERT' AND current_user IN ('authenticated','api_client') THEN
        RAISE EXCEPTION 'execution steps are created by pin_protocol_reference' USING ERRCODE='42501';
      END IF;
      BEGIN
        SELECT * INTO rev FROM api.revisions WHERE id=(NEW.payload->>'sourceProtocolRevisionId')::uuid;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step') THEN
          RAISE EXCEPTION 'source step is not in revision' USING ERRCODE='23514';
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid step provenance' USING ERRCODE='23514'; END;
      IF rev.id IS NULL OR NOT EXISTS (SELECT 1 FROM api.records rr WHERE rr.id=rev.record_id AND rr.workspace_id=owner.workspace_id AND rr.kind='protocol_template')
        OR jsonb_typeof(NEW.payload->'completed') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(NEW.payload->'note') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid execution step' USING ERRCODE='23514';
      END IF;
      IF NEW.payload->'stepNumber' IS DISTINCT FROM (
          SELECT x->'payload'->'stepNumber' FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step'
        ) THEN RAISE EXCEPTION 'execution step differs from pinned revision' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' AND (NEW.payload->'stepNumber' IS DISTINCT FROM OLD.payload->'stepNumber'
        OR NEW.payload->'sourceProtocolRevisionId' IS DISTINCT FROM OLD.payload->'sourceProtocolRevisionId'
        OR NEW.payload->'sourceStepBlockId' IS DISTINCT FROM OLD.payload->'sourceStepBlockId') THEN
        RAISE EXCEPTION 'execution step definition is immutable' USING ERRCODE='23514';
      END IF;
      IF TG_OP='INSERT' OR (OLD.payload->>'completed')::boolean IS DISTINCT FROM (NEW.payload->>'completed')::boolean THEN
        IF (NEW.payload->>'completed')::boolean THEN
          NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}',to_jsonb(clock_timestamp())),
            '{completedByUserId}',to_jsonb(actor));
        ELSE NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}','null'),'{completedByUserId}','null'); END IF;
      ELSE
        NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}',OLD.payload->'completedAt'),'{completedByUserId}',OLD.payload->'completedByUserId');
      END IF;
    ELSE RAISE EXCEPTION 'procedure step owner is invalid' USING ERRCODE='23514'; END IF;
  ELSIF NEW.type='file' THEN
    -- A draft file block (empty payload) is allowed; the upload flow populates
    -- it with a fileRecordId referencing a file record in this workspace.
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.payload->'fileRecordId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'fileIdentifier') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'displayName') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'mediaType') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'byteSize') IS DISTINCT FROM 'number'
      OR (NEW.payload->>'byteSize')::numeric < 0 THEN
      RAISE EXCEPTION 'invalid file block payload' USING ERRCODE='23514';
    END IF;
    BEGIN
      SELECT * INTO target FROM api.records WHERE id=(NEW.payload->>'fileRecordId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid file record UUID' USING ERRCODE='23514'; END;
    IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.kind<>'file'
       OR target.workspace_id<>owner.workspace_id
       OR NEW.payload->>'fileIdentifier' IS DISTINCT FROM target.identifier THEN
      RAISE EXCEPTION 'invalid file block target' USING ERRCODE='23514';
    END IF;
    -- The cached display metadata must match the live storage object so the
    -- block cannot lie about name, type or size at write time. The live status
    -- is fetched by the UI; it is not cached in the block payload.
    IF NOT EXISTS (
      SELECT 1 FROM api.file_objects fo
      WHERE fo.record_id=target.id AND fo.workspace_id=owner.workspace_id
        AND fo.display_name = NEW.payload->>'displayName'
        AND fo.media_type = NEW.payload->>'mediaType'
        AND fo.byte_size = (NEW.payload->>'byteSize')::bigint
    ) THEN
      RAISE EXCEPTION 'file block metadata does not match storage object' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.type='chart' THEN
    -- SCI-004 (decision 0029): chart block payload. A draft `{}` is allowed.
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF current_user='api_client' THEN
      RAISE EXCEPTION 'credential-authored chart writes are not supported' USING ERRCODE='42501';
    END IF;
    -- Frozen authority (decision 0029 §6): a chart is frozen only when
    -- payload->'frozen' is a JSON object. The frozen object is only ever
    -- written by the SECURITY DEFINER freeze_chart / unfreeze_chart /
    -- bind_chart_revision RPCs, which run as their owner (migrator), never as
    -- authenticated/api_client. Direct CRUD on api.blocks therefore cannot
    -- fabricate, remove or revision-bind a frozen payload, and a frozen
    -- chart's spec/title/provenance cannot drift. A live chart (frozen missing
    -- or JSON null) may still edit its spec/title/provenance freely.
    IF TG_OP='UPDATE' AND NEW.type='chart'
       AND jsonb_typeof(OLD.payload->'frozen')='object' THEN
      IF (OLD.payload->'frozen') IS DISTINCT FROM (NEW.payload->'frozen') THEN
        -- The frozen object itself changed (removed, content changed, or
        -- revisionId bound). Only the SECURITY DEFINER RPCs may do this.
        IF current_user IN ('authenticated','api_client') THEN
          RAISE EXCEPTION 'frozen chart mutations require freeze_chart/unfreeze_chart/bind_chart_revision'
            USING ERRCODE='42501';
        END IF;
        -- unfreeze: frozen object -> no/null frozen, rest byte-identical.
        IF jsonb_typeof(NEW.payload->'frozen') IS DISTINCT FROM 'object'
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
          RETURN NEW;
        END IF;
        -- revision binding: frozen object stays a frozen object, frozen.revisionId
        -- null -> uuid, rest of payload and frozen object byte-identical.
        IF jsonb_typeof(NEW.payload->'frozen')='object'
           AND OLD.payload->'frozen'->>'revisionId' IS NULL
           AND NEW.payload->'frozen'->>'revisionId' IS NOT NULL
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[])
           AND (NEW.payload->'frozen' #- ARRAY['revisionId']::text[]) IS NOT DISTINCT FROM (OLD.payload->'frozen' #- ARRAY['revisionId']::text[]) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'frozen chart is immutable' USING ERRCODE='23514';
      ELSIF NEW.payload IS DISTINCT FROM OLD.payload THEN
        -- Frozen object unchanged but the spec/title/provenance drifted.
        RAISE EXCEPTION 'frozen chart is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
    -- freeze transition: live (no/null frozen) -> frozen object. Only the
    -- SECURITY DEFINER freeze_chart RPC may add a frozen object; direct CRUD
    -- is rejected. The rest of the payload must be byte-identical.
    IF TG_OP='UPDATE' AND NEW.type='chart'
       AND jsonb_typeof(OLD.payload->'frozen') IS DISTINCT FROM 'object'
       AND jsonb_typeof(NEW.payload->'frozen')='object' THEN
      IF current_user IN ('authenticated','api_client') THEN
        RAISE EXCEPTION 'frozen chart mutations require freeze_chart/unfreeze_chart/bind_chart_revision'
          USING ERRCODE='42501';
      END IF;
      IF (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'frozen chart is immutable' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(NEW.payload->'title') IS DISTINCT FROM 'string'
       OR btrim(NEW.payload->>'title')='' THEN
      RAISE EXCEPTION 'chart title is required' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(NEW.payload->'spec') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid chart spec' USING ERRCODE='23514';
    END IF;
    <<chart_spec>>
    DECLARE
      spec jsonb := NEW.payload->'spec';
      ctype text := spec->>'type';
      cspecver int;
      cdatasets jsonb;
      cfields jsonb;
      cseries jsonb;
      ceb jsonb;
      cds api.datasets;
      citem jsonb;
      cbinding jsonb;
    BEGIN
      cspecver := NULLIF(spec->>'specVersion','')::int;
      IF cspecver IS NULL OR cspecver <> 1 THEN
        RAISE EXCEPTION 'unsupported chart spec version' USING ERRCODE='23514';
      END IF;
      IF ctype IS NULL OR ctype NOT IN ('line','scatter','scatter_line','connected_scatter','bar','grouped_bar','stacked_bar','histogram','box','violin','strip','summary','heatmap') THEN
        RAISE EXCEPTION 'unsupported chart type' USING ERRCODE='23514';
      END IF;
      cdatasets := spec->'datasets';
      IF jsonb_typeof(cdatasets) IS DISTINCT FROM 'array' OR jsonb_array_length(cdatasets)=0 THEN
        RAISE EXCEPTION 'chart datasets must be a non-empty array' USING ERRCODE='23514';
      END IF;
      cfields := spec->'fields';
      IF jsonb_typeof(cfields) IS DISTINCT FROM 'object'
         OR jsonb_typeof(cfields->'y') IS DISTINCT FROM 'object'
         OR (cfields->'y')->>'fieldId' IS NULL THEN
        RAISE EXCEPTION 'chart fields.y is required' USING ERRCODE='23514';
      END IF;
      IF ctype IN ('line','bar','grouped_bar','stacked_bar','connected_scatter','scatter_line','heatmap','summary') THEN
        cbinding := cfields->'x';
        IF jsonb_typeof(cbinding) IS DISTINCT FROM 'object'
           OR cbinding->>'fieldId' IS NULL THEN
          RAISE EXCEPTION 'chart fields.x is required for this chart type' USING ERRCODE='23514';
        END IF;
      END IF;

      -- SCI-01 type rules -------------------------------------------------
      -- Histograms and box plots measure fields.y directly; an x mapping
      -- would suggest a dependency that does not exist.
      IF ctype IN ('histogram','box')
         AND jsonb_typeof(cfields->'x') = 'object' THEN
        RAISE EXCEPTION 'chart fields.x must be null for histogram and box'
          USING ERRCODE='23514';
      END IF;
      -- Heatmaps plot an aggregated value grid, not series: grouping,
      -- colour/size mappings and error overlays are rejected so the cell
      -- aggregation stays unambiguous.
      IF ctype='heatmap' THEN
        cbinding := cfields->'x';
        IF jsonb_typeof(cbinding) IS DISTINCT FROM 'object'
           OR cbinding->>'fieldId' IS NULL THEN
          RAISE EXCEPTION 'chart fields.x is required for heatmap' USING ERRCODE='23514';
        END IF;
        FOREACH cbinding IN ARRAY ARRAY[cfields->'series', cfields->'color', cfields->'size']::jsonb[] LOOP
          IF jsonb_typeof(cbinding) = 'object' THEN
            RAISE EXCEPTION 'chart series/color/size must be null for heatmap'
              USING ERRCODE='23514';
          END IF;
        END LOOP;
        IF jsonb_typeof(spec->'overlays'->'errorBars') = 'object' THEN
          RAISE EXCEPTION 'chart overlays.errorBars must be null for heatmap'
            USING ERRCODE='23514';
        END IF;
      END IF;
      -- Facet mapping is allowed on live charts (shape check only); the
      -- freeze RPC refuses to snapshot faceted charts for now.
      cbinding := cfields->'facet';
      IF jsonb_typeof(cbinding) = 'object'
         AND cbinding->>'fieldId' IS NULL THEN
        RAISE EXCEPTION 'invalid facet binding' USING ERRCODE='23514';
      END IF;
      FOREACH citem IN ARRAY ARRAY[cfields->'facetRow', cfields->'facetCol', cfields->'group', cfields->'shape', cfields->'label']::jsonb[] LOOP
        IF jsonb_typeof(citem) = 'object' AND citem->>'fieldId' IS NULL THEN
          RAISE EXCEPTION 'invalid chart field binding' USING ERRCODE='23514';
        END IF;
      END LOOP;
      ceb := spec->'overlays'->'fit';
      IF jsonb_typeof(ceb) = 'object' AND COALESCE(ceb->>'method','ols') <> 'ols' THEN
        RAISE EXCEPTION 'unsupported chart fit method' USING ERRCODE='23514';
      END IF;
      -- Type parameters must belong to the spec's own type and stay within
      -- documented ranges. Absent params mean the documented defaults.
      IF jsonb_typeof(spec->'typeParams') NOT IN ('object','null')
         AND spec ? 'typeParams' THEN
        RAISE EXCEPTION 'invalid chart typeParams' USING ERRCODE='23514';
      END IF;
      DECLARE
        cparams jsonb := COALESCE(spec->'typeParams', '{}'::jsonb);
      BEGIN
        IF cparams ? 'histogram' AND ctype <> 'histogram' THEN
          RAISE EXCEPTION 'typeParams.histogram only applies to histogram charts'
            USING ERRCODE='23514';
        END IF;
        IF cparams ? 'box' AND ctype <> 'box' THEN
          RAISE EXCEPTION 'typeParams.box only applies to box charts'
            USING ERRCODE='23514';
        END IF;
        IF cparams ? 'heatmap' AND ctype <> 'heatmap' THEN
          RAISE EXCEPTION 'typeParams.heatmap only applies to heatmap charts'
            USING ERRCODE='23514';
        END IF;
        IF jsonb_typeof(cparams->'histogram') = 'object' THEN
          IF (cparams->'histogram' ? 'bins')
             AND ((cparams#>>'{histogram,bins}')::int IS NULL
                  OR (cparams#>>'{histogram,bins}')::int < 1
                  OR (cparams#>>'{histogram,bins}')::int > 200) THEN
            RAISE EXCEPTION 'histogram bins must be between 1 and 200' USING ERRCODE='23514';
          END IF;
          IF (cparams->'histogram' ? 'binWidth')
             AND (COALESCE((cparams#>>'{histogram,binWidth}')::float8, 0) <= 0
                  OR (cparams#>>'{histogram,binWidth}')::float8 IS NULL) THEN
            RAISE EXCEPTION 'histogram binWidth must be positive' USING ERRCODE='23514';
          END IF;
          IF (cparams->'histogram' ? 'bins')
             AND (cparams->'histogram' ? 'binWidth') THEN
            RAISE EXCEPTION 'histogram accepts bins or binWidth, not both'
              USING ERRCODE='23514';
          END IF;
        END IF;
        IF jsonb_typeof(cparams->'box') = 'object'
           AND (cparams->'box' ? 'showOutliers')
           AND jsonb_typeof(cparams#>'{box,showOutliers}') IS DISTINCT FROM 'boolean' THEN
          RAISE EXCEPTION 'box showOutliers must be boolean' USING ERRCODE='23514';
        END IF;
        IF jsonb_typeof(cparams->'heatmap') = 'object' THEN
          FOREACH cparam_key IN ARRAY ARRAY['xBins','yBins']::text[] LOOP
            IF cparams#>ARRAY['heatmap', cparam_key] IS NOT NULL
               AND ((cparams#>>ARRAY['heatmap', cparam_key])::int IS NULL
                    OR (cparams#>>ARRAY['heatmap', cparam_key])::int < 2
                    OR (cparams#>>ARRAY['heatmap', cparam_key])::int > 100) THEN
              RAISE EXCEPTION 'heatmap % must be between 2 and 100', cparam_key
                USING ERRCODE='23514';
            END IF;
          END LOOP;
          IF cparams->'heatmap' ? 'aggregate'
             AND (cparams->'heatmap')->>'aggregate'
                 NOT IN ('count','mean','median','min','max') THEN
            RAISE EXCEPTION 'invalid heatmap aggregate' USING ERRCODE='23514';
          END IF;
          IF COALESCE((cparams->'heatmap')->>'aggregate','count') <> 'count' THEN
            cbinding := cparams#>'{heatmap,valueField}';
            IF jsonb_typeof(cbinding) IS DISTINCT FROM 'object'
               OR cbinding->>'fieldId' IS NULL THEN
              RAISE EXCEPTION 'heatmap valueField is required when aggregating anything but counts'
                USING ERRCODE='23514';
            END IF;
          END IF;
        END IF;
      END;
      -- Series colours must come from the approved palette (DESIGN.md).
      cseries := spec->'display'->'series';
      IF jsonb_typeof(cseries)='array' THEN
        FOR citem IN SELECT value FROM jsonb_array_elements(cseries) LOOP
          IF lower(citem->>'color') NOT IN
             ('#006edc','#00a659','#9b61ea','#00a3bb','#e8a200') THEN
            RAISE EXCEPTION 'chart series color must be from the approved palette' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
      -- Dataset reference integrity: every datasetId must be an active
      -- canonical Dataset in the SAME workspace as the owning record.
      FOR citem IN SELECT value FROM jsonb_array_elements(cdatasets) LOOP
        BEGIN
          SELECT * INTO cds FROM api.datasets WHERE id=(citem->>'datasetId')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'invalid chart dataset UUID' USING ERRCODE='23514';
        END;
        IF cds.id IS NULL OR cds.lifecycle<>'active'
           OR cds.workspace_id<>owner.workspace_id THEN
          RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE='23514';
        END IF;
      END LOOP;
      -- Error-bar overlay must name a column and a basis when present.
      ceb := spec->'overlays'->'errorBars';
      IF ceb IS NOT NULL AND jsonb_typeof(ceb)='object' THEN
        IF ceb->>'basis' IS NULL
           OR ceb->>'basis' NOT IN ('sd','se','sem','ci','range','custom') THEN
          RAISE EXCEPTION 'invalid error bar overlay' USING ERRCODE='23514';
        END IF;
        IF COALESCE(ceb->>'source','field') = 'field'
           AND ceb->>'fieldId' IS NULL
           AND ceb->>'lowerFieldId' IS NULL THEN
          RAISE EXCEPTION 'invalid error bar overlay' USING ERRCODE='23514';
        END IF;
      END IF;
      -- SCI-01: data-coordinate annotations are Cartesian-only, capped at
      -- twelve entries, each with finite numeric x/y and a non-empty label.
      ceb := spec->'display'->'annotations';
      IF ceb IS NOT NULL THEN
        IF jsonb_typeof(ceb) IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'annotations must be an array when present' USING ERRCODE='23514';
        END IF;
        IF jsonb_array_length(ceb) > 12 THEN
          RAISE EXCEPTION 'at most 12 annotations are supported' USING ERRCODE='23514';
        END IF;
        IF jsonb_array_length(ceb) > 0
           AND ctype NOT IN ('line','scatter','scatter_line','connected_scatter','bar','grouped_bar','stacked_bar','summary') THEN
          RAISE EXCEPTION 'annotations are not supported for % charts', ctype
            USING ERRCODE='23514';
        END IF;
        FOR citem IN SELECT value FROM jsonb_array_elements(ceb) LOOP
          IF jsonb_typeof(citem) IS DISTINCT FROM 'object'
             OR jsonb_typeof(citem->'x') IS DISTINCT FROM 'number'
             OR jsonb_typeof(citem->'y') IS DISTINCT FROM 'number'
             OR jsonb_typeof(citem->'label') IS DISTINCT FROM 'string'
             OR btrim(citem->>'label')=''
             OR (citem->>'x')::float8 IS NULL OR (citem->>'y')::float8 IS NULL THEN
            RAISE EXCEPTION 'invalid annotation entry' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
      PERFORM "api"."validate_chart_spec_maturity"(spec);
    END chart_spec;
  ELSIF NEW.type='analysis' THEN
    -- SCI-03: an analysis block references a saved analysis definition by
    -- stable UUID (decision 0040). A draft `{}` is allowed.
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF current_user='api_client' THEN
      RAISE EXCEPTION 'credential-authored analysis writes are not supported' USING ERRCODE='42501';
    END IF;
    IF jsonb_typeof(NEW.payload->'title') IS DISTINCT FROM 'string'
       OR btrim(NEW.payload->>'title')='' THEN
      RAISE EXCEPTION 'analysis title is required' USING ERRCODE='23514';
    END IF;
    BEGIN
      analysis_definition_id := (NEW.payload->>'definitionId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid analysis definition UUID' USING ERRCODE='23514';
    END;
    IF NOT EXISTS (
      SELECT 1 FROM api.analysis_definitions d
      WHERE d.id=(NEW.payload->>'definitionId')::uuid
        AND d.workspace_id=owner.workspace_id
    ) THEN
      RAISE EXCEPTION 'invalid analysis definition reference' USING ERRCODE='23514';
    END IF;
    -- Provenance is optional prose.
    IF jsonb_typeof(NEW.payload->'provenance') NOT IN ('string','null')
       AND NEW.payload ? 'provenance' THEN
      RAISE EXCEPTION 'invalid analysis provenance' USING ERRCODE='23514';
    END IF;
    -- Frozen authority (mirrors charts): the frozen object is only ever
    -- written by the SECURITY DEFINER freeze_analysis_block /
    -- unfreeze_analysis_block RPCs. Direct CRUD cannot fabricate, remove or
    -- drift a frozen payload.
    IF TG_OP='UPDATE'
       AND jsonb_typeof(OLD.payload->'frozen')='object' THEN
      IF (OLD.payload->'frozen') IS DISTINCT FROM (NEW.payload->'frozen') THEN
        IF current_user IN ('authenticated','api_client') THEN
          RAISE EXCEPTION 'frozen analysis mutations require freeze_analysis_block/unfreeze_analysis_block'
            USING ERRCODE='42501';
        END IF;
        IF jsonb_typeof(NEW.payload->'frozen') IS DISTINCT FROM 'object'
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
          RETURN NEW;
        END IF;
        -- Revision binding at submission: frozen object stays a frozen
        -- object, frozen.revisionId null -> uuid, rest byte-identical.
        IF jsonb_typeof(NEW.payload->'frozen')='object'
           AND OLD.payload->'frozen'->>'revisionId' IS NULL
           AND NEW.payload->'frozen'->>'revisionId' IS NOT NULL
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[])
           AND (NEW.payload->'frozen' #- ARRAY['revisionId']::text[]) IS NOT DISTINCT FROM (OLD.payload->'frozen' #- ARRAY['revisionId']::text[]) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'frozen analysis is immutable' USING ERRCODE='23514';
      ELSIF NEW.payload IS DISTINCT FROM OLD.payload THEN
        RAISE EXCEPTION 'frozen analysis is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
    IF TG_OP='UPDATE'
       AND jsonb_typeof(OLD.payload->'frozen') IS DISTINCT FROM 'object'
       AND jsonb_typeof(NEW.payload->'frozen')='object' THEN
      IF current_user IN ('authenticated','api_client') THEN
        RAISE EXCEPTION 'frozen analysis mutations require freeze_analysis_block/unfreeze_analysis_block'
          USING ERRCODE='42501';
      END IF;
      IF (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'frozen analysis is immutable' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.type='plate_map' THEN
    -- SCI-005 (decision 0030): plate map block payload. A draft `{}` is
    -- allowed. Structural validation, well-code/dimension checks, duplicate
    -- detection, and sample reference integrity are enforced here. Sample
    -- links reuse the existing record_links table through deduplicated
    -- upserts — same pattern as materials blocks.
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF owner.kind<>'experiment' THEN
      RAISE EXCEPTION 'plate map blocks require an experiment owner' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(NEW.payload->'title') IS DISTINCT FROM 'string'
       OR btrim(NEW.payload->>'title')='' THEN
      RAISE EXCEPTION 'plate map title is required' USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(NEW.payload->'spec') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid plate map spec' USING ERRCODE='23514';
    END IF;
    <<plate_map_spec>>
    DECLARE
      pm_spec jsonb := NEW.payload->'spec';
      pm_format text := pm_spec->>'format';
      pm_specver int;
      pm_rows int;
      pm_cols int;
      pm_well_count int;
      pm_well_item jsonb;
      pm_well_code text;
      pm_well_row int;
      pm_well_col int;
      pm_expected_code text;
      pm_role text;
      pm_sample_ref jsonb;
      pm_vol_obj jsonb;
      pm_replicate int;
      pm_seen_codes text[] := ARRAY[]::text[];
      pm_actor text;
      pm_sample_target api.records;
    BEGIN
      pm_specver := NULLIF(pm_spec->>'specVersion','')::int;
      IF pm_specver IS NULL OR pm_specver <> 1 THEN
        RAISE EXCEPTION 'unsupported plate map spec version' USING ERRCODE='23514';
      END IF;
      -- Format and dimensions: the standard 6 to 1536-well plates.
      IF pm_format IS NULL OR internal.plate_format_rows(pm_format) IS NULL THEN
        RAISE EXCEPTION 'unsupported plate format' USING ERRCODE='23514';
      END IF;
      pm_rows := NULLIF(pm_spec->>'rows','')::int;
      pm_cols := NULLIF(pm_spec->>'cols','')::int;
      IF pm_rows IS NULL OR pm_rows<>internal.plate_format_rows(pm_format)
         OR pm_cols IS NULL OR pm_cols<>internal.plate_format_cols(pm_format) THEN
        RAISE EXCEPTION 'invalid plate dimensions for % (expected %×%)', pm_format,
          internal.plate_format_rows(pm_format), internal.plate_format_cols(pm_format) USING ERRCODE='23514';
      END IF;
      -- wells array
      pm_wells := pm_spec->'wells';
      IF jsonb_typeof(pm_wells) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'plate map wells must be an array' USING ERRCODE='23514';
      END IF;
      pm_well_count := jsonb_array_length(pm_wells);
      IF pm_well_count > pm_rows * pm_cols THEN
        RAISE EXCEPTION 'plate map well count exceeds plate capacity' USING ERRCODE='23514';
      END IF;
      -- validation config must be an object
      IF jsonb_typeof(pm_spec->'validation') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'plate map validation config is required' USING ERRCODE='23514';
      END IF;
      pm_actor := CASE WHEN current_user='authenticated' THEN api.current_user_id() ELSE NULL END;
      -- Iterate wells
      FOR pm_well_item IN SELECT value FROM jsonb_array_elements(pm_wells) LOOP
        -- wellCode
        pm_well_code := pm_well_item->>'wellCode';
        IF pm_well_code IS NULL OR pm_well_code !~ '^[A-Z]{1,2}[1-9][0-9]?$' THEN
          RAISE EXCEPTION 'invalid well code: %', pm_well_code USING ERRCODE='23514';
        END IF;
        -- row
        pm_well_row := NULLIF(pm_well_item->>'row','')::int;
        IF pm_well_row IS NULL OR pm_well_row < 0 OR pm_well_row >= pm_rows THEN
          RAISE EXCEPTION 'well row out of bounds: %', pm_well_row USING ERRCODE='23514';
        END IF;
        -- col
        pm_well_col := NULLIF(pm_well_item->>'col','')::int;
        IF pm_well_col IS NULL OR pm_well_col < 0 OR pm_well_col >= pm_cols THEN
          RAISE EXCEPTION 'well col out of bounds: %', pm_well_col USING ERRCODE='23514';
        END IF;
        -- Cross-check wellCode ↔ row/col
        pm_expected_code := internal.plate_row_label(pm_well_row) || (pm_well_col + 1)::text;
        IF pm_well_code IS DISTINCT FROM pm_expected_code THEN
          RAISE EXCEPTION 'well code % does not match row %, col %', pm_well_code, pm_well_row, pm_well_col USING ERRCODE='23514';
        END IF;
        -- Duplicate well codes
        IF pm_well_code = ANY(pm_seen_codes) THEN
          RAISE EXCEPTION 'duplicate well code: %', pm_well_code USING ERRCODE='23514';
        END IF;
        pm_seen_codes := array_append(pm_seen_codes, pm_well_code);
        -- role
        pm_role := pm_well_item->>'role';
        IF pm_role IS NULL OR pm_role NOT IN ('sample','positive_control','negative_control','blank','empty') THEN
          RAISE EXCEPTION 'unsupported assignment role: %', pm_role USING ERRCODE='23514';
        END IF;
        -- sampleRef (optional)
        pm_sample_ref := pm_well_item->'sampleRef';
        IF pm_sample_ref IS NOT NULL AND jsonb_typeof(pm_sample_ref)='object' THEN
          IF pm_sample_ref->>'recordId' IS NULL
             OR pm_sample_ref->>'identifier' IS NULL
             OR pm_sample_ref->>'title' IS NULL THEN
            RAISE EXCEPTION 'invalid sample reference in well %', pm_well_code USING ERRCODE='23514';
          END IF;
          -- Validate same-workspace sample record
          BEGIN
            SELECT * INTO pm_sample_target FROM api.records WHERE id=(pm_sample_ref->>'recordId')::uuid;
          EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'invalid sample reference UUID in well %', pm_well_code USING ERRCODE='23514';
          END;
          IF pm_sample_target.id IS NULL
             OR pm_sample_target.deleted_at IS NOT NULL
             OR pm_sample_target.workspace_id <> owner.workspace_id
             OR pm_sample_target.kind <> 'sample'
             OR pm_sample_ref->>'identifier' IS DISTINCT FROM pm_sample_target.identifier
             OR pm_sample_ref->>'title' IS DISTINCT FROM pm_sample_target.title THEN
            RAISE EXCEPTION 'invalid sample reference target in well %', pm_well_code USING ERRCODE='23514';
          END IF;
          -- Create/update deduplicated record_link (same pattern as materials)
          INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
          VALUES(owner.id, pm_sample_target.id, 'sample', pm_sample_target.identifier, 'sample', COALESCE(pm_actor, NEW.created_by_user_id))
          ON CONFLICT (source_record_id,target_identifier,link_type) DO UPDATE SET
            target_record_id = EXCLUDED.target_record_id,
            target_kind = EXCLUDED.target_kind;
        END IF;
        -- replicate (optional, must be positive integer)
        IF pm_well_item ? 'replicate' AND jsonb_typeof(pm_well_item->'replicate')='number' THEN
          pm_replicate := (pm_well_item->>'replicate')::int;
          IF pm_replicate < 1 OR pm_replicate <> trunc(pm_replicate::numeric) THEN
            RAISE EXCEPTION 'invalid replicate in well %', pm_well_code USING ERRCODE='23514';
          END IF;
        END IF;
        -- volume (optional, value must be positive)
        pm_vol_obj := pm_well_item->'volume';
        IF pm_vol_obj IS NOT NULL AND jsonb_typeof(pm_vol_obj)='object' THEN
          IF jsonb_typeof(pm_vol_obj->'value') IS DISTINCT FROM 'number'
             OR (pm_vol_obj->>'value')::numeric <= 0
             OR pm_vol_obj->>'unit' IS NULL
             OR btrim(pm_vol_obj->>'unit')='' THEN
            RAISE EXCEPTION 'invalid volume in well %', pm_well_code USING ERRCODE='23514';
          END IF;
        END IF;
      END LOOP;
    END plate_map_spec;
  ELSE
    IF current_user='api_client' THEN
      RAISE EXCEPTION 'credential-authored scientific block writes are not supported' USING ERRCODE='42501';
    END IF;
    actor := CASE WHEN current_user='authenticated' THEN api.current_user_id() ELSE NULL END;
    IF owner.kind<>'experiment' OR jsonb_typeof(NEW.payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid materials payload' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.payload->'items') i GROUP BY i->>'id' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'duplicate material item id' USING ERRCODE='23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'items') LOOP
      item_id:=item->>'id';
      IF item_id IS NULL OR item_id='' OR jsonb_typeof(item->'materialRecordId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'identifier') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR (item->>'quantity')::numeric<=0
        OR jsonb_typeof(item->'unit') IS DISTINCT FROM 'object' OR jsonb_typeof(item#>'{unit,code}') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item#>'{unit,symbol}') IS DISTINCT FROM 'string' OR btrim(item#>>'{unit,code}')='' OR btrim(item#>>'{unit,symbol}')=''
        OR item->>'observedAt' IS NULL THEN RAISE EXCEPTION 'invalid material item' USING ERRCODE='23514'; END IF;
      BEGIN PERFORM (item->>'observedAt')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid material observation timestamp' USING ERRCODE='23514'; END;
      IF TG_OP='UPDATE' THEN
        SELECT value INTO old_item FROM jsonb_array_elements(OLD.payload->'items') WHERE value->>'id'=item_id;
        IF old_item IS NOT NULL AND (item->'materialRecordId' IS DISTINCT FROM old_item->'materialRecordId'
          OR item->'kind' IS DISTINCT FROM old_item->'kind' OR item->'identifier' IS DISTINCT FROM old_item->'identifier'
          OR item->'title' IS DISTINCT FROM old_item->'title' OR item->'observedAt' IS DISTINCT FROM old_item->'observedAt') THEN
          RAISE EXCEPTION 'material observation identity is immutable' USING ERRCODE='23514'; END IF;
      END IF;
      IF old_item IS NULL THEN
        BEGIN SELECT * INTO target FROM api.records WHERE id=(item->>'materialRecordId')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid material UUID' USING ERRCODE='23514'; END;
        IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.workspace_id<>owner.workspace_id
          OR target.kind NOT IN ('sample','material') OR item->>'kind' IS DISTINCT FROM target.kind
          OR item->>'identifier' IS DISTINCT FROM target.identifier OR item->>'title' IS DISTINCT FROM target.title THEN
          RAISE EXCEPTION 'invalid material target' USING ERRCODE='23514'; END IF;
        IF target.status = 'expired' THEN
          RAISE EXCEPTION 'material % has expired and cannot be referenced', target.identifier
            USING ERRCODE = 'SB124';
        END IF;
        IF target.status = 'quarantined' THEN
          RAISE EXCEPTION 'material % is quarantined and cannot be referenced', target.identifier
            USING ERRCODE = 'SB120';
        END IF;
        INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
        VALUES(owner.id,target.id,target.kind,target.identifier,target.kind,COALESCE(actor,NEW.created_by_user_id))
        ON CONFLICT (source_record_id,target_identifier,link_type) DO UPDATE SET target_record_id=EXCLUDED.target_record_id,target_kind=EXCLUDED.target_kind;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $_$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_plate_design(p_workspace_id uuid, p_name text, p_project_id uuid DEFAULT NULL::uuid, p_format text DEFAULT '96_well'::text, p_rows integer DEFAULT 8, p_cols integer DEFAULT 12, p_validation jsonb DEFAULT '{}'::jsonb) RETURNS api.plate_designs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row "api"."plate_designs";
BEGIN
 IF p_project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project',p_project_id,'edit'); END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF internal.plate_format_rows(p_format) IS NULL THEN
    RAISE EXCEPTION 'unsupported plate format: %', p_format USING ERRCODE = 'SB005';
  END IF;
  IF p_rows IS NULL OR p_cols IS NULL OR p_rows < 1 OR p_cols < 1
     OR p_rows > 32 OR p_cols > 48 THEN
    RAISE EXCEPTION 'rows must be between 1 and 32 and cols between 1 and 48' USING ERRCODE = 'SB005';
  END IF;

  INSERT INTO "api"."plate_designs"
    (workspace_id, project_id, name, format, rows, cols, validation,
     created_by_user_id, updated_by_user_id)
  VALUES
    (p_workspace_id, p_project_id, btrim(p_name), p_format, p_rows, p_cols,
     COALESCE(p_validation, '{}'::jsonb),
     "api"."current_user_id"(), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.save_plate_layout_template(p_workspace_id uuid, p_name text, p_description text DEFAULT NULL::text, p_format text DEFAULT '96_well'::text, p_rows integer DEFAULT 8, p_cols integer DEFAULT 12, p_layout jsonb DEFAULT '{}'::jsonb, p_template_id uuid DEFAULT NULL::uuid) RETURNS api.plate_layout_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row "api"."plate_layout_templates";
BEGIN
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF internal.plate_format_rows(p_format) IS NULL THEN
    RAISE EXCEPTION 'unsupported plate format' USING ERRCODE = 'SB005';
  END IF;

  IF p_template_id IS NOT NULL THEN
    UPDATE "api"."plate_layout_templates"
      SET name = btrim(p_name), description = p_description, format = p_format,
          rows = p_rows, cols = p_cols, layout = COALESCE(p_layout, '{}'::jsonb)
      WHERE id = p_template_id AND workspace_id = p_workspace_id
      RETURNING * INTO v_row;
    IF v_row IS NULL THEN
      RAISE EXCEPTION 'template not found in workspace' USING ERRCODE = 'SB015';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO "api"."plate_layout_templates"
    (workspace_id, name, description, format, rows, cols, layout,
     created_by_user_id)
  VALUES
    (p_workspace_id, btrim(p_name), p_description, p_format, p_rows, p_cols,
     COALESCE(p_layout, '{}'::jsonb), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Plate runs
-- ---------------------------------------------------------------------------

CREATE TABLE api.plate_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    name text NOT NULL,
    project_id uuid,
    -- The experiment the plate belongs to, when there is one.
    record_id uuid,
    -- The plate design the layout was taken from, when it came from one.
    design_id uuid,
    format text NOT NULL,
    rows integer NOT NULL,
    cols integer NOT NULL,
    -- Layout snapshot: [{wellCode, role, sampleId?, sampleLabel?, concentration?, concentrationUnit?, volumeUl?}]
    wells jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- Raw readout: {"A1": 1234.5, "A2": null}
    readout jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- Analysis settings (normalisation, hit rule, QC limits, curve model).
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- The last analysis; null until one is saved, cleared by any edit above.
    results jsonb,
    -- pass, warn, fail or not_checked; null until analysed.
    qc_status text,
    status text DEFAULT 'draft' NOT NULL,
    analysed_at timestamp with time zone,
    analysed_by text,
    metadata_version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plate_runs_pkey PRIMARY KEY (id),
    CONSTRAINT uq_plate_runs_number UNIQUE (workspace_id, number),
    CONSTRAINT plate_runs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT plate_runs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT plate_runs_design_fk FOREIGN KEY (design_id) REFERENCES api.plate_designs(id) ON DELETE SET NULL,
    CONSTRAINT chk_plate_runs_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_plate_runs_format CHECK (internal.plate_format_rows(format) IS NOT NULL),
    CONSTRAINT chk_plate_runs_status CHECK (status IN ('draft', 'analysed', 'archived')),
    CONSTRAINT chk_plate_runs_qc CHECK (qc_status IS NULL OR qc_status IN ('pass', 'warn', 'fail', 'not_checked')),
    CONSTRAINT chk_plate_runs_wells CHECK (jsonb_typeof(wells) = 'array' AND jsonb_array_length(wells) <= 1536),
    CONSTRAINT chk_plate_runs_readout CHECK (jsonb_typeof(readout) = 'object'),
    CONSTRAINT chk_plate_runs_config CHECK (jsonb_typeof(config) = 'object'),
    CONSTRAINT chk_plate_runs_results CHECK (results IS NULL OR jsonb_typeof(results) = 'object')
);
--> statement-breakpoint
ALTER TABLE api.plate_runs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plate_runs_workspace ON api.plate_runs (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_plate_runs_record ON api.plate_runs (record_id) WHERE record_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_plate_runs_project ON api.plate_runs (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.plate_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plate_runs_select ON api.plate_runs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND (project_id IS NULL OR internal.can_view_project(project_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.plate_runs TO authenticated;
--> statement-breakpoint

-- Check a layout: every well inside the plate, a known role, no repeats, and a
-- sample link only to a sample in this workspace.
CREATE FUNCTION internal.check_plate_run_wells(p_wells jsonb, p_rows integer, p_cols integer, p_workspace_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_well jsonb;
  v_code text;
  v_seen text[] := ARRAY[]::text[];
  v_sample uuid;
  v_conc numeric;
  v_vol numeric;
BEGIN
  IF p_wells IS NULL OR jsonb_typeof(p_wells) <> 'array' THEN
    RAISE EXCEPTION 'the layout must be a list of wells' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_wells) > p_rows * p_cols THEN
    RAISE EXCEPTION 'the layout has more wells than the plate' USING ERRCODE = '22023';
  END IF;
  FOR v_well IN SELECT * FROM jsonb_array_elements(p_wells) LOOP
    IF jsonb_typeof(v_well) <> 'object' THEN
      RAISE EXCEPTION 'every well must be an object' USING ERRCODE = '22023';
    END IF;
    v_code := v_well ->> 'wellCode';
    IF v_code IS NULL OR internal.plate_well_row(v_code) IS NULL
       OR internal.plate_well_row(v_code) >= p_rows OR internal.plate_well_col(v_code) >= p_cols THEN
      RAISE EXCEPTION 'well % is not on this plate', coalesce(v_code, '(none)') USING ERRCODE = 'SB017';
    END IF;
    IF v_code = ANY(v_seen) THEN
      RAISE EXCEPTION 'well % appears twice', v_code USING ERRCODE = 'SB018';
    END IF;
    v_seen := v_seen || v_code;
    IF coalesce(v_well ->> 'role', '') NOT IN ('sample', 'positive_control', 'negative_control', 'blank', 'empty') THEN
      RAISE EXCEPTION 'well % has an unknown role', v_code USING ERRCODE = 'SB019';
    END IF;
    v_sample := nullif(v_well ->> 'sampleId', '')::uuid;
    IF v_sample IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM api.records r WHERE r.id = v_sample AND r.workspace_id = p_workspace_id AND r.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'the sample in well % was not found', v_code USING ERRCODE = 'SB016';
    END IF;
    v_conc := nullif(v_well ->> 'concentration', '')::numeric;
    IF v_conc IS NOT NULL AND v_conc < 0 THEN
      RAISE EXCEPTION 'well % has a negative concentration', v_code USING ERRCODE = '22023';
    END IF;
    v_vol := nullif(v_well ->> 'volumeUl', '')::numeric;
    IF v_vol IS NOT NULL AND v_vol <= 0 THEN
      RAISE EXCEPTION 'well % has a volume that is not above zero', v_code USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_plate_run_wells(p_wells jsonb, p_rows integer, p_cols integer, p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_plate_run_wells(p_wells jsonb, p_rows integer, p_cols integer, p_workspace_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Check a readout: wells on the plate, each a number or null.
CREATE FUNCTION internal.check_plate_run_readout(p_readout jsonb, p_rows integer, p_cols integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_entry record;
BEGIN
  IF p_readout IS NULL OR jsonb_typeof(p_readout) <> 'object' THEN
    RAISE EXCEPTION 'the readout must be an object of well to value' USING ERRCODE = '22023';
  END IF;
  FOR v_entry IN SELECT key, value FROM jsonb_each(p_readout) LOOP
    IF internal.plate_well_row(v_entry.key) IS NULL
       OR internal.plate_well_row(v_entry.key) >= p_rows OR internal.plate_well_col(v_entry.key) >= p_cols THEN
      RAISE EXCEPTION 'readout well % is not on this plate', v_entry.key USING ERRCODE = 'SB017';
    END IF;
    IF jsonb_typeof(v_entry.value) NOT IN ('number', 'null') THEN
      RAISE EXCEPTION 'readout for well % must be a number or empty', v_entry.key USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_plate_run_readout(p_readout jsonb, p_rows integer, p_cols integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_plate_run_readout(p_readout jsonb, p_rows integer, p_cols integer) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.create_plate_run(
    p_name text, p_format text, p_wells jsonb DEFAULT '[]'::jsonb, p_readout jsonb DEFAULT '{}'::jsonb,
    p_config jsonb DEFAULT '{}'::jsonb, p_project_id uuid DEFAULT NULL, p_record_id uuid DEFAULT NULL,
    p_design_id uuid DEFAULT NULL)
RETURNS api.plate_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_rows integer := internal.plate_format_rows(p_format);
  v_cols integer := internal.plate_format_cols(p_format);
  v_run api.plate_runs;
  v_project uuid := p_project_id;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_rows IS NULL THEN
    RAISE EXCEPTION 'unsupported plate format: %', p_format USING ERRCODE = 'SB005';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'a plate run needs a name' USING ERRCODE = '22023';
  END IF;
  IF p_record_id IS NOT NULL THEN
    SELECT project_id INTO v_project FROM api.records
     WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  END IF;
  IF v_project IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = v_project AND workspace_id = v_workspace_id) THEN
      RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('project', v_project, 'edit');
  END IF;
  IF p_design_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.plate_designs WHERE id = p_design_id AND workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'plate design not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.check_plate_run_wells(coalesce(p_wells, '[]'::jsonb), v_rows, v_cols, v_workspace_id);
  PERFORM internal.check_plate_run_readout(coalesce(p_readout, '{}'::jsonb), v_rows, v_cols);
  PERFORM pg_advisory_xact_lock(hashtextextended('plate_runs:' || v_workspace_id::text, 0));
  INSERT INTO api.plate_runs
    (workspace_id, number, name, project_id, record_id, design_id, format, rows, cols,
     wells, readout, config, created_by)
  VALUES
    (v_workspace_id, (SELECT coalesce(max(number), 0) + 1 FROM api.plate_runs WHERE workspace_id = v_workspace_id),
     btrim(p_name), v_project, p_record_id, p_design_id, p_format, v_rows, v_cols,
     coalesce(p_wells, '[]'::jsonb), coalesce(p_readout, '{}'::jsonb), coalesce(p_config, '{}'::jsonb),
     api.current_user_id())
  RETURNING * INTO v_run;
  PERFORM internal.emit_change_event(v_workspace_id, 'plate_run', v_run.id, 'create', v_run.record_id, v_run.project_id,
    jsonb_build_object('change', 'created', 'plateRunId', v_run.id,
                       'reference', 'PLR-' || lpad(v_run.number::text, 4, '0'),
                       'name', v_run.name, 'format', v_run.format));
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_plate_run(p_name text, p_format text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_project_id uuid, p_record_id uuid, p_design_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_plate_run(p_name text, p_format text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_project_id uuid, p_record_id uuid, p_design_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_plate_run(p_name text, p_format text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_project_id uuid, p_record_id uuid, p_design_id uuid) TO authenticated;
--> statement-breakpoint

-- Change a run's name, layout, readout or settings. Any change to the layout,
-- readout or settings clears the saved analysis.
CREATE FUNCTION api.update_plate_run(
    p_plate_run_id uuid, p_name text DEFAULT NULL, p_wells jsonb DEFAULT NULL, p_readout jsonb DEFAULT NULL,
    p_config jsonb DEFAULT NULL, p_expected_metadata_version integer DEFAULT NULL)
RETURNS api.plate_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.plate_runs;
  v_changes_data boolean := p_wells IS NOT NULL OR p_readout IS NOT NULL OR p_config IS NOT NULL;
BEGIN
  SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_run.project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project', v_run.project_id, 'edit'); END IF;
  IF v_run.status = 'archived' THEN
    RAISE EXCEPTION 'cannot change an archived plate run' USING ERRCODE = 'SB004';
  END IF;
  IF p_expected_metadata_version IS NOT NULL AND v_run.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %', p_expected_metadata_version, v_run.metadata_version
      USING ERRCODE = 'SB001';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a plate run needs a name' USING ERRCODE = '22023';
  END IF;
  IF p_wells IS NOT NULL THEN
    PERFORM internal.check_plate_run_wells(p_wells, v_run.rows, v_run.cols, v_run.workspace_id);
  END IF;
  IF p_readout IS NOT NULL THEN
    PERFORM internal.check_plate_run_readout(p_readout, v_run.rows, v_run.cols);
  END IF;
  IF p_config IS NOT NULL AND jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'settings must be an object' USING ERRCODE = '22023';
  END IF;
  UPDATE api.plate_runs SET
      name = coalesce(btrim(p_name), name),
      wells = coalesce(p_wells, wells),
      readout = coalesce(p_readout, readout),
      config = coalesce(p_config, config),
      results = CASE WHEN v_changes_data THEN NULL ELSE results END,
      qc_status = CASE WHEN v_changes_data THEN NULL ELSE qc_status END,
      status = CASE WHEN v_changes_data THEN 'draft' ELSE status END,
      analysed_at = CASE WHEN v_changes_data THEN NULL ELSE analysed_at END,
      analysed_by = CASE WHEN v_changes_data THEN NULL ELSE analysed_by END,
      metadata_version = metadata_version + 1,
      updated_at = now()
    WHERE id = p_plate_run_id
    RETURNING * INTO v_run;
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_plate_run(p_plate_run_id uuid, p_name text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_expected_metadata_version integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_plate_run(p_plate_run_id uuid, p_name text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_expected_metadata_version integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_plate_run(p_plate_run_id uuid, p_name text, p_wells jsonb, p_readout jsonb, p_config jsonb, p_expected_metadata_version integer) TO authenticated;
--> statement-breakpoint

-- Save an analysis against a run. The analysis is computed by the app from the
-- stored layout, readout and settings; this keeps it beside them with the plate's
-- QC verdict.
CREATE FUNCTION api.save_plate_run_analysis(p_plate_run_id uuid, p_analysis jsonb, p_qc_status text, p_expected_metadata_version integer DEFAULT NULL)
RETURNS api.plate_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.plate_runs;
BEGIN
  SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_run.project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project', v_run.project_id, 'edit'); END IF;
  IF v_run.status = 'archived' THEN
    RAISE EXCEPTION 'cannot analyse an archived plate run' USING ERRCODE = 'SB004';
  END IF;
  IF p_expected_metadata_version IS NOT NULL AND v_run.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %', p_expected_metadata_version, v_run.metadata_version
      USING ERRCODE = 'SB001';
  END IF;
  IF p_analysis IS NULL OR jsonb_typeof(p_analysis) <> 'object' THEN
    RAISE EXCEPTION 'the analysis must be an object' USING ERRCODE = '22023';
  END IF;
  IF p_qc_status IS NULL OR p_qc_status NOT IN ('pass', 'warn', 'fail', 'not_checked') THEN
    RAISE EXCEPTION 'unknown QC status' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_run.wells) = 0 OR v_run.readout = '{}'::jsonb THEN
    RAISE EXCEPTION 'add a layout and a readout before analysing' USING ERRCODE = '22023';
  END IF;
  UPDATE api.plate_runs SET
      results = p_analysis, qc_status = p_qc_status, status = 'analysed',
      analysed_at = now(), analysed_by = api.current_user_id(),
      metadata_version = metadata_version + 1, updated_at = now()
    WHERE id = p_plate_run_id
    RETURNING * INTO v_run;
  PERFORM internal.emit_change_event(v_run.workspace_id, 'plate_run', v_run.id, 'update', v_run.record_id, v_run.project_id,
    jsonb_build_object('change', 'analysed', 'plateRunId', v_run.id,
                       'reference', 'PLR-' || lpad(v_run.number::text, 4, '0'),
                       'name', v_run.name, 'qcStatus', v_run.qc_status,
                       'zPrime', p_analysis #> '{qc,zPrime}',
                       'hitSamples', p_analysis #> '{summary,hitSamples}',
                       'testedSamples', p_analysis #> '{summary,testedSamples}'));
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_plate_run_analysis(p_plate_run_id uuid, p_analysis jsonb, p_qc_status text, p_expected_metadata_version integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_plate_run_analysis(p_plate_run_id uuid, p_analysis jsonb, p_qc_status text, p_expected_metadata_version integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_plate_run_analysis(p_plate_run_id uuid, p_analysis jsonb, p_qc_status text, p_expected_metadata_version integer) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.archive_plate_run(p_plate_run_id uuid) RETURNS api.plate_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.plate_runs;
BEGIN
  SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_run.project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project', v_run.project_id, 'edit'); END IF;
  IF v_run.status = 'archived' THEN RETURN v_run; END IF;
  UPDATE api.plate_runs SET status = 'archived', metadata_version = metadata_version + 1, updated_at = now()
    WHERE id = p_plate_run_id RETURNING * INTO v_run;
  PERFORM internal.emit_change_event(v_run.workspace_id, 'plate_run', v_run.id, 'update', v_run.record_id, v_run.project_id,
    jsonb_build_object('change', 'archived', 'plateRunId', v_run.id,
                       'reference', 'PLR-' || lpad(v_run.number::text, 4, '0'), 'name', v_run.name));
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.archive_plate_run(p_plate_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.archive_plate_run(p_plate_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.archive_plate_run(p_plate_run_id uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Worklists
-- ---------------------------------------------------------------------------

CREATE TABLE api.plate_worklists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    name text NOT NULL,
    run_id uuid,
    -- The experiment the transfers are for; samples drawn are withdrawn for it.
    record_id uuid,
    format text NOT NULL,
    mode text NOT NULL,
    source_plate text NOT NULL,
    source_format text NOT NULL,
    dest_plate text NOT NULL,
    dest_format text NOT NULL,
    -- [{sourceWell, destWell, volumeUl, label, sampleId}]
    transfers jsonb DEFAULT '[]'::jsonb NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'planned' NOT NULL,
    -- The robot's log matched to the plan: each transfer with its status and volume moved.
    reconciled jsonb,
    -- What completing it recorded: samples withdrawn and any that could not be.
    withdrawals jsonb,
    completed_at timestamp with time zone,
    completed_by text,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plate_worklists_pkey PRIMARY KEY (id),
    CONSTRAINT uq_plate_worklists_number UNIQUE (workspace_id, number),
    CONSTRAINT plate_worklists_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT plate_worklists_run_fk FOREIGN KEY (run_id) REFERENCES api.plate_runs(id) ON DELETE SET NULL,
    CONSTRAINT plate_worklists_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT chk_plate_worklists_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_plate_worklists_format CHECK (format IN ('csv', 'echo', 'tecan_gwl', 'hamilton', 'opentrons')),
    CONSTRAINT chk_plate_worklists_mode CHECK (mode IN ('stamp', 'cherry_pick')),
    CONSTRAINT chk_plate_worklists_formats CHECK (internal.plate_format_rows(source_format) IS NOT NULL
                                                  AND internal.plate_format_rows(dest_format) IS NOT NULL),
    CONSTRAINT chk_plate_worklists_status CHECK (status IN ('planned', 'complete', 'cancelled')),
    CONSTRAINT chk_plate_worklists_transfers CHECK (jsonb_typeof(transfers) = 'array' AND jsonb_array_length(transfers) <= 20000)
);
--> statement-breakpoint
ALTER TABLE api.plate_worklists OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plate_worklists_workspace ON api.plate_worklists (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_plate_worklists_run ON api.plate_worklists (run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.plate_worklists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plate_worklists_select ON api.plate_worklists FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND (run_id IS NULL OR EXISTS (SELECT 1 FROM api.plate_runs r WHERE r.id = run_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.plate_worklists TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.create_plate_worklist(
    p_name text, p_format text, p_mode text, p_source_plate text, p_source_format text,
    p_dest_plate text, p_dest_format text, p_transfers jsonb, p_plate_run_id uuid DEFAULT NULL,
    p_record_id uuid DEFAULT NULL, p_options jsonb DEFAULT '{}'::jsonb)
RETURNS api.plate_worklists
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_wl api.plate_worklists;
  v_t jsonb;
  v_sr integer := internal.plate_format_rows(p_source_format);
  v_sc integer := internal.plate_format_cols(p_source_format);
  v_dr integer := internal.plate_format_rows(p_dest_format);
  v_dc integer := internal.plate_format_cols(p_dest_format);
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) = 0 THEN
    RAISE EXCEPTION 'a worklist needs a name' USING ERRCODE = '22023';
  END IF;
  IF v_sr IS NULL OR v_dr IS NULL THEN
    RAISE EXCEPTION 'unsupported plate format' USING ERRCODE = 'SB005';
  END IF;
  IF p_transfers IS NULL OR jsonb_typeof(p_transfers) <> 'array' OR jsonb_array_length(p_transfers) = 0 THEN
    RAISE EXCEPTION 'a worklist needs at least one transfer' USING ERRCODE = '22023';
  END IF;
  FOR v_t IN SELECT * FROM jsonb_array_elements(p_transfers) LOOP
    IF jsonb_typeof(v_t) <> 'object'
       OR internal.plate_well_row(v_t ->> 'sourceWell') IS NULL OR internal.plate_well_row(v_t ->> 'sourceWell') >= v_sr
       OR internal.plate_well_col(v_t ->> 'sourceWell') >= v_sc
       OR internal.plate_well_row(v_t ->> 'destWell') IS NULL OR internal.plate_well_row(v_t ->> 'destWell') >= v_dr
       OR internal.plate_well_col(v_t ->> 'destWell') >= v_dc THEN
      RAISE EXCEPTION 'a transfer names a well that is not on its plate' USING ERRCODE = 'SB017';
    END IF;
    IF coalesce((v_t ->> 'volumeUl')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'every transfer needs a volume above zero' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_plate_run_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.plate_runs WHERE id = p_plate_run_id AND workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF p_record_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM api.records WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('plate_worklists:' || v_workspace_id::text, 0));
  INSERT INTO api.plate_worklists
    (workspace_id, number, name, run_id, record_id, format, mode, source_plate, source_format,
     dest_plate, dest_format, transfers, options, created_by)
  VALUES
    (v_workspace_id, (SELECT coalesce(max(number), 0) + 1 FROM api.plate_worklists WHERE workspace_id = v_workspace_id),
     btrim(p_name), p_plate_run_id, p_record_id, p_format, p_mode, btrim(p_source_plate), p_source_format,
     btrim(p_dest_plate), p_dest_format, p_transfers, coalesce(p_options, '{}'::jsonb), api.current_user_id())
  RETURNING * INTO v_wl;
  PERFORM internal.emit_change_event(v_workspace_id, 'plate_worklist', v_wl.id, 'create', v_wl.record_id, NULL,
    jsonb_build_object('change', 'created', 'worklistId', v_wl.id,
                       'reference', 'WL-' || lpad(v_wl.number::text, 4, '0'),
                       'name', v_wl.name, 'format', v_wl.format, 'transfers', jsonb_array_length(p_transfers)));
  RETURN v_wl;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_plate_worklist(p_name text, p_format text, p_mode text, p_source_plate text, p_source_format text, p_dest_plate text, p_dest_format text, p_transfers jsonb, p_plate_run_id uuid, p_record_id uuid, p_options jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_plate_worklist(p_name text, p_format text, p_mode text, p_source_plate text, p_source_format text, p_dest_plate text, p_dest_format text, p_transfers jsonb, p_plate_run_id uuid, p_record_id uuid, p_options jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_plate_worklist(p_name text, p_format text, p_mode text, p_source_plate text, p_source_format text, p_dest_plate text, p_dest_format text, p_transfers jsonb, p_plate_run_id uuid, p_record_id uuid, p_options jsonb) TO authenticated;
--> statement-breakpoint

-- Volume in µL for a sample's quantity unit; null when the unit is not a volume.
CREATE FUNCTION internal.volume_unit_in_ul(p_unit text) RETURNS numeric
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE lower(btrim(coalesce(p_unit, '')))
    WHEN 'ul' THEN 1 WHEN 'µl' THEN 1 WHEN 'μl' THEN 1
    WHEN 'ml' THEN 1000 WHEN 'l' THEN 1000000 WHEN 'nl' THEN 0.001 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.volume_unit_in_ul(p_unit text) OWNER TO migrator;
--> statement-breakpoint

-- Complete a worklist from the robot's log. p_reconciled is the planned
-- transfers each with a status and the volume moved (µL). With
-- p_record_withdrawals the volumes moved are taken out of the source samples
-- (which links each sample to the experiment); a sample that cannot be
-- withdrawn from is listed, never silently skipped, and does not stop the rest.
CREATE FUNCTION api.complete_plate_worklist(
    p_worklist_id uuid, p_reconciled jsonb, p_purpose_record_id uuid DEFAULT NULL,
    p_record_withdrawals boolean DEFAULT true)
RETURNS api.plate_worklists
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_wl api.plate_worklists;
  v_purpose uuid;
  v_sample record;
  v_rec api.records;
  v_unit text;
  v_factor numeric;
  v_qty numeric;
  v_done jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_wl FROM api.plate_worklists WHERE id = p_worklist_id FOR UPDATE;
  IF v_wl.id IS NULL OR v_wl.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'worklist not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_wl.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_wl.status <> 'planned' THEN
    RAISE EXCEPTION 'this worklist is already %', v_wl.status USING ERRCODE = 'SB004';
  END IF;
  IF p_reconciled IS NULL OR jsonb_typeof(p_reconciled) <> 'array' THEN
    RAISE EXCEPTION 'the reconciled log must be a list' USING ERRCODE = '22023';
  END IF;
  v_purpose := coalesce(p_purpose_record_id, v_wl.record_id);

  IF p_record_withdrawals THEN
    IF v_purpose IS NULL THEN
      RAISE EXCEPTION 'name the experiment the samples were used for' USING ERRCODE = '22023';
    END IF;
    FOR v_sample IN
      SELECT (t ->> 'sampleId')::uuid AS sample_id, sum(coalesce((t ->> 'movedUl')::numeric, 0)) AS total_ul
        FROM jsonb_array_elements(p_reconciled) t
       WHERE nullif(t ->> 'sampleId', '') IS NOT NULL
       GROUP BY 1 HAVING sum(coalesce((t ->> 'movedUl')::numeric, 0)) > 0
    LOOP
      SELECT * INTO v_rec FROM api.records WHERE id = v_sample.sample_id AND kind = 'sample';
      IF v_rec.id IS NULL THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('sampleId', v_sample.sample_id, 'reason', 'not_found'));
        CONTINUE;
      END IF;
      v_unit := nullif(btrim(coalesce(v_rec.properties ->> 'quantityUnit', '')), '');
      v_factor := internal.volume_unit_in_ul(v_unit);
      IF v_factor IS NULL THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'sampleId', v_sample.sample_id, 'identifier', v_rec.identifier, 'reason', 'not_a_volume'));
        CONTINUE;
      END IF;
      v_qty := round(v_sample.total_ul / v_factor, 6);
      BEGIN
        PERFORM api.withdraw_sample(v_rec.id, v_qty, v_rec.metadata_version, v_purpose, v_unit,
          'Moved by worklist WL-' || lpad(v_wl.number::text, 4, '0'));
        v_done := v_done || jsonb_build_array(jsonb_build_object(
          'sampleId', v_rec.id, 'identifier', v_rec.identifier, 'quantity', v_qty, 'unit', v_unit));
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'sampleId', v_rec.id, 'identifier', v_rec.identifier, 'reason', 'refused', 'message', SQLERRM));
      END;
    END LOOP;
  END IF;

  UPDATE api.plate_worklists SET
      status = 'complete', reconciled = p_reconciled,
      withdrawals = jsonb_build_object('recorded', p_record_withdrawals, 'withdrawn', v_done, 'skipped', v_skipped),
      record_id = coalesce(v_purpose, record_id),
      completed_at = now(), completed_by = api.current_user_id(), updated_at = now()
    WHERE id = p_worklist_id
    RETURNING * INTO v_wl;
  PERFORM internal.emit_change_event(v_wl.workspace_id, 'plate_worklist', v_wl.id, 'update', v_wl.record_id, NULL,
    jsonb_build_object('change', 'completed', 'worklistId', v_wl.id,
                       'reference', 'WL-' || lpad(v_wl.number::text, 4, '0'), 'name', v_wl.name,
                       'transfers', jsonb_array_length(v_wl.transfers),
                       'samplesWithdrawn', jsonb_array_length(v_done)));
  RETURN v_wl;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.complete_plate_worklist(p_worklist_id uuid, p_reconciled jsonb, p_purpose_record_id uuid, p_record_withdrawals boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.complete_plate_worklist(p_worklist_id uuid, p_reconciled jsonb, p_purpose_record_id uuid, p_record_withdrawals boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.complete_plate_worklist(p_worklist_id uuid, p_reconciled jsonb, p_purpose_record_id uuid, p_record_withdrawals boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.cancel_plate_worklist(p_worklist_id uuid) RETURNS api.plate_worklists
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_wl api.plate_worklists;
BEGIN
  SELECT * INTO v_wl FROM api.plate_worklists WHERE id = p_worklist_id FOR UPDATE;
  IF v_wl.id IS NULL OR v_wl.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'worklist not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_wl.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_wl.status <> 'planned' THEN
    RAISE EXCEPTION 'only a planned worklist can be cancelled' USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.plate_worklists SET status = 'cancelled', updated_at = now()
    WHERE id = p_worklist_id RETURNING * INTO v_wl;
  RETURN v_wl;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_plate_worklist(p_worklist_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_plate_worklist(p_worklist_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_plate_worklist(p_worklist_id uuid) TO authenticated;
--> statement-breakpoint

-- Events.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''plate_run''::text, ''plate_worklist''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('plate_run.created'), ('plate_run.analysed'), ('plate_run.archived'),
  ('plate_worklist.created'), ('plate_worklist.completed');
