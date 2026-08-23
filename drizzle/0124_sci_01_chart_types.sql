-- SCI-01: scientific chart types (histogram, box, heatmap), annotations,
-- faceting and type parameters.
--
-- Extends decision 0029 without rewriting its contract: the ChartSpec stays
-- a versioned JSONB object referenced to stable datasets; the new types add
-- type-specific parameters (`typeParams`) and optional annotations/facet
-- mappings that the application boundary validator and this trigger both
-- enforce. freeze_chart learns to materialise the aggregated series so a
-- frozen snapshot is byte-for-byte reproducible against the pure TypeScript
-- materialiser in src/lib/chart-spec.ts (same quantile rule: linear
-- interpolation on p·(n−1)).

-- ---------------------------------------------------------------------------
-- 1. Pure helpers shared by freeze_chart. IMMUTABLE, deterministic, and kept
-- numerically identical to the TypeScript implementations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."chart_quantile"(
  p_values double precision[],
  p_p double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_sorted double precision[];
  v_n int;
  v_h double precision;
  v_lo int;
  v_hi int;
BEGIN
  IF p_values IS NULL OR array_length(p_values, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(x ORDER BY x) INTO v_sorted FROM unnest(p_values) AS t(x);
  v_n := array_length(v_sorted, 1);
  v_h := (v_n - 1) * p_p;
  v_lo := floor(v_h)::int;
  v_hi := ceil(v_h)::int;
  RETURN v_sorted[v_lo + 1] + (v_sorted[v_hi + 1] - v_sorted[v_lo + 1]) * (v_h - v_lo);
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_quantile"(double precision[], double precision) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_quantile"(double precision[], double precision) TO authenticated;--> statement-breakpoint

-- Tukey five-number summary with 1.5×IQR fences (mirrors boxStats in
-- src/lib/chart-spec.ts). Returns null for an empty input.
CREATE OR REPLACE FUNCTION "api"."chart_box_stats"(p_values double precision[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_q1 double precision;
  v_median double precision;
  v_q3 double precision;
  v_iqr double precision;
  v_fence_lo double precision;
  v_fence_hi double precision;
  v_inliers double precision[];
  v_outliers double precision[];
  v_lo double precision;
  v_hi double precision;
BEGIN
  IF p_values IS NULL OR array_length(p_values, 1) IS NULL THEN
    RETURN NULL;
  END IF;
  v_q1 := "api"."chart_quantile"(p_values, 0.25);
  v_median := "api"."chart_quantile"(p_values, 0.5);
  v_q3 := "api"."chart_quantile"(p_values, 0.75);
  v_iqr := v_q3 - v_q1;
  v_fence_lo := v_q1 - 1.5 * v_iqr;
  v_fence_hi := v_q3 + 1.5 * v_iqr;
  SELECT array_agg(x ORDER BY x) FILTER (WHERE x >= v_fence_lo AND x <= v_fence_hi)
    INTO v_inliers
    FROM unnest(p_values) AS t(x)
     ;
  SELECT array_agg(x ORDER BY x) INTO v_outliers
    FROM unnest(p_values) AS t(x)
   WHERE x < v_fence_lo OR x > v_fence_hi;
  IF v_inliers IS NULL THEN
    SELECT min(x), max(x) INTO v_lo, v_hi FROM unnest(p_values) AS t(x);
  ELSE
    v_lo := v_inliers[1];
    v_hi := v_inliers[array_length(v_inliers, 1)];
  END IF;
  RETURN jsonb_build_object(
    'lo', v_lo,
    'q1', v_q1,
    'median', v_median,
    'q3', v_q3,
    'hi', v_hi,
    'outliers', COALESCE(to_jsonb(v_outliers), '[]'::jsonb),
    'n', array_length(p_values, 1)
  );
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_box_stats"(double precision[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_box_stats"(double precision[]) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. validate_scientific_block — extended chart rules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text; cparam_key text;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials','file','chart') THEN RETURN NEW; END IF;
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

-- Compact scientific label for binned dimensions (loose mirror of
-- formatScientific in src/lib/chart-spec.ts; labels are display-only).
CREATE OR REPLACE FUNCTION "api"."chart_dim_label"(p_value double precision)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_value IS NULL THEN
    RETURN '—';
  END IF;
  IF abs(p_value) >= 10000 OR abs(p_value) < 0.001 THEN
    RETURN btrim(to_char(p_value, '0.00EEEE'));
  END IF;
  IF p_value = trunc(p_value) THEN
    RETURN trunc(p_value)::text;
  END IF;
  RETURN btrim(trim_scale(p_value)::text);
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_dim_label"(double precision) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_dim_label"(double precision) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. freeze_chart — extended for histogram/box/heatmap materialisation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."freeze_chart"(
  p_block_id uuid,
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
  v_spec jsonb;
  v_payload jsonb;
  v_dataset jsonb;
  v_table "api"."scientific_tables";
  v_columns jsonb;
  v_col "api"."scientific_columns";
  v_rows jsonb := '[]'::jsonb;
  v_filtered jsonb := '[]'::jsonb;
  v_row jsonb;
  v_filters jsonb;
  v_filter jsonb;
  v_fields jsonb;
  v_series_field text;
  v_x_field text;
  v_y_field text;
  v_err_field text;
  v_key text;
  v_series_map jsonb := '{}'::jsonb;
  v_series_arr jsonb := '[]'::jsonb;
  v_point jsonb;
  v_order text[] := ARRAY[]::text[];
  v_rowcount int;
  v_checksum text;
  v_provenance jsonb := '[]'::jsonb;
  v_frozen jsonb;
  v_display_series jsonb;
  v_configured jsonb;
  v_color text;
  v_label text;
  v_idx int := 0;
  v_pal text[] := ARRAY['#006EDC','#00A659','#9B61EA','#00A3BB','#E8A200'];
  v_col_meta jsonb := '[]'::jsonb;
  v_keep_field text;
  v_keep_fields text[];
  v_row_obj jsonb;
  -- SCI-01 distribution/grid state.
  v_ctype text;
  v_num float8;
  v_vals double precision[];
  v_edges double precision[];
  v_nbins int;
  v_xlo float8;
  v_xhi float8;
  v_xstep float8;
  v_ylo float8;
  v_yhi float8;
  v_ystep float8;
  v_counts int[];
  v_points jsonb;
  v_stats jsonb;
  v_heatmap jsonb;
  v_cells jsonb;
  v_cellmap jsonb;
  v_cellkey text;
  v_agg text;
  v_value_field text;
  v_x_type text;
  v_y_type text;
  v_xlabels text[];
  v_ylabels text[];
  v_dims int;
  v_dims_y int;
  v_xi int;
  v_yi int;
  v_cell jsonb;
  v_hmin float8;
  v_hmax float8;
  v_value float8;
  v_data jsonb;
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'chart' THEN
    RAISE EXCEPTION 'block is not a chart' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  IF jsonb_typeof(v_block.payload->'frozen') = 'object' THEN
    RAISE EXCEPTION 'chart is already frozen' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_block.payload->'spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid chart spec' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503'; END IF;
  -- SECURITY DEFINER bypasses RLS; re validate the caller actually owns the
  -- block's workspace before materialising anything.
  IF v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_member"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;

  v_spec := v_block.payload->'spec';
  v_fields := v_spec->'fields';
  v_y_field := v_fields->'y'->>'fieldName';
  v_x_field := v_fields->'x'->>'fieldName';
  v_series_field := v_fields->'series'->>'fieldName';
  v_err_field := v_spec->'overlays'->'errorBars'->>'fieldName';

  -- SCI-004 supports a single dataset (the spec array is forward-compatible).
  v_dataset := v_spec->'datasets'->0;
  SELECT * INTO v_table FROM "api"."scientific_tables"
    WHERE id = (v_dataset->>'tableId')::uuid AND lifecycle = 'active';
  IF v_table.id IS NULL OR v_table.workspace_id <> v_owner.workspace_id THEN
    RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE = '23514';
  END IF;

  -- Active columns metadata, restricted to referenced fields for the frozen
  -- snapshot (keeps the payload lean and the tabular alternative honest).
  v_keep_fields := ARRAY_remove(ARRAY[
    v_x_field, v_y_field, v_series_field, v_err_field
  ]::text[], NULL);
  FOR v_col IN
    SELECT * FROM "api"."scientific_columns" c
      WHERE c.table_id = v_table.id AND c.lifecycle = 'active'
      ORDER BY c.display_order, c.id
  LOOP
    IF v_col.field_name = ANY(v_keep_fields) THEN
      v_col_meta := v_col_meta || jsonb_build_object(
        'columnId', v_col.id,
        'fieldName', v_col.field_name,
        'label', v_col.label,
        'unit', COALESCE(v_col.unit, 'null'::jsonb),
        'logicalType', v_col.logical_type
      );
    END IF;
  END LOOP;

  -- Read the dataset rows from the generated relation. RLS filters to the
  -- caller's workspace; the per-table CHECK pins a single workspace.
  v_filters := v_spec->'filters';
  FOR v_row IN
    EXECUTE format('SELECT to_jsonb(r) FROM api.%I r ORDER BY r.created_at, r.id', v_table.resource_name)
  LOOP
    v_rows := v_rows || jsonb_build_array(v_row);
  END LOOP;

  -- Apply explicit row predicates (mirrors src/lib/chart-spec applyFilters).
  IF jsonb_typeof(v_filters) = 'array' AND jsonb_array_length(v_filters) > 0 THEN
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
      v_key := 'pass';
      FOR v_filter IN SELECT value FROM jsonb_array_elements(v_filters) LOOP
        IF NOT "api"."chart_filter_matches"(v_row, v_filter) THEN
          v_key := 'fail';
          EXIT;
        END IF;
      END LOOP;
      IF v_key = 'pass' THEN v_filtered := v_filtered || jsonb_build_array(v_row); END IF;
    END LOOP;
  ELSE
    v_filtered := v_rows;
  END IF;

  v_rowcount := jsonb_array_length(v_filtered);
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'empty dataset' USING ERRCODE = '23514';
  END IF;

  v_checksum := md5(v_filtered::text);

  -- SCI-01: faceted charts are a live-analysis feature for now; freezing one
  -- would need per-facet provenance, so refuse honestly instead.
  IF v_spec->'fields' ? 'facet'
     AND jsonb_typeof(v_spec->'fields'->'facet') = 'object' THEN
    RAISE EXCEPTION 'faceted charts cannot be frozen yet' USING ERRCODE='23514';
  END IF;
  v_ctype := v_spec->>'type';

  IF v_ctype = 'heatmap' THEN
    -- ------------------------------------------------------------------
    -- Heatmap: aggregate the filtered rows into an x/y grid. Categorical
    -- dimensions use their distinct COLLATE "C" sorted values; numeric
    -- dimensions are binned (default 10). Cell values follow the spec's
    -- aggregate over valueField; counts ignore it. Mirrors
    -- materialiseHeatmap in src/lib/chart-spec.ts.
    -- ------------------------------------------------------------------
    v_agg := COALESCE(v_spec#>>'{typeParams,heatmap,aggregate}', 'count');
    v_value_field := v_spec#>>'{typeParams,heatmap,valueField,fieldName}';
    IF v_agg <> 'count' AND COALESCE(v_value_field, '') = '' THEN
      RAISE EXCEPTION 'heatmap valueField is required when aggregating anything but counts'
        USING ERRCODE='23514';
    END IF;

    BEGIN
      SELECT c.logical_type INTO v_x_type FROM "api"."scientific_columns" c
        WHERE c.id=(v_spec#>>'{fields,x,columnId}')::uuid AND c.lifecycle='active';
      SELECT c.logical_type INTO v_y_type FROM "api"."scientific_columns" c
        WHERE c.id=(v_spec#>>'{fields,y,columnId}')::uuid AND c.lifecycle='active';
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE='23514';
    END;

    -- X dimension labels and binning range.
    IF COALESCE(v_x_type,'') IN ('category','text','boolean') THEN
      SELECT array_agg(k ORDER BY k COLLATE "C") INTO v_xlabels
        FROM (
          SELECT DISTINCT COALESCE(r->>(v_spec#>>'{fields,x,fieldName}'), '—') AS k
          FROM jsonb_array_elements(v_filtered) AS r
        ) t;
    ELSE
      v_nbins := COALESCE((v_spec#>>'{typeParams,heatmap,xBins}')::int, 10);
      v_xlo := NULL; v_xhi := NULL;
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,x,fieldName}'));
        IF v_num IS NOT NULL THEN
          IF v_xlo IS NULL OR v_num < v_xlo THEN v_xlo := v_num; END IF;
          IF v_xhi IS NULL OR v_num > v_xhi THEN v_xhi := v_num; END IF;
        END IF;
      END LOOP;
      IF v_xlo IS NULL THEN v_xlo := 0; v_xhi := 1; END IF;
      IF v_xlo = v_xhi THEN v_xlo := v_xlo - 0.5; v_xhi := v_xhi + 0.5; END IF;
      v_xstep := (v_xhi - v_xlo) / v_nbins;
      v_xlabels := ARRAY(SELECT "api"."chart_dim_label"(v_xlo + i * v_xstep)
                         FROM generate_series(0, v_nbins - 1) AS g(i));
    END IF;

    -- Y dimension labels and binning range.
    IF COALESCE(v_y_type,'') IN ('category','text','boolean') THEN
      SELECT array_agg(k ORDER BY k COLLATE "C") INTO v_ylabels
        FROM (
          SELECT DISTINCT COALESCE(r->>(v_spec#>>'{fields,y,fieldName}'), '—') AS k
          FROM jsonb_array_elements(v_filtered) AS r
        ) t;
    ELSE
      v_dims_y := COALESCE((v_spec#>>'{typeParams,heatmap,yBins}')::int, 10);
      v_ylo := NULL; v_yhi := NULL;
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,y,fieldName}'));
        IF v_num IS NOT NULL THEN
          IF v_ylo IS NULL OR v_num < v_ylo THEN v_ylo := v_num; END IF;
          IF v_yhi IS NULL OR v_num > v_yhi THEN v_yhi := v_num; END IF;
        END IF;
      END LOOP;
      IF v_ylo IS NULL THEN v_ylo := 0; v_yhi := 1; END IF;
      IF v_ylo = v_yhi THEN v_ylo := v_ylo - 0.5; v_yhi := v_yhi + 0.5; END IF;
      v_ystep := (v_yhi - v_ylo) / v_dims_y;
      v_ylabels := ARRAY(SELECT "api"."chart_dim_label"(v_ylo + i * v_ystep)
                         FROM generate_series(0, v_dims_y - 1) AS g(i));
    END IF;

    -- Accumulate cells keyed "xi,yi".
    v_cellmap := '{}'::jsonb;
    FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
      IF COALESCE(v_x_type,'') IN ('category','text','boolean') THEN
        SELECT i - 1 INTO v_xi FROM unnest(v_xlabels) WITH ORDINALITY AS u(k, i)
          WHERE k = COALESCE(v_row->>(v_spec#>>'{fields,x,fieldName}'), '—');
      ELSE
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,x,fieldName}'));
        v_xi := NULL;
        IF v_num IS NOT NULL THEN
          v_xi := floor((v_num - v_xlo) / v_xstep)::int;
          IF v_xi >= v_nbins THEN v_xi := v_nbins - 1; END IF;
          IF v_xi < 0 THEN v_xi := 0; END IF;
        END IF;
      END IF;
      CONTINUE WHEN v_xi IS NULL OR v_xi < 0;
      IF COALESCE(v_y_type,'') IN ('category','text','boolean') THEN
        SELECT i - 1 INTO v_yi FROM unnest(v_ylabels) WITH ORDINALITY AS u(k, i)
          WHERE k = COALESCE(v_row->>(v_spec#>>'{fields,y,fieldName}'), '—');
      ELSE
        v_num := "api"."chart_to_number"(v_row->>(v_spec#>>'{fields,y,fieldName}'));
        v_yi := NULL;
        IF v_num IS NOT NULL THEN
          v_yi := floor((v_num - v_ylo) / v_ystep)::int;
          IF v_yi >= v_dims_y THEN v_yi := v_dims_y - 1; END IF;
          IF v_yi < 0 THEN v_yi := 0; END IF;
        END IF;
      END IF;
      CONTINUE WHEN v_yi IS NULL OR v_yi < 0;
      v_cellkey := v_xi::text || ',' || v_yi::text;
      v_cell := COALESCE(v_cellmap->v_cellkey,
                         '{"sum":0,"n":0,"count":0,"values":[]}'::jsonb);
      v_cell := jsonb_set(v_cell, '{count}',
        to_jsonb((v_cell->>'count')::int + 1));
      IF v_value_field IS NOT NULL THEN
        v_num := "api"."chart_to_number"(v_row->>v_value_field);
        IF v_num IS NOT NULL THEN
          v_cell := jsonb_set(jsonb_set(v_cell, '{sum}',
            to_jsonb((v_cell->>'sum')::float8 + v_num)), '{n}',
            to_jsonb((v_cell->>'n')::int + 1));
          v_cell := jsonb_set(v_cell, '{values}',
            (v_cell->'values') || to_jsonb(v_num));
        END IF;
      END IF;
      v_cellmap := jsonb_set(v_cellmap, ARRAY[v_cellkey], v_cell);
    END LOOP;

    -- Emit the grid row-major (x asc, y asc) like the client.
    v_dims := COALESCE(array_length(v_xlabels, 1), 0);
    v_dims_y := COALESCE(array_length(v_ylabels, 1), 0);
    v_cells := '[]'::jsonb;
    v_hmin := NULL; v_hmax := NULL;
    IF v_dims > 0 AND v_dims_y > 0 THEN
      FOR v_yi IN 0 .. v_dims_y - 1 LOOP
        FOR v_xi IN 0 .. v_dims - 1 LOOP
          v_cellkey := v_xi::text || ',' || v_yi::text;
          v_cell := v_cellmap->v_cellkey;
          v_value := NULL;
          IF v_agg = 'count' THEN
            v_value := COALESCE((v_cell->>'count')::float8, 0);
          ELSIF v_cell IS NOT NULL AND (v_cell->>'n')::int > 0 THEN
            IF v_agg = 'mean' THEN
              v_value := (v_cell->>'sum')::float8 / (v_cell->>'n')::int;
            ELSE
              v_vals := ARRAY(SELECT jsonb_array_elements_text(v_cell->'values')::float8);
              IF v_agg = 'median' THEN
                v_value := "api"."chart_quantile"(v_vals, 0.5);
              ELSIF v_agg = 'min' THEN
                SELECT min(x) INTO v_value FROM unnest(v_vals) AS t(x);
              ELSIF v_agg = 'max' THEN
                SELECT max(x) INTO v_value FROM unnest(v_vals) AS t(x);
              END IF;
            END IF;
          END IF;
          IF v_value IS NOT NULL THEN
            IF v_hmin IS NULL OR v_value < v_hmin THEN v_hmin := v_value; END IF;
            IF v_hmax IS NULL OR v_value > v_hmax THEN v_hmax := v_value; END IF;
          END IF;
          v_cells := v_cells || jsonb_build_object(
            'x', v_xi, 'y', v_yi, 'value', v_value,
            'count', COALESCE((v_cell->>'count')::int, 0));
        END LOOP;
      END LOOP;
    END IF;

    v_heatmap := jsonb_build_object(
      'xLabels', to_jsonb(v_xlabels),
      'yLabels', to_jsonb(v_ylabels),
      'cells', v_cells,
      'min', v_hmin,
      'max', v_hmax,
      'aggregate', v_agg
    );
    -- Heatmaps render no series.
    v_series_map := '{}'::jsonb;
    v_order := ARRAY[]::text[];
    v_series_arr := '[]'::jsonb;
  ELSE
    -- Build series groups in first-seen order.
  v_display_series := v_spec->'display'->'series';
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_filtered) LOOP
    v_key := CASE WHEN v_series_field IS NULL THEN 'all'
                  ELSE COALESCE(v_row->>v_series_field, '—') END;
    IF NOT (v_series_map ? v_key) THEN
      v_series_map := jsonb_set(v_series_map, ARRAY[v_key], '[]'::jsonb);
      v_order := array_append(v_order, v_key);
    END IF;
    v_point := jsonb_build_object(
      'x', "api"."chart_to_number"(v_row->>v_x_field),
      'y', "api"."chart_to_number"(v_row->>v_y_field),
      'yError', CASE WHEN v_err_field IS NULL THEN NULL::numeric
                     ELSE "api"."chart_to_number"(v_row->>v_err_field) END,
      'label', v_key
    );
    v_series_map := jsonb_set(
      v_series_map, ARRAY[v_key],
      (v_series_map->v_key) || jsonb_build_array(v_point)
    );
  END LOOP;

  -- SCI-01: histogram/box replace raw points with aggregated statistics.
  IF v_ctype = 'histogram' THEN
    -- Shared edges across all groups so overlaid distributions stay
    -- comparable (mirrors materialiseHistogram).
    v_vals := ARRAY[]::double precision[];
    FOREACH v_key IN ARRAY v_order LOOP
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_series_map->v_key) LOOP
        v_num := (v_row->>'y')::float8;
        IF v_num IS NOT NULL THEN v_vals := v_vals || v_num; END IF;
      END LOOP;
    END LOOP;
    IF v_vals IS NULL OR array_length(v_vals, 1) IS NULL THEN
      RAISE EXCEPTION 'empty dataset' USING ERRCODE='23514';
    END IF;
    SELECT min(x), max(x) INTO v_xlo, v_xhi FROM unnest(v_vals) AS t(x);
    v_num := COALESCE((v_spec#>>'{typeParams,histogram,binWidth}')::float8, 0);
    IF v_num > 0 THEN
      v_nbins := GREATEST(1, ceil((v_xhi - v_xlo) / v_num)::int);
      v_xhi := v_xhi + v_num * 0.0001;
    ELSE
      v_nbins := COALESCE((v_spec#>>'{typeParams,histogram,bins}')::int, 10);
    END IF;
    IF v_xlo = v_xhi THEN
      v_num := CASE WHEN abs(v_xlo) > 0 THEN abs(v_xlo) * 0.5 ELSE 0.5 END;
      v_xlo := v_xlo - v_num;
      v_xhi := v_xhi + v_num;
    END IF;
    v_xstep := (v_xhi - v_xlo) / v_nbins;
    v_edges := ARRAY(SELECT v_xlo + i * v_xstep
                     FROM generate_series(0, v_nbins) AS g(i));
    FOREACH v_key IN ARRAY v_order LOOP
      v_counts := ARRAY(SELECT 0 FROM generate_series(1, v_nbins));
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_series_map->v_key) LOOP
        v_num := (v_row->>'y')::float8;
        CONTINUE WHEN v_num IS NULL;
        v_xi := floor((v_num - v_xlo) / v_xstep)::int;
        IF v_xi >= v_nbins THEN v_xi := v_nbins - 1; END IF;
        IF v_xi < 0 THEN v_xi := 0; END IF;
        v_counts[v_xi + 1] := v_counts[v_xi + 1] + 1;
      END LOOP;
      v_points := '[]'::jsonb;
      FOR v_xi IN 1 .. v_nbins LOOP
        v_points := v_points || jsonb_build_object(
          'x', v_edges[v_xi], 'y', v_counts[v_xi], 'yError', NULL, 'label', v_key);
      END LOOP;
      v_series_map := jsonb_set(v_series_map, ARRAY[v_key], v_points);
    END LOOP;
  ELSIF v_ctype = 'box' THEN
    v_yi := 0;
    FOREACH v_key IN ARRAY v_order LOOP
      v_yi := v_yi + 1;
      v_vals := ARRAY(
        SELECT (p->>'y')::float8
          FROM jsonb_array_elements(v_series_map->v_key) AS p
         WHERE (p->>'y')::float8 IS NOT NULL);
      IF v_vals IS NULL OR array_length(v_vals, 1) IS NULL THEN
        v_series_map := jsonb_set(v_series_map, ARRAY[v_key], '[]'::jsonb);
      ELSE
        v_stats := "api"."chart_box_stats"(v_vals);
        v_series_map := jsonb_set(v_series_map, ARRAY[v_key],
          jsonb_build_array(jsonb_build_object(
            'x', v_yi,
            'y', v_stats->'median',
            'yError', NULL,
            'label', v_key,
            'box', v_stats
          )));
      END IF;
    END LOOP;
  END IF;

  v_idx := 0;
  FOREACH v_key IN ARRAY v_order LOOP
    v_idx := v_idx + 1;
    IF v_ctype = 'box'
       AND jsonb_typeof(v_series_map->v_key) = 'array'
       AND jsonb_array_length(v_series_map->v_key) = 0 THEN
      CONTINUE;
    END IF;
    v_configured := NULL;
    IF jsonb_typeof(v_display_series) = 'array' THEN
      FOR v_row IN SELECT value FROM jsonb_array_elements(v_display_series) LOOP
        IF v_row->>'identifier' = v_key THEN v_configured := v_row; EXIT; END IF;
      END LOOP;
    END IF;
    v_color := COALESCE(lower(v_configured->>'color'), lower(v_pal[v_idx]));
    v_label := COALESCE(v_configured->>'label', v_key);
    v_series_arr := v_series_arr || jsonb_build_array(jsonb_build_object(
      'identifier', v_key,
      'label', v_label,
      'color', v_color,
      'points', v_series_map->v_key
    ));
  END LOOP;

  v_provenance := jsonb_build_array(jsonb_build_object(
    'tableId', v_table.id,
    'schemaVersion', v_table.schema_version,
    'rowCount', v_rowcount,
    'checksum', v_checksum
  ));

  -- Close the heatmap/cartesian branch; provenance and the frozen payload
  -- are common.
  END IF;

  v_data := jsonb_build_object(
    'columns', v_col_meta,
    'rows', v_filtered,
    'series', v_series_arr
  );
  IF v_heatmap IS NOT NULL THEN
    v_data := jsonb_set(v_data, '{heatmap}', v_heatmap);
  END IF;
  IF v_ctype = 'histogram' AND v_edges IS NOT NULL THEN
    v_data := jsonb_set(v_data, '{bins}',
      jsonb_build_object('edges', to_jsonb(v_edges)));
  END IF;

  v_frozen := jsonb_build_object(
    'revisionId', 'null'::jsonb,
    'frozenAt', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'frozenByUserId', to_jsonb("api"."current_user_id"()),
    'datasetProvenance', v_provenance,
    'data', v_data
  );

  v_payload := jsonb_set(v_block.payload, ARRAY['frozen'], v_frozen);

  UPDATE "api"."blocks"
    SET payload = v_payload,
        version = v_block.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_block;

  RETURN v_block;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';--> statement-breakpoint
