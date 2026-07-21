-- SCI-004: chart specification and chart block contract (decision 0029).
-- Extends validate_scientific_block for the `chart` block type with dataset
-- reference integrity and frozen-chart immutability, and adds the
-- transactional freeze_chart / unfreeze_chart lifecycle RPCs. No new tables,
-- record kinds or identity systems; chart blocks reuse the existing blocks
-- RLS, change events, audit attribution and revision snapshots.

-- ---------------------------------------------------------------------------
-- 1. Extend validate_scientific_block for the chart block payload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text;
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
      IF ctype IS NULL OR ctype NOT IN ('line','scatter','bar') THEN
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

-- ---------------------------------------------------------------------------
-- 2. freeze_chart — transactionally materialise the chart's dataset into an
-- immutable frozen payload. SECURITY DEFINER so the trigger accepts the
-- frozen-write transition (direct authenticated/api_client CRUD is rejected
-- by validate_scientific_block). RLS would be bypassed under the DEFINER
-- owner, so the function re-validates workspace membership against the JWT
-- claim before any write. Bumps blocks.version and emits the standard
-- block.update change event via the existing trigger.
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

  v_idx := 0;
  FOREACH v_key IN ARRAY v_order LOOP
    v_idx := v_idx + 1;
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

  v_frozen := jsonb_build_object(
    'revisionId', 'null'::jsonb,
    'frozenAt', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'frozenByUserId', to_jsonb("api"."current_user_id"()),
    'datasetProvenance', v_provenance,
    'data', jsonb_build_object(
      'columns', v_col_meta,
      'rows', v_filtered,
      'series', v_series_arr
    )
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

-- ---------------------------------------------------------------------------
-- 3. unfreeze_chart — remove the frozen payload so a chart can be edited
-- again. Only allowed when the freeze is not yet tied to a submitted revision
-- (frozen.revisionId is null). The trigger permits the frozen->null transition
-- when the rest of the payload is byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."unfreeze_chart"(
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
  v_frozen jsonb;
  v_payload jsonb;
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
  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL
     OR v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_member"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_frozen := v_block.payload->'frozen';
  IF jsonb_typeof(v_frozen) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'chart is not frozen' USING ERRCODE = '23514';
  END IF;
  -- A freeze tied to a revision is evidence and must not be undone.
  IF v_frozen->>'revisionId' IS NOT NULL THEN
    RAISE EXCEPTION 'frozen chart is tied to a revision' USING ERRCODE = '23514';
  END IF;
  -- Remove the frozen key entirely so validate_scientific_block sees
  -- payload->'frozen' IS NULL (a missing key, not a JSON null scalar).
  v_payload := v_block.payload - 'frozen';
  UPDATE "api"."blocks"
    SET payload = v_payload,
        version = v_block.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_block;
  RETURN v_block;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."unfreeze_chart"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."unfreeze_chart"(uuid, int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3b. bind_chart_revision -- pin a frozen chart to a submitted revision. The
-- only reachable transition for frozen.revisionId; validates the revision
-- belongs to the same record and workspace as the chart block.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."bind_chart_revision"(
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
  IF v_block.type <> 'chart' THEN
    RAISE EXCEPTION 'block is not a chart' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  v_frozen := v_block.payload->'frozen';
  IF jsonb_typeof(v_frozen) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'chart is not frozen' USING ERRCODE = '23514';
  END IF;
  IF v_frozen->>'revisionId' IS NOT NULL THEN
    RAISE EXCEPTION 'chart is already bound to a revision' USING ERRCODE = '23514';
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
REVOKE EXECUTE ON FUNCTION "api"."bind_chart_revision"(uuid, uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."bind_chart_revision"(uuid, uuid, int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Pure helpers used by freeze_chart. IMMUTABLE so they can be referenced in
-- the materialisation loop without side effects.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."chart_to_number"(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  BEGIN
    RETURN p_value::numeric;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_to_number"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_to_number"(text) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."chart_filter_matches"(
  p_row jsonb,
  p_filter jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_field text := p_filter->>'fieldName';
  v_op text := p_filter->>'op';
  v_value jsonb := p_filter->'value';
  v_cell jsonb := p_row->v_field;
  v_num numeric;
  v_arg numeric;
  v_arg2 numeric;
BEGIN
  IF v_field IS NULL OR v_op IS NULL THEN RETURN false; END IF;
  v_num := "api"."chart_to_number"(v_cell #>> '{}');
  CASE v_op
    WHEN 'eq' THEN RETURN v_cell = v_value;
    WHEN 'ne' THEN RETURN v_cell IS DISTINCT FROM v_value;
    WHEN 'gt' THEN
      v_arg := "api"."chart_to_number"(v_value #>> '{}');
      RETURN v_num IS NOT NULL AND v_arg IS NOT NULL AND v_num > v_arg;
    WHEN 'gte' THEN
      v_arg := "api"."chart_to_number"(v_value #>> '{}');
      RETURN v_num IS NOT NULL AND v_arg IS NOT NULL AND v_num >= v_arg;
    WHEN 'lt' THEN
      v_arg := "api"."chart_to_number"(v_value #>> '{}');
      RETURN v_num IS NOT NULL AND v_arg IS NOT NULL AND v_num < v_arg;
    WHEN 'lte' THEN
      v_arg := "api"."chart_to_number"(v_value #>> '{}');
      RETURN v_num IS NOT NULL AND v_arg IS NOT NULL AND v_num <= v_arg;
    WHEN 'in' THEN
      RETURN jsonb_typeof(v_value) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_value) el WHERE el = v_cell
      );
    WHEN 'between' THEN
      IF jsonb_typeof(v_value) IS DISTINCT FROM 'array' OR jsonb_array_length(v_value) <> 2 THEN
        RETURN false;
      END IF;
      v_arg := "api"."chart_to_number"(v_value->0 #>> '{}');
      v_arg2 := "api"."chart_to_number"(v_value->1 #>> '{}');
      RETURN v_num IS NOT NULL AND v_arg IS NOT NULL AND v_arg2 IS NOT NULL
        AND v_num >= v_arg AND v_num <= v_arg2;
    ELSE RETURN false;
  END CASE;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_filter_matches"(jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_filter_matches"(jsonb, jsonb) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';--> statement-breakpoint
