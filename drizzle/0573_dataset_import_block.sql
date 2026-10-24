-- Notebook import blocks reference the existing upload and commit receipt.
ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type;
--> statement-breakpoint
ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type CHECK (type IN (
  'rich_text', 'checklist', 'linked_record', 'callout', 'table', 'sheet',
  'chart', 'analysis', 'plate_map', 'file', 'metric', 'procedure_step',
  'protocol_reference', 'materials', 'pipeline_output', 'signature_request',
  'corrective_actions', 'conclusion', 'dataset_import'
));
--> statement-breakpoint
CREATE FUNCTION internal.validate_dataset_import_block(p_payload jsonb, p_workspace uuid, p_complete boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE key text; uploaded boolean; committed boolean; file api.dataset_import_files;
  receipt api.dataset_imports; version api.dataset_versions;
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'import payload must be an object' USING ERRCODE='23514';
  END IF;
  uploaded := p_payload ?| ARRAY['fileId','datasetId'];
  committed := p_payload ?| ARRAY['importId','datasetVersionId'];
  IF p_complete AND NOT committed THEN
    RAISE EXCEPTION 'Complete or remove the pending import before submission' USING ERRCODE='23514';
  END IF;
  FOREACH key IN ARRAY ARRAY['fileId','datasetId','importId','datasetVersionId'] LOOP
    IF (key IN ('fileId','datasetId') AND (uploaded OR committed)) OR
       (key IN ('importId','datasetVersionId') AND committed) THEN
      IF jsonb_typeof(p_payload->key) IS DISTINCT FROM 'string' OR
         coalesce(p_payload->>key,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'import % must be a UUID', key USING ERRCODE='23514';
      END IF;
    END IF;
  END LOOP;
  IF p_payload ? 'sheetName' AND (NOT uploaded OR jsonb_typeof(p_payload->'sheetName') IS DISTINCT FROM 'string') THEN
    RAISE EXCEPTION 'sheetName requires upload pins and must be a string' USING ERRCODE='23514';
  END IF;
  IF p_payload ? 'search' THEN
    IF committed OR jsonb_typeof(p_payload->'search') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'search is draft import state only' USING ERRCODE='23514';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(p_payload->'search') s
      WHERE s.key NOT IN ('step','parser','map','sheet','units','instrument') OR jsonb_typeof(s.value)<>'string'
        OR (s.key='step' AND s.value #>> '{}' NOT IN ('map','check'))) THEN
      RAISE EXCEPTION 'invalid draft import search options' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NOT uploaded AND NOT committed THEN RETURN; END IF;
  IF p_workspace IS DISTINCT FROM api.current_workspace_id() OR NOT api.is_workspace_member(p_workspace) THEN
    RAISE EXCEPTION 'import workspace denied' USING ERRCODE='42501';
  END IF;
  PERFORM internal.assert_object_access('dataset',(p_payload->>'datasetId')::uuid,'view');
  PERFORM internal.assert_object_access('import_file',(p_payload->>'fileId')::uuid,'view');
  SELECT * INTO file FROM api.dataset_import_files WHERE id=(p_payload->>'fileId')::uuid;
  IF file.workspace_id IS DISTINCT FROM p_workspace OR NOT EXISTS (
    SELECT 1 FROM api.datasets WHERE id=(p_payload->>'datasetId')::uuid AND workspace_id=p_workspace
  ) OR (NOT committed AND file.dataset_id IS NOT NULL AND file.dataset_id<>(p_payload->>'datasetId')::uuid) THEN
    RAISE EXCEPTION 'import upload does not match Dataset' USING ERRCODE='23514';
  END IF;
  IF NOT committed THEN RETURN; END IF;
  SELECT * INTO receipt FROM api.dataset_imports WHERE id=(p_payload->>'importId')::uuid;
  SELECT * INTO version FROM api.dataset_versions WHERE id=(p_payload->>'datasetVersionId')::uuid;
  IF receipt.workspace_id IS DISTINCT FROM p_workspace OR receipt.status IS DISTINCT FROM 'committed'
    OR receipt.file_id IS DISTINCT FROM file.id
    OR receipt.dataset_id IS DISTINCT FROM (p_payload->>'datasetId')::uuid
    OR receipt.snapshot_version_id IS DISTINCT FROM version.id
    OR version.dataset_id IS DISTINCT FROM receipt.dataset_id
    OR version.workspace_id IS DISTINCT FROM p_workspace
    OR EXISTS (SELECT 1 FROM api.dataset_version_prunes WHERE dataset_version_id=version.id)
    OR (p_payload ? 'sheetName' AND p_payload->>'sheetName' IS DISTINCT FROM receipt.mapping->>'sheetName') THEN
    RAISE EXCEPTION 'import receipt does not match file, Dataset, worksheet and snapshot' USING ERRCODE='23514';
  END IF;
  PERFORM internal.assert_object_access('dataset_version',version.id,'view');
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.validate_dataset_import_block(jsonb,uuid,boolean) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint
CREATE FUNCTION internal.check_dataset_import_block() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE workspace uuid;
BEGIN
  IF NEW.type='dataset_import' THEN
    IF NEW.payload_schema_version<>1 THEN RAISE EXCEPTION 'unsupported import payload version' USING ERRCODE='23514'; END IF;
    SELECT workspace_id INTO workspace FROM api.records WHERE id=NEW.record_id;
    PERFORM internal.validate_dataset_import_block(NEW.payload,workspace);
    -- Serialise new references with source deletion and the SKIP LOCKED
    -- snapshot pruner. Validate again after taking the source locks.
    PERFORM 1 FROM api.dataset_import_files WHERE id=(NEW.payload->>'fileId')::uuid FOR SHARE;
    PERFORM 1 FROM api.dataset_imports WHERE id=(NEW.payload->>'importId')::uuid FOR SHARE;
    PERFORM 1 FROM api.dataset_versions WHERE id=(NEW.payload->>'datasetVersionId')::uuid FOR SHARE;
    PERFORM internal.validate_dataset_import_block(NEW.payload,workspace);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_dataset_import_block() FROM PUBLIC,authenticated,api_client;
CREATE TRIGGER check_dataset_import_block BEFORE INSERT OR UPDATE ON api.blocks
FOR EACH ROW EXECUTE FUNCTION internal.check_dataset_import_block();
--> statement-breakpoint
-- The envelope is the submission/digest authority. Never turn a pending import
-- into an apparently complete revision by silently leaving out its evidence.
CREATE FUNCTION internal.notebook_import_evidence(p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE block api.blocks; workspace uuid; evidence jsonb := '[]';
BEGIN
  SELECT workspace_id INTO workspace FROM api.records WHERE id=p_record_id;
  FOR block IN SELECT * FROM api.blocks WHERE record_id=p_record_id AND type='dataset_import' ORDER BY "order",id LOOP
    PERFORM internal.validate_dataset_import_block(block.payload,workspace,true);
    evidence := evidence || (SELECT jsonb_build_array(jsonb_build_object(
      'blockId',block.id,'datasetId',receipt.dataset_id,'datasetVersionId',version.id,
      'fileId',file.id,'importId',receipt.id,'receipt',to_jsonb(receipt),
      'file',jsonb_build_object('id',file.id,'filename',file.filename,'format',file.format,
        'mediaType',file.media_type,'byteSize',file.byte_size,'checksum',file.checksum,'storageKey',file.storage_key),
      'version',to_jsonb(version),
      'fields',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.display_order,f.field_id),'[]'::jsonb)
        FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=version.schema_version_id)
    )) FROM api.dataset_imports receipt
    JOIN api.dataset_import_files file ON file.id=receipt.file_id
    JOIN api.dataset_versions version ON version.id=receipt.snapshot_version_id
    WHERE receipt.id=(block.payload->>'importId')::uuid);
  END LOOP;
  RETURN evidence;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notebook_import_evidence(uuid) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.build_revision_envelope(p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN internal.build_revision_envelope_without_sheet_evidence(p_record_id) || jsonb_build_object(
    'sheetEvidence',internal.notebook_sheet_evidence(p_record_id),
    'instruments',internal.record_instrument_evidence(p_record_id),
    'importEvidence',internal.notebook_import_evidence(p_record_id));
END $$;
--> statement-breakpoint
-- Retain the canonical source, not another copy of import storage. Live block
-- pins and frozen revision pins both prevent deletion or identity replacement.
CREATE FUNCTION internal.import_block_references(p_key text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM api.blocks WHERE type='dataset_import' AND lower(payload->>p_key)=p_id::text)
    OR EXISTS (SELECT 1 FROM api.revisions r,
      LATERAL jsonb_array_elements(coalesce(r.canonical_snapshot->'importEvidence','[]'::jsonb)) e
      WHERE lower(e->>p_key)=p_id::text)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.import_block_references(text,uuid) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint
CREATE FUNCTION internal.protect_notebook_import_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF internal.import_block_references(CASE TG_TABLE_NAME WHEN 'dataset_imports' THEN 'importId' ELSE 'fileId' END,OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Notebook import evidence is retained' USING ERRCODE='23503'; END IF;
    IF TG_TABLE_NAME='dataset_imports' OR
       (to_jsonb(NEW)-ARRAY['dataset_id','status','parse_error','parser_failure','updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['dataset_id','status','parse_error','parser_failure','updated_at']) THEN
      RAISE EXCEPTION 'Notebook import evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.protect_notebook_import_source() FROM PUBLIC,authenticated,api_client;
CREATE TRIGGER protect_notebook_import_source BEFORE UPDATE OR DELETE ON api.dataset_import_files
FOR EACH ROW EXECUTE FUNCTION internal.protect_notebook_import_source();
CREATE TRIGGER protect_notebook_import_source BEFORE UPDATE OR DELETE ON api.dataset_imports
FOR EACH ROW EXECUTE FUNCTION internal.protect_notebook_import_source();
--> statement-breakpoint
-- A referenced snapshot must remain reconstructable, even before signing.
DO $$ DECLARE definition text; anchor text := 'AND d.archived_at IS NOT NULL';
BEGIN
  definition := pg_get_functiondef('api.prune_dataset_versions(integer)'::regprocedure);
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'snapshot pruning anchor missing'; END IF;
  EXECUTE replace(definition,anchor,anchor || E'\n AND NOT internal.import_block_references(''datasetVersionId'',v.id)');
END $$;
--> statement-breakpoint
DO $$ DECLARE definition text; anchor text := '  IF cited IS NOT NULL THEN';
BEGIN
  definition := pg_get_functiondef('api.dataset_version_retention(uuid)'::regprocedure);
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'snapshot retention anchor missing'; END IF;
  EXECUTE replace(definition,anchor,$guard$
  IF internal.import_block_references('datasetVersionId',v.id) THEN
    RETURN jsonb_build_object('reason','notebook_import_evidence','keptUntil',NULL);
  END IF;
$guard$ || anchor);
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
