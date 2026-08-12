-- MODEL-FIELDS-001: workspace-defined fields shared by the supported models.

CREATE TABLE api.model_kinds (
  key text PRIMARY KEY,
  label text NOT NULL,
  identity_table text NOT NULL,
  custom_field_strategy text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  record_kind text
);
--> statement-breakpoint
CREATE TABLE api.model_base_fields (
  model_key text NOT NULL REFERENCES api.model_kinds(key) ON DELETE cascade,
  field_key text NOT NULL,
  label text NOT NULL,
  presentation jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(model_key,field_key)
);
--> statement-breakpoint
CREATE TABLE api.model_field_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES api.record_field_definitions(id) ON DELETE cascade,
  key text NOT NULL,
  label text NOT NULL,
  display_order integer NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(definition_id,key)
);
--> statement-breakpoint

INSERT INTO api.model_kinds(key,label,identity_table,custom_field_strategy,record_kind) VALUES
 ('project','Project','api.projects','column',NULL), ('study','Study','api.records','record_kind','study'),
 ('experiment','Experiment','api.records','record_kind','experiment'), ('sample','Sample','api.records','record_kind','sample'),
 ('reagent','Reagent','api.records','record_kind','reagent'), ('protocol_template','Protocol template','api.records','record_kind','protocol_template'),
 ('notebook_template','Notebook template','api.records','record_kind','notebook_template'), ('file','File','api.records','record_kind','file'),
 ('dataset_schema','Dataset schema','api.dataset_schemas','column',NULL), ('scientific_table','Scientific table','api.scientific_tables','column',NULL),
 ('plate_design','Plate design','api.plate_designs','column',NULL), ('instrument','Instrument','api.instruments','column',NULL),
 ('instrument_run','Instrument run','api.instrument_runs','column',NULL), ('report','Report','api.records','record_kind','report');
--> statement-breakpoint

-- Explicit reviewed system/domain vocabulary. Both physical snake_case and
-- existing wire camelCase aliases are protected; this list never depends on
-- the database server's information_schema.
INSERT INTO api.model_base_fields(model_key,field_key,label,presentation)
SELECT m.key, f.key, initcap(replace(f.key,'_',' ')), '{"protected":true}'::jsonb
FROM api.model_kinds m CROSS JOIN unnest(ARRAY[
 'id','workspace_id','workspaceId','project_id','projectId','folder_id','folderId','record_id','recordId','block_id','blockId',
 'kind','key','identifier','title','name','description','status','lifecycle','properties','tags','custom_fields','customFields',
 'metadata_version','metadataVersion','structure_version','structureVersion','created_at','createdAt','updated_at','updatedAt',
 'archived_at','archivedAt','deleted_at','deletedAt','created_by_user_id','createdByUserId','updated_by_user_id','updatedByUserId',
 'format','rows','cols','validation','instrument_id','instrumentId','instrument_type','instrumentType','model','serial_number','serialNumber',
 'vendor','connection_status','connectionStatus','last_connected_at','lastConnectedAt','config','position','run_identifier','runIdentifier',
 'protocol_name','protocolName','progress_percent','progressPercent','plate_format','plateFormat','started_at','startedAt','completed_at','completedAt',
 'estimated_duration_seconds','estimatedDurationSeconds','elapsed_seconds','elapsedSeconds','operator','error_message','errorMessage','queue_position','queuePosition',
 'slug','revision','resource_name','resourceName','display_settings','displaySettings','schema_version','schemaVersion',
 'created_by_credential_id','createdByCredentialId','updated_by_credential_id','updatedByCredentialId'
]) f(key);
--> statement-breakpoint
INSERT INTO api.model_base_fields(model_key,field_key,label,presentation) VALUES
 ('experiment','overview','Overview','{"protected":true}'),
 ('sample','quantity','Quantity','{"protected":true}'),
 ('sample','quantity_unit','Quantity unit','{"protected":true}'),
 ('sample','quantityUnit','Quantity unit','{"protected":true}'),
 ('sample','storage_location','Storage location','{"protected":true}'),
 ('sample','storageLocation','Storage location','{"protected":true}'),
 ('sample','barcode','Barcode','{"protected":true}'),
 ('sample','sampleType','Sample type','{"protected":true}'),
 ('sample','sample_type','Sample type','{"protected":true}'),
 ('sample','lowStockThreshold','Low-stock threshold','{"protected":true}'),
 ('sample','low_stock_threshold','Low-stock threshold','{"protected":true}'),
 ('sample','expiryDate','Expiry date','{"protected":true}'),
 ('sample','expiry_date','Expiry date','{"protected":true}'),
 ('sample','notes','Notes','{"protected":true}'),
 ('reagent','quantity','Quantity','{"protected":true}'),
 ('reagent','quantity_unit','Quantity unit','{"protected":true}'),
 ('reagent','quantityUnit','Quantity unit','{"protected":true}'),
 ('reagent','unit','Unit','{"protected":true}'),
 ('reagent','supplier','Supplier','{"protected":true}'),
 ('reagent','catalog_no','Catalogue number','{"protected":true}'),
 ('reagent','catalogNo','Catalogue number','{"protected":true}'),
 ('reagent','lot','Lot','{"protected":true}'),
 ('reagent','expiry','Expiry','{"protected":true}'),
 ('reagent','low_stock_threshold','Low-stock threshold','{"protected":true}'),
 ('reagent','lowStockThreshold','Low-stock threshold','{"protected":true}'),
 ('reagent','expiry_warning_days','Expiry warning days','{"protected":true}'),
 ('reagent','expiryWarningDays','Expiry warning days','{"protected":true}'),
 ('reagent','storage','Storage','{"protected":true}'),
 ('protocol_template','version','Version','{"protected":true}'),
 ('file','storage_key','Storage key','{"protected":true}'),
 ('file','storageKey','Storage key','{"protected":true}'),
 ('file','checksum','Checksum','{"protected":true}'),
 ('file','checksum_algorithm','Checksum algorithm','{"protected":true}'),
 ('file','checksumAlgorithm','Checksum algorithm','{"protected":true}'),
 ('file','byte_size','Byte size','{"protected":true}'),
 ('file','byteSize','Byte size','{"protected":true}'),
 ('file','media_type','Media type','{"protected":true}'),
 ('file','mediaType','Media type','{"protected":true}'),
 ('file','storage_backend','Storage backend','{"protected":true}'),
 ('file','storageBackend','Storage backend','{"protected":true}');
