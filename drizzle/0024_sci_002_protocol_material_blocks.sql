-- SCI-002: durable protocol pins, executable steps, and material observations.
ALTER TABLE "api"."blocks" DROP CONSTRAINT "chk_blocks_type";--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "chk_blocks_type" CHECK ("type" IN ('rich_text','checklist','linked_record','callout','table','sheet','chart','plate_map','file','metric','procedure_step','protocol_reference','materials'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials') THEN RETURN NEW; END IF;
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
CREATE TRIGGER validate_scientific_block BEFORE INSERT OR UPDATE ON api.blocks FOR EACH ROW EXECUTE FUNCTION api.validate_scientific_block();--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.guard_record_kind() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'record kind is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.guard_record_kind() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER guard_record_kind BEFORE UPDATE OF kind ON api.records
FOR EACH ROW EXECUTE FUNCTION internal.guard_record_kind();--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.pin_protocol_reference(p_block_id uuid,p_protocol_record_id uuid,p_expected_block_version int,p_expected_structure_version int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b api.blocks; exp api.records; prot api.records; r api.revisions; actor text:=api.current_user_id(); copied jsonb; step_count int; spacing int; block_count int; min_order real; max_order real; staging_offset real;
BEGIN
 SELECT * INTO b FROM api.blocks WHERE id=p_block_id FOR UPDATE;
 SELECT * INTO exp FROM api.records WHERE id=b.record_id FOR UPDATE;
 SELECT * INTO prot FROM api.records WHERE id=p_protocol_record_id FOR UPDATE;
 IF actor IS NULL OR b.id IS NULL OR exp.id IS NULL OR prot.id IS NULL
   OR exp.workspace_id IS DISTINCT FROM api.current_workspace_id() OR NOT api.is_workspace_member(exp.workspace_id)
   OR b.type<>'protocol_reference' OR b.payload<>'{}'::jsonb OR exp.kind<>'experiment' OR exp.deleted_at IS NOT NULL
   OR prot.kind<>'protocol_template' OR prot.deleted_at IS NOT NULL OR prot.workspace_id<>exp.workspace_id THEN RAISE EXCEPTION 'protocol pin rejected' USING ERRCODE='42501'; END IF;
 IF p_expected_block_version IS NULL OR b.version IS DISTINCT FROM p_expected_block_version THEN RAISE EXCEPTION 'block version mismatch' USING ERRCODE='SB001'; END IF;
 IF p_expected_structure_version IS NULL OR exp.structure_version IS DISTINCT FROM p_expected_structure_version THEN RAISE EXCEPTION 'structure version mismatch' USING ERRCODE='SB001'; END IF;
 INSERT INTO api.revisions(record_id,structure_version,metadata_version,metadata_snapshot,block_snapshot,reason,created_by_user_id)
 SELECT prot.id,prot.structure_version,prot.metadata_version,jsonb_build_object('id',prot.id,'identifier',prot.identifier,'title',prot.title,'status',prot.status,'properties',prot.properties,'tags',prot.tags,'metadataVersion',prot.metadata_version),
   COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x."order") FILTER(WHERE x.id IS NOT NULL),'[]'), 'manual',actor FROM api.blocks x WHERE x.record_id=prot.id RETURNING * INTO r;
 SELECT count(*)::int INTO step_count FROM jsonb_array_elements(r.block_snapshot) s WHERE s->>'type'='procedure_step';
 spacing := step_count + 1;
 UPDATE api.blocks SET payload=jsonb_build_object('protocolRecordId',prot.id,'protocolIdentifier',prot.identifier,'protocolTitle',prot.title,'protocolRevisionId',r.id,
   'version',COALESCE(prot.properties->>'version',prot.metadata_version::text),'approvalStatus',prot.status,'pinnedAt',r.created_at,'pinnedByUserId',actor),version=version+1,updated_by_user_id=actor WHERE id=b.id RETURNING * INTO b;
 -- Stage every existing order above both the old and final ranges, avoiding
 -- immediate unique-constraint collisions even for very sparse old orders.
 SELECT count(*)::int,min("order"),max("order") INTO block_count,min_order,max_order
 FROM api.blocks WHERE record_id=exp.id;
 staging_offset := greatest(max_order,block_count*spacing)-min_order+1;
 UPDATE api.blocks SET "order"="order"+staging_offset WHERE record_id=exp.id;
 WITH ordered AS (SELECT id,row_number() OVER(ORDER BY "order",id)*spacing AS n FROM api.blocks WHERE record_id=exp.id)
 UPDATE api.blocks x SET "order"=ordered.n FROM ordered WHERE x.id=ordered.id;
 WITH ins AS (INSERT INTO api.blocks(record_id,type,payload,payload_schema_version,"order",created_by_user_id)
   SELECT exp.id,'procedure_step', s->'payload' || jsonb_build_object('sourceProtocolRevisionId',r.id,'sourceStepBlockId',s->>'id','completed',false,'note','','completedAt',NULL,'completedByUserId',NULL),1,
     (SELECT "order" FROM api.blocks WHERE id=b.id)+row_number() OVER(ORDER BY (s->>'order')::real),actor
   FROM jsonb_array_elements(r.block_snapshot) s WHERE s->>'type'='procedure_step' RETURNING *)
 SELECT COALESCE(jsonb_agg(to_jsonb(ins) ORDER BY ins."order"),'[]') INTO copied FROM ins;
 INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
 VALUES(exp.id,prot.id,prot.kind,prot.identifier,'protocol',actor) ON CONFLICT(source_record_id,target_identifier,link_type) DO UPDATE SET target_record_id=EXCLUDED.target_record_id,target_kind=EXCLUDED.target_kind;
 UPDATE api.records SET structure_version=exp.structure_version+1,updated_by_user_id=actor WHERE id=exp.id;
 RETURN jsonb_build_object('block',to_jsonb(b),'revision',to_jsonb(r),'copied_steps',copied,'structure_version',exp.structure_version+1);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pin_protocol_reference(uuid,uuid,int,int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.pin_protocol_reference(uuid,uuid,int,int) TO authenticated;
