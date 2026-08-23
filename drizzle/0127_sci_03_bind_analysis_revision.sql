-- SCI-03 follow-up: revision binding for frozen analysis blocks.
--
-- Mirrors bind_chart_revision (decision 0029 §7): pins a frozen analysis to
-- the submitted revision that captured it, which also locks it against
-- unfreeze. The trigger learns the one reachable frozen.revisionId
-- transition; the new SECURITY DEFINER RPC validates that the revision
-- belongs to the same record and workspace as the block.

-- ---------------------------------------------------------------------------
-- 1. validate_scientific_block — permit the bind transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text; cparam_key text; analysis_definition_id uuid;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials','file','chart','analysis') THEN RETURN NEW; END IF;
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
      IF NEW.payload->'text' IS DISTINCT FROM (
          SELECT x->'payload'->'text' FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step'
        ) OR NEW.payload->'stepNumber' IS DISTINCT FROM (
          SELECT x->'payload'->'stepNumber' FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step'
        ) THEN RAISE EXCEPTION 'execution step differs from pinned revision' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' AND (NEW.payload->'text' IS DISTINCT FROM OLD.payload->'text'
        OR NEW.payload->'stepNumber' IS DISTINCT FROM OLD.payload->'stepNumber'
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
      ctable api.scientific_tables;
      citem jsonb;
      cbinding jsonb;
    BEGIN
      cspecver := NULLIF(spec->>'specVersion','')::int;
      IF cspecver IS NULL OR cspecver <> 1 THEN
        RAISE EXCEPTION 'unsupported chart spec version' USING ERRCODE='23514';
      END IF;
      IF ctype IS NULL OR ctype NOT IN ('line','scatter','bar','histogram','box','heatmap') THEN
        RAISE EXCEPTION 'unsupported chart type' USING ERRCODE='23514';
      END IF;
      cdatasets := spec->'datasets';
      IF jsonb_typeof(cdatasets) IS DISTINCT FROM 'array' OR jsonb_array_length(cdatasets)=0 THEN
        RAISE EXCEPTION 'chart datasets must be a non-empty array' USING ERRCODE='23514';
      END IF;
      cfields := spec->'fields';
      IF jsonb_typeof(cfields) IS DISTINCT FROM 'object'
         OR jsonb_typeof(cfields->'y') IS DISTINCT FROM 'object'
         OR (cfields->'y')->>'columnId' IS NULL
         OR (cfields->'y')->>'fieldName' IS NULL THEN
        RAISE EXCEPTION 'chart fields.y is required' USING ERRCODE='23514';
      END IF;
      IF ctype IN ('line','bar') THEN
        cbinding := cfields->'x';
        IF jsonb_typeof(cbinding) IS DISTINCT FROM 'object'
           OR cbinding->>'columnId' IS NULL OR cbinding->>'fieldName' IS NULL THEN
          RAISE EXCEPTION 'chart fields.x is required for line and bar' USING ERRCODE='23514';
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
           OR cbinding->>'columnId' IS NULL OR cbinding->>'fieldName' IS NULL THEN
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
         AND (cbinding->>'columnId' IS NULL OR cbinding->>'fieldName' IS NULL) THEN
        RAISE EXCEPTION 'invalid facet binding' USING ERRCODE='23514';
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
               OR cbinding->>'columnId' IS NULL OR cbinding->>'fieldName' IS NULL THEN
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
      -- Dataset reference integrity: every tableId must be an active
      -- scientific table in the SAME workspace as the owning record.
      FOR citem IN SELECT value FROM jsonb_array_elements(cdatasets) LOOP
        BEGIN
          SELECT * INTO ctable FROM api.scientific_tables WHERE id=(citem->>'tableId')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'invalid chart dataset UUID' USING ERRCODE='23514';
        END;
        IF ctable.id IS NULL OR ctable.lifecycle<>'active'
           OR ctable.workspace_id<>owner.workspace_id THEN
          RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE='23514';
        END IF;
      END LOOP;
      -- Error-bar overlay must name a column and a basis when present.
      ceb := spec->'overlays'->'errorBars';
      IF ceb IS NOT NULL AND jsonb_typeof(ceb)='object' THEN
        IF ceb->>'columnId' IS NULL OR ceb->>'fieldName' IS NULL
           OR ceb->>'basis' IS NULL
           OR ceb->>'basis' NOT IN ('sd','se','range','custom') THEN
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
           AND ctype NOT IN ('line','scatter','bar') THEN
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
          RAISE EXCEPTION 'frozen analysis mutations require freeze_analysis_block/unfreeze_analysis_block/bind_analysis_revision'
            USING ERRCODE='42501';
        END IF;
        -- unfreeze: frozen object -> no/null frozen, rest byte-identical.
        IF jsonb_typeof(NEW.payload->'frozen') IS DISTINCT FROM 'object'
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
          RETURN NEW;
        END IF;
        -- revision binding: frozen stays a frozen object, revisionId
        -- null -> uuid, everything else byte-identical (mirrors charts).
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
          OR target.kind NOT IN ('sample','reagent') OR item->>'kind' IS DISTINCT FROM target.kind
          OR item->>'identifier' IS DISTINCT FROM target.identifier OR item->>'title' IS DISTINCT FROM target.title THEN
          RAISE EXCEPTION 'invalid material target' USING ERRCODE='23514'; END IF;
        INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
        VALUES(owner.id,target.id,target.kind,target.identifier,target.kind,COALESCE(actor,NEW.created_by_user_id))
        ON CONFLICT (source_record_id,target_identifier,link_type) DO UPDATE SET target_record_id=EXCLUDED.target_record_id,target_kind=EXCLUDED.target_kind;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."validate_scientific_block"() FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. bind_analysis_revision — pin a frozen analysis to a submitted revision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."bind_analysis_revision"(
  p_block_id uuid,
  p_revision_id uuid,
  p_expected_version int
)
RETURNS "api"."blocks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_block "api"."blocks";
  v_owner "api"."records";
  v_rev "api"."revisions";
  v_rev_owner "api"."records";
  v_frozen jsonb;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'analysis' THEN
    RAISE EXCEPTION 'block is not an analysis' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  v_frozen := v_block.payload->'frozen';
  IF jsonb_typeof(v_frozen) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'analysis is not frozen' USING ERRCODE = '23514';
  END IF;
  IF v_frozen->>'revisionId' IS NOT NULL THEN
    RAISE EXCEPTION 'analysis is already bound to a revision' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL
     OR v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_member"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rev FROM "api"."revisions" WHERE id = p_revision_id;
  IF v_rev.id IS NULL THEN RAISE EXCEPTION 'revision not found' USING ERRCODE = '23503'; END IF;
  SELECT * INTO v_rev_owner FROM "api"."records" WHERE id = v_rev.record_id;
  IF v_rev_owner.id IS NULL
     OR v_rev_owner.workspace_id IS DISTINCT FROM v_owner.workspace_id
     OR v_rev.record_id <> v_block.record_id THEN
    RAISE EXCEPTION 'revision does not belong to this record' USING ERRCODE = '23514';
  END IF;
  v_payload := jsonb_set(v_block.payload, ARRAY['frozen','revisionId'], to_jsonb(p_revision_id::text));
  UPDATE "api"."blocks"
    SET payload = v_payload,
        version = v_block.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_block;
  RETURN v_block;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."bind_analysis_revision"(uuid, uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."bind_analysis_revision"(uuid, uuid, int) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';--> statement-breakpoint