-- The complete registry above is the collision authority. `editor=true`
-- identifies the reviewed base fields shown alongside workspace fields in
-- the administrator editor; aliases and low-level implementation columns stay
-- protected without overwhelming that presentation.
UPDATE api.model_base_fields b
SET presentation=presentation||'{"editor":true}'::jsonb,
    label=regexp_replace(upper(left(b.label,1))||lower(substr(b.label,2)),' id$',' ID')
FROM (VALUES
 ('project','key'),('project','title'),('project','status'),('project','archived_at'),
 ('study','identifier'),('study','title'),('study','status'),('study','project_id'),('study','archived_at'),
 ('experiment','identifier'),('experiment','title'),('experiment','status'),('experiment','project_id'),('experiment','tags'),('experiment','archived_at'),
 ('sample','identifier'),('sample','title'),('sample','status'),('sample','project_id'),('sample','sampleType'),('sample','quantity'),('sample','quantityUnit'),('sample','storageLocation'),('sample','barcode'),('sample','lowStockThreshold'),('sample','notes'),('sample','tags'),('sample','archived_at'),
 ('reagent','identifier'),('reagent','title'),('reagent','status'),('reagent','project_id'),('reagent','supplier'),('reagent','catalogNo'),('reagent','lot'),('reagent','expiry'),('reagent','quantity'),('reagent','unit'),('reagent','storage'),('reagent','tags'),('reagent','archived_at'),
 ('protocol_template','identifier'),('protocol_template','title'),('protocol_template','status'),('protocol_template','project_id'),('protocol_template','version'),('protocol_template','tags'),('protocol_template','archived_at'),
 ('notebook_template','identifier'),('notebook_template','title'),('notebook_template','status'),('notebook_template','project_id'),('notebook_template','tags'),('notebook_template','archived_at'),
 ('file','identifier'),('file','title'),('file','status'),('file','project_id'),('file','storage_key'),('file','checksum'),('file','byte_size'),('file','media_type'),('file','archived_at'),
 ('report','identifier'),('report','title'),('report','status'),('report','project_id'),('report','tags'),('report','archived_at'),
 ('dataset_schema','name'),('dataset_schema','description'),('dataset_schema','status'),('dataset_schema','revision'),
 ('scientific_table','name'),('scientific_table','lifecycle'),('scientific_table','schema_version'),
 ('plate_design','name'),('plate_design','description'),('plate_design','status'),('plate_design','plate_format'),
 ('instrument','name'),('instrument','instrument_type'),('instrument','model'),('instrument','serial_number'),('instrument','vendor'),('instrument','connection_status'),
 ('instrument_run','run_identifier'),('instrument_run','instrument_id'),('instrument_run','project_id'),('instrument_run','status'),('instrument_run','protocol_name'),('instrument_run','started_at'),('instrument_run','completed_at')
) visible(model_key,field_key)
WHERE b.model_key=visible.model_key AND b.field_key=visible.field_key;
--> statement-breakpoint

ALTER TABLE api.projects ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.records ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.plate_designs ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.instruments ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.instrument_runs ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.dataset_schemas ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE api.scientific_tables ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX idx_projects_custom_fields_gin ON api.projects USING gin(custom_fields);
CREATE INDEX idx_records_custom_fields_gin ON api.records USING gin(custom_fields);
CREATE INDEX idx_plate_designs_custom_fields_gin ON api.plate_designs USING gin(custom_fields);
CREATE INDEX idx_instruments_custom_fields_gin ON api.instruments USING gin(custom_fields);
CREATE INDEX idx_instrument_runs_custom_fields_gin ON api.instrument_runs USING gin(custom_fields);
CREATE INDEX idx_dataset_schemas_custom_fields_gin ON api.dataset_schemas USING gin(custom_fields);
CREATE INDEX idx_scientific_tables_custom_fields_gin ON api.scientific_tables USING gin(custom_fields);
--> statement-breakpoint

