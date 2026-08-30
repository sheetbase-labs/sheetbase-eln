-- SCI-04: ChartSpec validation parity with TypeScript validateChartSpec.

-- SCI-04: ChartSpec overlay and typeParam rules that match TypeScript
-- validateChartSpec (OLS degree, references, strip jitter, bar stacking,
-- summary statistic, error-bar interval pairing).

CREATE OR REPLACE FUNCTION "api"."validate_chart_spec_maturity"(p_spec jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  ctype text := p_spec->>'type';
  fit jsonb := p_spec#>'{overlays,fit}';
  refs jsonb := p_spec#>'{overlays,references}';
  eb jsonb := p_spec#>'{overlays,errorBars}';
  params jsonb := COALESCE(p_spec->'typeParams', '{}'::jsonb);
  item jsonb;
  degree numeric;
  jitter float8;
  multiplier float8;
BEGIN
  IF jsonb_typeof(fit) = 'object' THEN
    IF fit->>'method' IS DISTINCT FROM 'ols' THEN
      RAISE EXCEPTION 'overlays.fit must be OLS with degree 1–4' USING ERRCODE='23514';
    END IF;
    IF fit ? 'degree' THEN
      IF jsonb_typeof(fit->'degree') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'overlays.fit must be OLS with degree 1–4' USING ERRCODE='23514';
      END IF;
      degree := (fit->>'degree')::numeric;
      IF degree IS NULL OR degree <> trunc(degree) OR degree < 1 OR degree > 4 THEN
        RAISE EXCEPTION 'overlays.fit must be OLS with degree 1–4' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;

  IF jsonb_typeof(eb) = 'object' THEN
    IF (jsonb_typeof(eb->'lowerFieldId') = 'string')
         IS DISTINCT FROM (jsonb_typeof(eb->'upperFieldId') = 'string') THEN
      RAISE EXCEPTION 'errorBars.lowerFieldId and errorBars.upperFieldId must be provided together'
        USING ERRCODE='23514';
    END IF;
    IF jsonb_typeof(eb->'lowerFieldId') = 'string' THEN
      BEGIN
        PERFORM (eb->>'lowerFieldId')::uuid;
        PERFORM (eb->>'upperFieldId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'errorBars.lowerFieldId and errorBars.upperFieldId must be UUIDs'
          USING ERRCODE='23514';
      END;
    END IF;
    IF eb ? 'multiplier' THEN
      IF jsonb_typeof(eb->'multiplier') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'errorBars.multiplier must be a positive finite number' USING ERRCODE='23514';
      END IF;
      multiplier := (eb->>'multiplier')::float8;
      IF multiplier IS NULL OR multiplier <= 0 OR multiplier = 'NaN'::float8
         OR multiplier = 'Infinity'::float8 OR multiplier = '-Infinity'::float8 THEN
        RAISE EXCEPTION 'errorBars.multiplier must be a positive finite number' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;

  IF refs IS NOT NULL AND refs <> 'null'::jsonb THEN
    IF jsonb_typeof(refs) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'overlays.references must be an array when present' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(refs) > 12 THEN
      RAISE EXCEPTION 'overlays.references supports at most 12 entries' USING ERRCODE='23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(refs) LOOP
      IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item->>'kind' IS NULL THEN
        RAISE EXCEPTION 'invalid reference overlay' USING ERRCODE='23514';
      END IF;
      IF item->>'kind' IN ('hline','vline') THEN
        IF jsonb_typeof(item->'value') IS DISTINCT FROM 'number'
           OR (item->>'value')::float8 IS NULL
           OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
           OR btrim(item->>'label')='' THEN
          RAISE EXCEPTION 'invalid reference overlay' USING ERRCODE='23514';
        END IF;
      ELSIF item->>'kind' = 'band' THEN
        IF item->>'axis' NOT IN ('x','y')
           OR jsonb_typeof(item->'lo') IS DISTINCT FROM 'number'
           OR jsonb_typeof(item->'hi') IS DISTINCT FROM 'number'
           OR (item->>'lo')::float8 IS NULL
           OR (item->>'hi')::float8 IS NULL
           OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
           OR btrim(item->>'label')='' THEN
          RAISE EXCEPTION 'invalid reference overlay' USING ERRCODE='23514';
        END IF;
      ELSIF item->>'kind' = 'identity' THEN
        IF item ? 'label' AND jsonb_typeof(item->'label') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'invalid reference overlay' USING ERRCODE='23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid reference overlay' USING ERRCODE='23514';
      END IF;
    END LOOP;
  END IF;

  IF params ? 'bar' AND ctype NOT IN ('bar','grouped_bar','stacked_bar') THEN
    RAISE EXCEPTION 'typeParams.bar only applies to bar charts' USING ERRCODE='23514';
  END IF;
  IF params ? 'strip' AND ctype <> 'strip' THEN
    RAISE EXCEPTION 'typeParams.strip only applies to strip charts' USING ERRCODE='23514';
  END IF;
  IF params ? 'summary' AND ctype <> 'summary' THEN
    RAISE EXCEPTION 'typeParams.summary only applies to summary charts' USING ERRCODE='23514';
  END IF;

  IF jsonb_typeof(params->'bar') = 'object'
     AND params->'bar' ? 'stacking'
     AND (params->'bar')->>'stacking' NOT IN ('grouped','stacked') THEN
    RAISE EXCEPTION 'invalid bar stacking' USING ERRCODE='23514';
  END IF;

  IF jsonb_typeof(params->'strip') = 'object' AND params->'strip' ? 'jitter' THEN
    IF jsonb_typeof(params#>'{strip,jitter}') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'strip jitter must be between 0 and 1' USING ERRCODE='23514';
    END IF;
    jitter := (params#>>'{strip,jitter}')::float8;
    IF jitter IS NULL OR jitter < 0 OR jitter > 1
       OR jitter = 'NaN'::float8 OR jitter = 'Infinity'::float8
       OR jitter = '-Infinity'::float8 THEN
      RAISE EXCEPTION 'strip jitter must be between 0 and 1' USING ERRCODE='23514';
    END IF;
  END IF;

  IF jsonb_typeof(params->'summary') = 'object'
     AND params->'summary' ? 'statistic'
     AND (params->'summary')->>'statistic' NOT IN ('mean','median') THEN
    RAISE EXCEPTION 'invalid summary statistic' USING ERRCODE='23514';
  END IF;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."validate_chart_spec_maturity"(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."validate_chart_spec_maturity"(jsonb) TO authenticated, migrator;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
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
      -- Format and dimensions: 96_well = 8×12 initially.
      IF pm_format IS NULL OR pm_format NOT IN ('96_well') THEN
        RAISE EXCEPTION 'unsupported plate format' USING ERRCODE='23514';
      END IF;
      pm_rows := NULLIF(pm_spec->>'rows','')::int;
      pm_cols := NULLIF(pm_spec->>'cols','')::int;
      IF pm_format='96_well' AND (pm_rows IS NULL OR pm_rows<>8 OR pm_cols IS NULL OR pm_cols<>12) THEN
        RAISE EXCEPTION 'invalid plate dimensions for 96_well (expected 8×12)' USING ERRCODE='23514';
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
        IF pm_well_code IS NULL OR pm_well_code !~ '^[A-H][1-9][0-9]?$' THEN
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
        pm_expected_code := chr(65 + pm_well_row) || (pm_well_col + 1)::text;
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

NOTIFY pgrst, 'reload schema';
