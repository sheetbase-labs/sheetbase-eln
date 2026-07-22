-- SCI-005: plate map block contract (decision 0030).
-- Extends validate_scientific_block for the `plate_map` block type with
-- structural validation, well-code/dimension checks, duplicate-well detection,
-- sample reference integrity, and deduplicated record-link creation. No new
-- tables, record kinds, RPCs or identity systems; plate_map blocks reuse the
-- existing blocks RLS, change events, audit attribution and revision
-- snapshots. Atomicity is provided by the single-JSONB-payload update_block
-- payload RPC — no bulk-layout RPC is needed.

-- ---------------------------------------------------------------------------
-- 1. Extend validate_scientific_block for the plate_map block payload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text;
  -- plate_map locals
  pm_spec jsonb; pm_wells jsonb; pm_well jsonb; pm_code text; pm_row int; pm_col int;
  pm_seen jsonb; pm_sref jsonb; pm_vol jsonb;
  pm_target api.records;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials','file','chart','plate_map') THEN RETURN NEW; END IF;
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
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF current_user='api_client' THEN
      RAISE EXCEPTION 'credential-authored chart writes are not supported' USING ERRCODE='42501';
    END IF;
    IF TG_OP='UPDATE' AND NEW.type='chart'
       AND jsonb_typeof(OLD.payload->'frozen')='object' THEN
      IF (OLD.payload->'frozen') IS DISTINCT FROM (NEW.payload->'frozen') THEN
        IF current_user IN ('authenticated','api_client') THEN
          RAISE EXCEPTION 'frozen chart mutations require freeze_chart/unfreeze_chart/bind_chart_revision'
            USING ERRCODE='42501';
        END IF;
        IF jsonb_typeof(NEW.payload->'frozen') IS DISTINCT FROM 'object'
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[]) THEN
          RETURN NEW;
        END IF;
        IF jsonb_typeof(NEW.payload->'frozen')='object'
           AND OLD.payload->'frozen'->>'revisionId' IS NULL
           AND NEW.payload->'frozen'->>'revisionId' IS NOT NULL
           AND (NEW.payload #- ARRAY['frozen']::text[]) IS NOT DISTINCT FROM (OLD.payload #- ARRAY['frozen']::text[])
           AND (NEW.payload->'frozen' #- ARRAY['revisionId']::text[]) IS NOT DISTINCT FROM (OLD.payload->'frozen' #- ARRAY['revisionId']::text[]) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'frozen chart is immutable' USING ERRCODE='23514';
      ELSIF NEW.payload IS DISTINCT FROM OLD.payload THEN
        RAISE EXCEPTION 'frozen chart is immutable' USING ERRCODE='23514';
      END IF;
    END IF;
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
      cseries := spec->'display'->'series';
      IF jsonb_typeof(cseries)='array' THEN
        FOR citem IN SELECT value FROM jsonb_array_elements(cseries) LOOP
          IF lower(citem->>'color') NOT IN
             ('#006edc','#00a659','#9b61ea','#00a3bb','#e8a200') THEN
            RAISE EXCEPTION 'chart series color must be from the approved palette' USING ERRCODE='23514';
          END IF;
        END LOOP;
      END IF;
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
      ceb := spec->'overlays'->'errorBars';
      IF ceb IS NOT NULL AND jsonb_typeof(ceb)='object' THEN
        IF ceb->>'columnId' IS NULL OR ceb->>'fieldName' IS NULL
           OR ceb->>'basis' IS NULL
           OR ceb->>'basis' NOT IN ('sd','se','range','custom') THEN
          RAISE EXCEPTION 'invalid error bar overlay' USING ERRCODE='23514';
        END IF;
      END IF;
    END chart_spec;
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
REVOKE EXECUTE ON FUNCTION "api"."validate_scientific_block"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."validate_scientific_block"() TO authenticated;--> statement-breakpoint

-- Notify PostgREST to reload schema cache.
SELECT pg_notify('pgrst','reload schema');--> statement-breakpoint