ALTER TABLE api.record_field_definitions DROP CONSTRAINT chk_record_field_definitions_kind;
ALTER TABLE api.record_field_definitions DROP CONSTRAINT chk_record_field_definitions_type;
ALTER TABLE api.record_field_definitions DROP CONSTRAINT chk_record_field_definitions_lifecycle;
UPDATE api.record_field_definitions SET kind=lower(regexp_replace(kind,'([a-z0-9])([A-Z])','\1_\2','g'));
DO $$
DECLARE incompatible uuid[];
BEGIN
 SELECT array_agg(id ORDER BY id) INTO incompatible FROM api.record_field_definitions
 WHERE field_name !~ '^[a-z][a-z0-9_]{0,62}$'
    OR length(btrim(label)) NOT BETWEEN 1 AND 200
    OR unit IS NOT NULL AND jsonb_typeof(unit)<>'object'
    OR jsonb_typeof(validation)<>'object'
    OR logical_type='category' AND validation ? 'enum' AND (
      jsonb_typeof(validation->'enum')<>'array'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(validation->'enum') item
        WHERE jsonb_typeof(item)<>'string' OR length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 200)
      OR (SELECT count(*) FROM jsonb_array_elements(validation->'enum'))
         <> (SELECT count(DISTINCT item#>>'{}') FROM jsonb_array_elements(validation->'enum') item)
    );
 IF incompatible IS NOT NULL THEN
   RAISE EXCEPTION 'model field definitions need manual compatibility review: %', incompatible USING ERRCODE='SB071';
 END IF;
END $$;
ALTER TABLE api.record_field_definitions
 ALTER COLUMN lifecycle SET DEFAULT 'draft',
 ADD CONSTRAINT record_field_definitions_kind_model_fk FOREIGN KEY(kind) REFERENCES api.model_kinds(key) ON DELETE restrict,
 ADD CONSTRAINT chk_record_field_definitions_type CHECK(logical_type IN ('text','integer','decimal','boolean','date','timestamp','category','reference')),
 ADD CONSTRAINT chk_record_field_definitions_lifecycle CHECK(lifecycle IN ('draft','backfilling','active','retired')),
 ADD CONSTRAINT chk_record_field_definitions_key CHECK(field_name ~ '^[a-z][a-z0-9_]{0,62}$'),
 ADD CONSTRAINT chk_record_field_definitions_label CHECK(length(btrim(label)) BETWEEN 1 AND 200),
 ADD CONSTRAINT chk_record_field_definitions_unit CHECK(unit IS NULL OR jsonb_typeof(unit)='object'),
 ADD CONSTRAINT chk_record_field_definitions_validation CHECK(jsonb_typeof(validation)='object');
UPDATE api.record_field_definitions SET lifecycle='retired'
 WHERE EXISTS (SELECT 1 FROM api.model_base_fields b WHERE b.model_key=kind AND b.field_key=field_name);
INSERT INTO api.model_field_options(definition_id,key,label,display_order)
SELECT d.id, option.value, initcap(replace(option.value,'_',' ')), option.ordinality::integer
FROM api.record_field_definitions d
CROSS JOIN LATERAL jsonb_array_elements_text(d.validation->'enum') WITH ORDINALITY option(value,ordinality)
WHERE d.logical_type='category' AND jsonb_typeof(d.validation->'enum')='array';
--> statement-breakpoint

-- Preserve properties exactly; migrate only values which were active and not
-- protected at migration time.
WITH migrated AS (
 SELECT r.id, jsonb_object_agg(d.field_name,r.properties->d.field_name) values
 FROM api.records r
 JOIN api.model_kinds m ON m.identity_table='api.records' AND m.record_kind=r.kind
 JOIN api.record_field_definitions d ON d.workspace_id=r.workspace_id AND d.kind=m.key
 WHERE d.lifecycle='active' AND r.properties ? d.field_name
   AND NOT EXISTS(SELECT 1 FROM api.model_base_fields b WHERE b.model_key=d.kind AND b.field_key=d.field_name)
 GROUP BY r.id
)
UPDATE api.records r SET custom_fields=r.custom_fields || migrated.values
FROM migrated WHERE migrated.id=r.id;
DO $$
DECLARE incompatible uuid[];
BEGIN
 SELECT array_agg(r.id ORDER BY r.id) INTO incompatible
 FROM api.records r JOIN api.record_field_definitions d
   ON d.workspace_id=r.workspace_id AND d.kind=r.kind
 WHERE d.lifecycle='active' AND NOT d.nullable
   AND NOT EXISTS(SELECT 1 FROM api.model_base_fields b WHERE b.model_key=d.kind AND b.field_key=d.field_name)
   AND (NOT r.custom_fields ? d.field_name OR r.custom_fields->d.field_name='null');
 IF incompatible IS NOT NULL THEN
   RAISE EXCEPTION 'required legacy model fields need manual compatibility review for records: %', incompatible USING ERRCODE='SB071';
 END IF;
END $$;
-- Definitions now govern custom_fields exclusively. Keeping this legacy
-- properties trigger would require the same value in two JSON documents.
DROP TRIGGER records_validate_properties ON api.records;
CREATE FUNCTION internal.guard_record_properties() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE property_key text;
BEGIN
  IF jsonb_typeof(NEW.properties)<>'object' THEN RAISE EXCEPTION 'properties must be an object' USING ERRCODE='22023'; END IF;
  FOR property_key IN SELECT jsonb_object_keys(NEW.properties) LOOP
    IF NOT EXISTS(SELECT 1 FROM api.model_base_fields b WHERE b.model_key=NEW.kind AND b.field_key=property_key)
       AND (TG_OP='INSERT' OR NOT OLD.properties?property_key OR OLD.properties->property_key IS DISTINCT FROM NEW.properties->property_key) THEN
      RAISE EXCEPTION 'unknown legacy property %; use custom_fields with an active definition',property_key USING ERRCODE='SB070';
    END IF;
  END LOOP;
  IF TG_OP='UPDATE' THEN
    FOR property_key IN SELECT jsonb_object_keys(OLD.properties) LOOP
      IF NOT EXISTS(SELECT 1 FROM api.model_base_fields b WHERE b.model_key=OLD.kind AND b.field_key=property_key)
         AND (NOT NEW.properties?property_key OR NEW.properties->property_key IS DISTINCT FROM OLD.properties->property_key) THEN
        RAISE EXCEPTION 'unknown legacy property % is preserved read-only',property_key USING ERRCODE='SB070';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER records_guard_legacy_properties BEFORE INSERT OR UPDATE OF properties,workspace_id,kind ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.guard_record_properties();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.is_model_field_admin(p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT api.current_workspace_id()=p_workspace AND EXISTS(SELECT 1 FROM api.workspace_memberships m
  WHERE m.workspace_id=p_workspace AND m.user_id=api.current_user_id() AND m.suspended_at IS NULL AND m.role IN ('owner','admin'))
$$;
REVOKE EXECUTE ON FUNCTION api.is_model_field_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.is_model_field_admin(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.model_key_for(p_table text,p_kind text DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$ SELECT key FROM api.model_kinds WHERE identity_table=p_table AND (record_kind=p_kind OR record_kind IS NULL AND p_kind IS NULL) $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_model_fields(p_workspace uuid,p_model text,p_new jsonb,p_old jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d record; k text; v jsonb; out jsonb:=coalesce(p_new,'{}'); target api.records;
BEGIN
 IF jsonb_typeof(out)<>'object' THEN RAISE EXCEPTION 'custom_fields must be an object' USING ERRCODE='22023'; END IF;
 FOR d IN SELECT * FROM api.record_field_definitions
   WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='retired' AND coalesce(p_old,'{}') ? field_name
 LOOP
   IF NOT out ? d.field_name OR out->d.field_name IS DISTINCT FROM p_old->d.field_name THEN
     RAISE EXCEPTION 'retired custom field % is immutable',d.field_name USING ERRCODE='SB070';
   END IF;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(out) LOOP
   IF EXISTS(SELECT 1 FROM api.model_base_fields WHERE model_key=p_model AND field_key=k) THEN RAISE EXCEPTION 'protected custom field: %',k USING ERRCODE='SB070'; END IF;
   SELECT * INTO d FROM api.record_field_definitions WHERE workspace_id=p_workspace AND kind=p_model AND field_name=k;
   IF NOT FOUND THEN RAISE EXCEPTION 'unknown custom field: %',k USING ERRCODE='SB070'; END IF;
   IF d.lifecycle NOT IN ('active','backfilling') THEN
     IF NOT coalesce(p_old,'{}') ? k OR p_old->k IS DISTINCT FROM out->k THEN RAISE EXCEPTION 'retired custom field: %',k USING ERRCODE='SB070'; END IF;
     CONTINUE;
   END IF;
   v:=out->k;
   IF v='null' AND NOT d.nullable THEN RAISE EXCEPTION 'field % may not be null',k USING ERRCODE='SB071'; END IF;
   IF v='null' THEN CONTINUE; END IF;
   IF (d.logical_type='text' AND jsonb_typeof(v)<>'string') OR
      (d.logical_type='integer' AND (jsonb_typeof(v)<>'number' OR (v#>>'{}') !~ '^-?[0-9]+$')) OR
      (d.logical_type='decimal' AND jsonb_typeof(v)<>'number') OR
      (d.logical_type='boolean' AND jsonb_typeof(v)<>'boolean') OR
      (d.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(v)<>'string') THEN
      RAISE EXCEPTION 'invalid % value for %',d.logical_type,k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='date' THEN BEGIN PERFORM (v#>>'{}')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid date' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='timestamp' THEN BEGIN PERFORM (v#>>'{}')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid timestamp' USING ERRCODE='SB071'; END; END IF;
   IF d.logical_type='text' AND ((d.validation ? 'minLength' AND length(v#>>'{}')<(d.validation->>'minLength')::integer) OR (d.validation ? 'maxLength' AND length(v#>>'{}')>(d.validation->>'maxLength')::integer) OR (d.validation ? 'regex' AND NOT (v#>>'{}' ~ (d.validation->>'regex')))) THEN RAISE EXCEPTION 'text validation failed for %',k USING ERRCODE='SB071'; END IF;
   IF d.logical_type IN ('integer','decimal') AND ((d.validation ? 'min' AND (v#>>'{}')::numeric<(d.validation->>'min')::numeric) OR (d.validation ? 'max' AND (v#>>'{}')::numeric>(d.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'numeric validation failed for %',k USING ERRCODE='SB071'; END IF;
   IF d.logical_type='category' AND NOT EXISTS(SELECT 1 FROM api.model_field_options o WHERE o.definition_id=d.id AND o.key=v#>>'{}' AND (o.lifecycle='active' OR p_old->k IS NOT DISTINCT FROM v)) THEN RAISE EXCEPTION 'inactive category option' USING ERRCODE='SB071'; END IF;
   IF d.logical_type='reference' THEN
     IF d.validation->>'targetModelKey' IS NULL THEN RAISE EXCEPTION 'reference targetModelKey required' USING ERRCODE='SB071'; END IF;
     BEGIN
       SELECT r.* INTO target FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind
        WHERE r.id=(v#>>'{}')::uuid AND r.workspace_id=p_workspace AND m.key=d.validation->>'targetModelKey'
          AND (r.deleted_at IS NULL OR p_old->k IS NOT DISTINCT FROM v);
     EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END;
     IF NOT FOUND THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END IF;
   END IF;
 END LOOP;
 FOR d IN SELECT * FROM api.record_field_definitions WHERE workspace_id=p_workspace AND kind=p_model AND lifecycle='active' LOOP
   IF NOT out ? d.field_name AND d.default_value IS NOT NULL THEN out:=out||jsonb_build_object(d.field_name,d.default_value); END IF;
   IF NOT d.nullable AND (NOT out ? d.field_name OR out->d.field_name='null') THEN RAISE EXCEPTION 'required field % missing',d.field_name USING ERRCODE='SB071'; END IF;
 END LOOP;
 RETURN out;
END $$;
REVOKE EXECUTE ON FUNCTION internal.validate_model_fields(uuid,text,jsonb,jsonb) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

CREATE TABLE internal.model_field_reference_edges(
 definition_id uuid NOT NULL REFERENCES api.record_field_definitions(id) ON DELETE restrict,
 source_record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE cascade,
 target_record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE restrict,
 PRIMARY KEY(definition_id,source_record_id)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.guard_model_custom_fields() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE model text; old_fields jsonb;
BEGIN
 IF TG_TABLE_NAME='records' THEN
   model:=internal.model_key_for('api.records',NEW.kind);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id AND NEW.kind IS NOT DISTINCT FROM OLD.kind THEN OLD.custom_fields ELSE '{}'::jsonb END;
 ELSE
   model:=internal.model_key_for('api.'||TG_TABLE_NAME,NULL);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN OLD.custom_fields ELSE '{}'::jsonb END;
 END IF;
 IF model IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='records' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'locked_at' IS NOT NULL AND NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011'; END IF;
 NEW.custom_fields:=internal.validate_model_fields(NEW.workspace_id,model,NEW.custom_fields,old_fields);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION internal.sync_model_reference_edges() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d record; model text:=internal.model_key_for('api.records',NEW.kind); target uuid;
BEGIN
 DELETE FROM internal.model_field_reference_edges WHERE source_record_id=NEW.id;
 FOR d IN SELECT * FROM api.record_field_definitions WHERE workspace_id=NEW.workspace_id AND kind=model AND lifecycle IN ('active','retired') AND logical_type='reference' AND NEW.custom_fields ? field_name AND NEW.custom_fields->field_name <> 'null' LOOP
   BEGIN target:=(NEW.custom_fields->>d.field_name)::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid reference' USING ERRCODE='SB071'; END;
   INSERT INTO internal.model_field_reference_edges VALUES(d.id,NEW.id,target);
 END LOOP; RETURN NULL;
END $$;
CREATE TRIGGER model_custom_fields_records BEFORE INSERT OR UPDATE OF custom_fields,workspace_id,kind ON api.records FOR EACH ROW EXECUTE FUNCTION internal.guard_model_custom_fields();
CREATE TRIGGER model_reference_edges AFTER INSERT OR UPDATE OF custom_fields,workspace_id,kind ON api.records FOR EACH ROW EXECUTE FUNCTION internal.sync_model_reference_edges();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['projects','plate_designs','instruments','instrument_runs','dataset_schemas','scientific_tables'] LOOP
 EXECUTE format('CREATE TRIGGER model_custom_fields BEFORE INSERT OR UPDATE OF custom_fields,workspace_id ON api.%I FOR EACH ROW EXECUTE FUNCTION internal.guard_model_custom_fields()',t); END LOOP; END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.guard_model_definition() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'definitions cannot be deleted' USING ERRCODE='SB072'; END IF;
 IF EXISTS(SELECT 1 FROM api.model_base_fields WHERE model_key=NEW.kind AND field_key=NEW.field_name) THEN RAISE EXCEPTION 'protected field collision' USING ERRCODE='SB070'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.lifecycle IN ('active','retired') AND (NEW.workspace_id,NEW.kind,NEW.field_name,NEW.logical_type) IS DISTINCT FROM (OLD.workspace_id,OLD.kind,OLD.field_name,OLD.logical_type) THEN RAISE EXCEPTION 'activated identity and type are immutable' USING ERRCODE='SB072'; END IF;
  IF OLD.lifecycle='retired' AND NEW.lifecycle<>'retired' THEN RAISE EXCEPTION 'retirement is permanent' USING ERRCODE='SB072'; END IF;
 END IF; RETURN NEW;
END $$;
DROP TRIGGER record_field_definitions_immutable ON api.record_field_definitions;
CREATE TRIGGER model_definition_guard BEFORE INSERT OR UPDATE OR DELETE ON api.record_field_definitions FOR EACH ROW EXECUTE FUNCTION internal.guard_model_definition();
--> statement-breakpoint
CREATE FUNCTION internal.guard_model_field_option() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'options cannot be deleted' USING ERRCODE='SB072'; END IF;
 IF length(btrim(NEW.key)) NOT BETWEEN 1 AND 200 OR length(btrim(NEW.label)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid option' USING ERRCODE='SB071'; END IF;
 IF TG_OP='UPDATE' AND NEW.definition_id IS DISTINCT FROM OLD.definition_id OR TG_OP='UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN RAISE EXCEPTION 'option identity is immutable' USING ERRCODE='SB072'; END IF;
 IF TG_OP='UPDATE' AND OLD.lifecycle='retired' AND NEW.lifecycle<>'retired' THEN RAISE EXCEPTION 'retirement is permanent' USING ERRCODE='SB072'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER model_field_option_guard BEFORE INSERT OR UPDATE OR DELETE ON api.model_field_options FOR EACH ROW EXECUTE FUNCTION internal.guard_model_field_option();
CREATE FUNCTION internal.trg_change_event_model_field_options() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END; w uuid;
BEGIN SELECT workspace_id INTO w FROM api.record_field_definitions WHERE id=(r->>'definition_id')::uuid;
 PERFORM internal.emit_change_event(w,'model_field_option',(r->>'id')::uuid,CASE WHEN TG_OP='INSERT' THEN 'create' WHEN TG_OP='DELETE' THEN 'delete' ELSE 'update' END,NULL,NULL,r); RETURN NULL; END $$;
CREATE TRIGGER change_event_model_field_options AFTER INSERT OR UPDATE OR DELETE ON api.model_field_options FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_model_field_options();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_model_field(p_workspace_id uuid,p_model_key text,p_field_name text,p_label text,p_logical_type text,p_nullable boolean DEFAULT true,p_default_value jsonb DEFAULT NULL,p_validation jsonb DEFAULT '{}',p_unit jsonb DEFAULT NULL,p_description text DEFAULT NULL) RETURNS api.record_field_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.record_field_definitions; BEGIN
 IF NOT api.is_model_field_admin(p_workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF p_field_name !~ '^[a-z][a-z0-9_]{0,62}$' OR length(btrim(p_label)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid field key or label' USING ERRCODE='SB071'; END IF;
 IF EXISTS(SELECT 1 FROM api.model_base_fields WHERE model_key=p_model_key AND field_key=p_field_name) THEN RAISE EXCEPTION 'protected field collision' USING ERRCODE='SB070'; END IF;
 IF p_logical_type='reference' AND EXISTS(SELECT 1 FROM api.model_kinds WHERE key=p_model_key AND identity_table<>'api.records') THEN RAISE EXCEPTION 'references are only supported on record models' USING ERRCODE='SB071'; END IF;
 INSERT INTO api.record_field_definitions(workspace_id,kind,field_name,label,description,display_order,logical_type,nullable,default_value,unit,validation,lifecycle,created_by_user_id)
 VALUES(p_workspace_id,p_model_key,p_field_name,p_label,nullif(btrim(p_description),''),coalesce((SELECT max(display_order)+1 FROM api.record_field_definitions WHERE workspace_id=p_workspace_id AND kind=p_model_key),1),p_logical_type,p_nullable,p_default_value,p_unit,p_validation,'draft',api.current_user_id()) RETURNING * INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION api.update_model_field(p_definition_id uuid,p_patch jsonb) RETURNS api.record_field_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.record_field_definitions; BEGIN
 SELECT * INTO v FROM api.record_field_definitions WHERE id=p_definition_id; IF NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF p_patch - ARRAY['label','description','displayOrder','nullable','defaultValue','validation'] <> '{}'::jsonb THEN RAISE EXCEPTION 'unknown model field patch property' USING ERRCODE='SB071'; END IF;
 IF v.lifecycle IN ('active','retired') AND p_patch ?| ARRAY['nullable','defaultValue','validation'] THEN RAISE EXCEPTION 'active field contract is immutable' USING ERRCODE='SB072'; END IF;
 UPDATE api.record_field_definitions SET label=coalesce(p_patch->>'label',label),description=CASE WHEN p_patch?'description' THEN p_patch->>'description' ELSE description END,display_order=coalesce((p_patch->>'displayOrder')::integer,display_order),nullable=coalesce((p_patch->>'nullable')::boolean,nullable),default_value=CASE WHEN p_patch?'defaultValue' THEN p_patch->'defaultValue' ELSE default_value END,validation=coalesce(p_patch->'validation',validation),updated_at=now() WHERE id=p_definition_id RETURNING * INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION api.activate_model_field(p_definition_id uuid) RETURNS api.record_field_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.record_field_definitions; missing bigint; locked_missing bigint; BEGIN
 SELECT * INTO v FROM api.record_field_definitions WHERE id=p_definition_id FOR UPDATE; IF NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF v.logical_type='reference' AND NOT EXISTS(SELECT 1 FROM api.model_kinds WHERE key=v.validation->>'targetModelKey' AND identity_table='api.records') THEN RAISE EXCEPTION 'reference target must be record-backed' USING ERRCODE='SB071'; END IF;
 IF v.logical_type='reference' AND NOT EXISTS(SELECT 1 FROM api.model_kinds WHERE key=v.kind AND identity_table='api.records') THEN RAISE EXCEPTION 'references are only supported on record models' USING ERRCODE='SB071'; END IF;
 IF v.logical_type='category' AND NOT EXISTS(SELECT 1 FROM api.model_field_options WHERE definition_id=v.id AND lifecycle='active') THEN RAISE EXCEPTION 'category needs an active option' USING ERRCODE='SB071'; END IF;
 IF (v.logical_type='text' AND v.validation - ARRAY['minLength','maxLength','regex'] <> '{}'::jsonb)
   OR (v.logical_type IN ('integer','decimal') AND v.validation - ARRAY['min','max'] <> '{}'::jsonb)
   OR (v.logical_type='reference' AND v.validation - ARRAY['targetModelKey'] <> '{}'::jsonb)
   OR (v.logical_type NOT IN ('text','integer','decimal','reference') AND v.validation <> '{}'::jsonb AND NOT (v.logical_type='category' AND v.validation - 'enum'='{}'::jsonb))
 THEN RAISE EXCEPTION 'validation is not supported for this logical type' USING ERRCODE='SB071'; END IF;
 IF v.logical_type='text' AND ((v.validation ? 'minLength' AND (v.validation->>'minLength')::integer<0) OR (v.validation ? 'maxLength' AND (v.validation->>'maxLength')::integer<0) OR (v.validation ? 'minLength' AND v.validation ? 'maxLength' AND (v.validation->>'minLength')::integer>(v.validation->>'maxLength')::integer)) THEN RAISE EXCEPTION 'invalid text validation' USING ERRCODE='SB071'; END IF;
 IF v.logical_type IN ('integer','decimal') AND v.validation ? 'min' AND v.validation ? 'max' AND (v.validation->>'min')::numeric>(v.validation->>'max')::numeric THEN RAISE EXCEPTION 'invalid numeric validation' USING ERRCODE='SB071'; END IF;
 UPDATE api.record_field_definitions SET lifecycle='backfilling',updated_at=now() WHERE id=v.id;
 IF v.default_value IS NOT NULL THEN PERFORM internal.validate_model_fields(v.workspace_id,v.kind,jsonb_build_object(v.field_name,v.default_value),'{}'::jsonb); END IF;
 IF v.kind IN ('experiment','sample','reagent','protocol_template','notebook_template','file','report','study') THEN
   LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.records WHERE workspace_id=v.workspace_id AND kind=v.kind AND NOT custom_fields?v.field_name;
   SELECT count(*) INTO locked_missing FROM api.records WHERE workspace_id=v.workspace_id AND kind=v.kind AND locked_at IS NOT NULL AND (NOT custom_fields?v.field_name OR custom_fields->v.field_name='null');
   IF NOT v.nullable AND locked_missing>0 THEN RAISE EXCEPTION 'required field cannot be added while locked records lack a value' USING ERRCODE='SB071'; END IF;
   IF missing>0 AND NOT v.nullable AND v.default_value IS NULL THEN RAISE EXCEPTION 'required field needs a default for existing rows' USING ERRCODE='SB071'; END IF;
   IF v.default_value IS NOT NULL THEN UPDATE api.records SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND kind=v.kind AND locked_at IS NULL AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='project' THEN LOCK TABLE api.projects IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.projects WHERE workspace_id=v.workspace_id AND archived_at IS NULL AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.projects SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND archived_at IS NULL AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='plate_design' THEN LOCK TABLE api.plate_designs IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.plate_designs WHERE workspace_id=v.workspace_id AND status<>'archived' AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.plate_designs SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND status<>'archived' AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='instrument' THEN LOCK TABLE api.instruments IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.instruments WHERE workspace_id=v.workspace_id AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.instruments SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='instrument_run' THEN LOCK TABLE api.instrument_runs IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.instrument_runs WHERE workspace_id=v.workspace_id AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.instrument_runs SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='dataset_schema' THEN LOCK TABLE api.dataset_schemas IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.dataset_schemas WHERE workspace_id=v.workspace_id AND status<>'retired' AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.dataset_schemas SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND status<>'retired' AND NOT custom_fields?v.field_name; END IF;
 ELSIF v.kind='scientific_table' THEN LOCK TABLE api.scientific_tables IN SHARE ROW EXCLUSIVE MODE; SELECT count(*) INTO missing FROM api.scientific_tables WHERE workspace_id=v.workspace_id AND lifecycle<>'retired' AND NOT custom_fields?v.field_name; IF v.default_value IS NOT NULL THEN UPDATE api.scientific_tables SET custom_fields=custom_fields||jsonb_build_object(v.field_name,v.default_value) WHERE workspace_id=v.workspace_id AND lifecycle<>'retired' AND NOT custom_fields?v.field_name; END IF;
 ELSE RAISE EXCEPTION 'model does not support custom field activation' USING ERRCODE='SB071'; END IF;
 IF missing>0 AND NOT v.nullable AND v.default_value IS NULL THEN RAISE EXCEPTION 'required field needs a default for existing rows' USING ERRCODE='SB071'; END IF;
 UPDATE api.record_field_definitions SET lifecycle='active',updated_at=now() WHERE id=v.id RETURNING * INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION api.retire_model_field(p_definition_id uuid) RETURNS api.record_field_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.record_field_definitions; BEGIN SELECT * INTO v FROM api.record_field_definitions WHERE id=p_definition_id; IF NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF; UPDATE api.record_field_definitions SET lifecycle='retired',updated_at=now() WHERE id=p_definition_id RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_model_field_option(p_definition_id uuid,p_key text,p_label text,p_display_order integer DEFAULT 0) RETURNS api.model_field_options LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.model_field_options; w uuid; BEGIN SELECT workspace_id INTO w FROM api.record_field_definitions WHERE id=p_definition_id; IF NOT api.is_model_field_admin(w) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF; INSERT INTO api.model_field_options(definition_id,key,label,display_order) VALUES(p_definition_id,p_key,p_label,p_display_order) RETURNING * INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION api.update_model_field_option(p_option_id uuid,p_label text,p_display_order integer) RETURNS api.model_field_options LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.model_field_options; w uuid; BEGIN SELECT d.workspace_id INTO w FROM api.model_field_options o JOIN api.record_field_definitions d ON d.id=o.definition_id WHERE o.id=p_option_id; IF NOT api.is_model_field_admin(w) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF; UPDATE api.model_field_options SET label=p_label,display_order=p_display_order,updated_at=now() WHERE id=p_option_id RETURNING * INTO v; RETURN v; END $$;
CREATE OR REPLACE FUNCTION api.retire_model_field_option(p_option_id uuid) RETURNS api.model_field_options LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.model_field_options; w uuid; BEGIN SELECT d.workspace_id INTO w FROM api.model_field_options o JOIN api.record_field_definitions d ON d.id=o.definition_id WHERE o.id=p_option_id; IF NOT api.is_model_field_admin(w) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF; UPDATE api.model_field_options SET lifecycle='retired',updated_at=now() WHERE id=p_option_id RETURNING * INTO v; RETURN v; END $$;
CREATE FUNCTION api.create_and_activate_model_field(p_workspace_id uuid,p_model_key text,p_field_name text,p_label text,p_logical_type text,p_nullable boolean,p_default_value jsonb,p_validation jsonb,p_options jsonb DEFAULT '[]',p_unit jsonb DEFAULT NULL,p_description text DEFAULT NULL) RETURNS api.record_field_definitions LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE definition api.record_field_definitions; option jsonb; position integer:=0;
BEGIN
 definition:=api.create_model_field(p_workspace_id,p_model_key,p_field_name,p_label,p_logical_type,p_nullable,p_default_value,coalesce(p_validation,'{}'),p_unit,p_description);
 IF jsonb_typeof(coalesce(p_options,'[]'))<>'array' THEN RAISE EXCEPTION 'options must be an array' USING ERRCODE='SB071'; END IF;
 FOR option IN SELECT value FROM jsonb_array_elements(coalesce(p_options,'[]')) LOOP
   position:=position+1;
   PERFORM api.create_model_field_option(definition.id,option->>'key',option->>'label',position);
 END LOOP;
 RETURN api.activate_model_field(definition.id);
END $$;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation','workspace_invitation','workspace_settings','project_access','model_field_option'));
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_operation;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_operation CHECK(operation IN (
 'create','update','move','delete','archive','restore','link','unlink','quarantine','resolve','reopen','lock','amend','suspend','revoke'));
--> statement-breakpoint
ALTER TABLE api.model_kinds ENABLE ROW LEVEL SECURITY; ALTER TABLE api.model_base_fields ENABLE ROW LEVEL SECURITY; ALTER TABLE api.model_field_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY model_kinds_read ON api.model_kinds FOR SELECT TO authenticated USING(true);
CREATE POLICY model_base_fields_read ON api.model_base_fields FOR SELECT TO authenticated USING(true);
CREATE POLICY model_options_read ON api.model_field_options FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM api.record_field_definitions d WHERE d.id=definition_id AND api.is_workspace_member(d.workspace_id)));
CREATE POLICY model_kinds_api_read ON api.model_kinds FOR SELECT TO api_client USING(api.current_workspace_id() IS NOT NULL);
CREATE POLICY model_base_fields_api_read ON api.model_base_fields FOR SELECT TO api_client USING(api.current_workspace_id() IS NOT NULL);
CREATE POLICY model_options_api_read ON api.model_field_options FOR SELECT TO api_client USING(EXISTS(SELECT 1 FROM api.record_field_definitions d WHERE d.id=definition_id AND d.workspace_id=api.current_workspace_id()));
REVOKE ALL ON api.model_kinds,api.model_base_fields,api.model_field_options,api.record_field_definitions FROM authenticated,api_client;
GRANT SELECT ON api.model_kinds,api.model_base_fields,api.model_field_options,api.record_field_definitions TO authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_model_field(uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,text),api.update_model_field(uuid,jsonb),api.activate_model_field(uuid),api.retire_model_field(uuid),api.create_model_field_option(uuid,text,text,integer),api.update_model_field_option(uuid,text,integer),api.retire_model_field_option(uuid),api.create_and_activate_model_field(uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.create_model_field(uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,text),api.update_model_field(uuid,jsonb),api.activate_model_field(uuid),api.retire_model_field(uuid),api.create_model_field_option(uuid,text,text,integer),api.update_model_field_option(uuid,text,integer),api.retire_model_field_option(uuid),api.create_and_activate_model_field(uuid,text,text,text,text,boolean,jsonb,jsonb,jsonb,jsonb,text) TO authenticated;
--> statement-breakpoint

-- Record creation/editing overloads carry model fields through the same
-- transaction as stable identity and audited Sample metadata.
CREATE FUNCTION api.create_model_record(
 p_project_id uuid,p_kind text,p_title text,p_status text DEFAULT 'draft',p_tags text[] DEFAULT '{}',p_properties jsonb DEFAULT '{}',p_custom_fields jsonb DEFAULT '{}'
) RETURNS api.records LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE workspace uuid:=api.current_workspace_id(); prefix text; year text:=to_char(now(),'YYYY'); sequence integer; generated_identifier text; result api.records;
BEGIN
 IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN RAISE EXCEPTION 'active workspace membership required' USING ERRCODE='42501'; END IF;
 prefix:=CASE p_kind WHEN 'experiment' THEN 'EXP' WHEN 'protocol_template' THEN 'PRT' WHEN 'report' THEN 'RPT' WHEN 'sample' THEN 'SMP' WHEN 'reagent' THEN 'RGT' WHEN 'file' THEN 'FILE' WHEN 'notebook_template' THEN 'NBK' ELSE NULL END;
 IF prefix IS NULL THEN RAISE EXCEPTION 'unsupported record kind: %',p_kind USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=workspace) THEN RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE='42501'; END IF;
 LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*)+1 INTO sequence FROM api.records WHERE project_id=p_project_id AND identifier LIKE prefix||'-'||year||'-%';
 generated_identifier:=prefix||'-'||year||'-'||lpad(sequence::text,4,'0');
 INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,tags,properties,custom_fields,created_by_user_id)
 VALUES(workspace,p_project_id,p_kind,generated_identifier,coalesce(nullif(btrim(p_title),''),generated_identifier),p_status,coalesce(p_tags,'{}'),coalesce(p_properties,'{}'),coalesce(p_custom_fields,'{}'),api.current_user_id()) RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION api.create_model_record(uuid,text,text,text,text[],jsonb,jsonb) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.create_model_record(uuid,text,text,text,text[],jsonb,jsonb) TO authenticated;

CREATE FUNCTION api.update_record_custom_fields(
 p_record_id uuid,p_expected_metadata_version integer,p_values jsonb
) RETURNS api.records LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result api.records;
BEGIN
 SELECT * INTO result FROM api.records WHERE id=p_record_id FOR UPDATE;
 IF result.id IS NULL THEN RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE='42501'; END IF;
 IF result.archived_at IS NOT NULL OR result.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'record is not editable' USING ERRCODE='SB004'; END IF;
 IF result.locked_at IS NOT NULL THEN RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011'; END IF;
 IF result.metadata_version<>p_expected_metadata_version THEN RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE='SB001'; END IF;
 UPDATE api.records SET custom_fields=result.custom_fields||coalesce(p_values,'{}'),
   metadata_version=result.metadata_version+1,updated_at=now(),updated_by_user_id=api.current_user_id()
 WHERE id=p_record_id RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION api.update_record_custom_fields(uuid,integer,jsonb) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.update_record_custom_fields(uuid,integer,jsonb) TO authenticated;

CREATE FUNCTION api.edit_sample(
 p_record_id uuid,p_expected_metadata_version integer,p_title text,p_properties jsonb,p_tags text[],p_notes text,p_custom_fields jsonb
) RETURNS api.records LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result api.records; merged_properties jsonb;
BEGIN
 SELECT * INTO result FROM api.records WHERE id=p_record_id FOR UPDATE;
 IF result.id IS NULL THEN RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE='42501'; END IF;
 IF result.kind<>'sample' THEN RAISE EXCEPTION 'record % is not a sample',p_record_id USING ERRCODE='SB009'; END IF;
 IF result.archived_at IS NOT NULL THEN RAISE EXCEPTION 'cannot edit an archived sample' USING ERRCODE='SB004'; END IF;
 IF result.metadata_version<>p_expected_metadata_version THEN RAISE EXCEPTION 'metadata version mismatch: expected %, got %',p_expected_metadata_version,result.metadata_version USING ERRCODE='SB001'; END IF;
 merged_properties:=result.properties;
 IF p_properties IS NOT NULL THEN merged_properties:=merged_properties||(p_properties-'quantity'-'quantityUnit'-'storageLocation'); END IF;
 UPDATE api.records SET title=coalesce(nullif(btrim(p_title),''),result.title),tags=coalesce(p_tags,result.tags),properties=merged_properties,
   custom_fields=CASE WHEN p_custom_fields IS NULL THEN result.custom_fields ELSE result.custom_fields||p_custom_fields END,
   metadata_version=result.metadata_version+1,updated_by_user_id=api.current_user_id()
 WHERE id=p_record_id RETURNING * INTO result;
 INSERT INTO api.sample_events(workspace_id,record_id,operation,actor_user_id,notes) VALUES(result.workspace_id,result.id,'edit',api.current_user_id(),p_notes);
 RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION api.edit_sample(uuid,integer,text,jsonb,text[],text,jsonb) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.edit_sample(uuid,integer,text,jsonb,text[],text,jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.model_field_usage(p_definition_id uuid) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.record_field_definitions; total bigint;
BEGIN
 SELECT * INTO definition FROM api.record_field_definitions WHERE id=p_definition_id;
 IF definition.id IS NULL OR NOT api.is_workspace_member(definition.workspace_id) THEN RAISE EXCEPTION 'workspace membership required' USING ERRCODE='42501'; END IF;
 CASE definition.kind
  WHEN 'project' THEN SELECT count(*) INTO total FROM api.projects WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  WHEN 'plate_design' THEN SELECT count(*) INTO total FROM api.plate_designs WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  WHEN 'instrument' THEN SELECT count(*) INTO total FROM api.instruments WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  WHEN 'instrument_run' THEN SELECT count(*) INTO total FROM api.instrument_runs WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  WHEN 'dataset_schema' THEN SELECT count(*) INTO total FROM api.dataset_schemas WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  WHEN 'scientific_table' THEN SELECT count(*) INTO total FROM api.scientific_tables WHERE workspace_id=definition.workspace_id AND custom_fields ? definition.field_name;
  ELSE SELECT count(*) INTO total FROM api.records WHERE workspace_id=definition.workspace_id AND kind=definition.kind AND custom_fields ? definition.field_name;
 END CASE;
 RETURN total;
END $$;
REVOKE EXECUTE ON FUNCTION api.model_field_usage(uuid) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.model_field_usage(uuid) TO authenticated;
--> statement-breakpoint

-- Extend, rather than replace, the canonical envelope.
CREATE OR REPLACE FUNCTION internal.model_field_manifest(p_record_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('definitions',coalesce(jsonb_agg(jsonb_build_object('id',d.id,'modelKey',d.kind,'fieldName',d.field_name,'logicalType',d.logical_type,'nullable',d.nullable,'defaultValue',d.default_value,'validation',d.validation,'lifecycle',d.lifecycle,'options',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'label',o.label,'displayOrder',o.display_order,'lifecycle',o.lifecycle) ORDER BY o.display_order,o.key,o.id) FROM api.model_field_options o WHERE o.definition_id=d.id),'[]')) ORDER BY d.kind,d.field_name,d.id) FILTER (WHERE d.id IS NOT NULL),'[]'))
 FROM api.records r LEFT JOIN api.record_field_definitions d ON d.workspace_id=r.workspace_id AND d.kind=internal.model_key_for('api.records',r.kind) AND d.lifecycle IN ('active','retired') WHERE r.id=p_record_id $$;
ALTER FUNCTION internal.build_revision_envelope(uuid) RENAME TO build_revision_envelope_without_model_fields;
CREATE FUNCTION internal.build_revision_envelope(p_record_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base jsonb;
BEGIN base:=internal.build_revision_envelope_without_model_fields(p_record_id);
 RETURN base || jsonb_build_object('modelFields',internal.model_field_manifest(p_record_id))
   || jsonb_build_object('record',(base->'record') || jsonb_build_object('customFields',(SELECT custom_fields FROM api.records WHERE id=p_record_id)));
END $$;
REVOKE EXECUTE ON FUNCTION internal.build_revision_envelope(uuid),internal.model_field_manifest(uuid),internal.build_revision_envelope_without_model_fields(uuid) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
