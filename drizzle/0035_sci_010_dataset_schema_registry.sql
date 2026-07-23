-- ===========================================================================
-- 0035: SCI-010 Dataset schema registry (decision 0034).
--
-- A workspace-level typed schema registry that sits as a metadata layer over
-- the existing per-sheet physical tables (ADR 0019 / migration 0013). It
-- provides stable schema + field identities so that two sheets measuring the
-- same thing share a durable join key, and a cross-sheet query API that unions
-- rows by stable field slug instead of physical column name.
--
-- New tables: api.dataset_schemas, api.dataset_schema_fields.
-- Binding columns added to api.scientific_tables / api.scientific_columns.
-- RPCs: create_dataset_schema, add_dataset_schema_field,
--   retire_dataset_schema_field, publish_dataset_schema,
--   instantiate_dataset_schema, upgrade_scientific_schema,
--   query_dataset (SECURITY INVOKER), bind_legacy_sheet.
--
-- Reuses internal.assert_scientific_actor, internal.emit_change_event,
-- internal.scientific_name, internal.compile_scientific_column,
-- internal.scientific_storage_type, internal.render_scientific_check,
-- api.is_workspace_member. The 0019 logical_type vocabulary is reused
-- verbatim. No physical resource_name / field_name is exposed to the API
-- surface in query_dataset.
-- ===========================================================================

CREATE TABLE "api"."dataset_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dataset_schemas_workspace_slug_revision" UNIQUE("workspace_id","slug","revision"),
	CONSTRAINT "chk_dataset_schemas_slug" CHECK ("api"."dataset_schemas"."slug" ~ '^[a-z][a-z0-9_]{0,59}$'),
	CONSTRAINT "chk_dataset_schemas_status" CHECK ("api"."dataset_schemas"."status" IN ('draft','published','retired')),
	CONSTRAINT "chk_dataset_schemas_revision" CHECK ("api"."dataset_schemas"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "api"."dataset_schema_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"logical_type" text NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"default_value" jsonb,
	"unit" jsonb,
	"validation" jsonb DEFAULT '{}' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_dataset_schema_fields_schema_slug" UNIQUE("schema_id","slug"),
	CONSTRAINT "chk_dataset_schema_fields_slug" CHECK ("api"."dataset_schema_fields"."slug" ~ '^[a-z][a-z0-9_]{0,59}$'),
	CONSTRAINT "chk_dataset_schema_fields_type" CHECK ("api"."dataset_schema_fields"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category')),
	CONSTRAINT "chk_dataset_schema_fields_lifecycle" CHECK ("api"."dataset_schema_fields"."lifecycle" IN ('active','retired'))
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_schemas" ADD CONSTRAINT "dataset_schemas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schemas" ADD CONSTRAINT "dataset_schemas_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_fields" ADD CONSTRAINT "dataset_schema_fields_schema_id_dataset_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "api"."dataset_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_fields" ADD CONSTRAINT "dataset_schema_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_schemas_workspace_slug" ON "api"."dataset_schemas" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_fields_schema" ON "api"."dataset_schema_fields" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_fields_workspace" ON "api"."dataset_schema_fields" USING btree ("workspace_id");--> statement-breakpoint

-- Bind existing physical storage to registry identities. Both nullable: a
-- null dataset_schema_id is a legacy unbound sheet (migration 0013 behaviour).
ALTER TABLE "api"."scientific_tables" ADD COLUMN "dataset_schema_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD COLUMN "dataset_schema_revision" integer;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD COLUMN "dataset_schema_field_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_dataset_schema_id_dataset_schemas_id_fk" FOREIGN KEY ("dataset_schema_id") REFERENCES "api"."dataset_schemas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "scientific_columns_dataset_schema_field_id_dataset_schema_fields_id_fk" FOREIGN KEY ("dataset_schema_field_id") REFERENCES "api"."dataset_schema_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scientific_tables_dataset_schema" ON "api"."scientific_tables" USING btree ("dataset_schema_id","dataset_schema_revision");--> statement-breakpoint
CREATE INDEX "idx_scientific_columns_dataset_schema_field" ON "api"."scientific_columns" USING btree ("dataset_schema_field_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identity guards: workspace_id, slug (and logical_type for fields) are
-- immutable after creation. Same pattern as
-- guard_record_field_definitions_identity (migration 0022). Renaming a field
-- renames the label, not the slug, so the cross-sheet join key stays stable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."guard_dataset_schema_identity"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'dataset_schemas' THEN
      IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
         OR NEW.slug IS DISTINCT FROM OLD.slug THEN
        RAISE EXCEPTION 'dataset schema identity (workspace_id, slug) is immutable'
          USING ERRCODE = '23514';
      END IF;
    ELSIF TG_TABLE_NAME = 'dataset_schema_fields' THEN
      IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
         OR NEW.schema_id IS DISTINCT FROM OLD.schema_id
         OR NEW.slug IS DISTINCT FROM OLD.slug
         OR NEW.logical_type IS DISTINCT FROM OLD.logical_type THEN
        RAISE EXCEPTION 'dataset schema field identity (workspace_id, schema_id, slug, logical_type) is immutable'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."guard_dataset_schema_identity"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "dataset_schemas_immutable"
  BEFORE UPDATE ON "api"."dataset_schemas"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_dataset_schema_identity"();--> statement-breakpoint
CREATE TRIGGER "dataset_schema_fields_immutable"
  BEFORE UPDATE ON "api"."dataset_schema_fields"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_dataset_schema_identity"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at_dataset_schemas"
  BEFORE UPDATE ON "api"."dataset_schemas"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at_dataset_schema_fields"
  BEFORE UPDATE ON "api"."dataset_schema_fields"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS. Mirrors the record_field_definitions policy shape (migration 0022):
-- members read; members insert drafts; owners update/retire/publish/delete.
-- The SECURITY DEFINER RPCs below enforce the draft/publish business logic
-- and bypass RLS; these policies guard direct PostgREST CRUD.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."dataset_schemas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api"."dataset_schema_fields" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "api"."dataset_schemas","api"."dataset_schema_fields" TO authenticated;
GRANT SELECT ON "api"."dataset_schemas","api"."dataset_schema_fields" TO api_client;

CREATE POLICY "dataset_schemas_select" ON "api"."dataset_schemas"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "dataset_schemas_select_api_client" ON "api"."dataset_schemas"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schemas_insert" ON "api"."dataset_schemas"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_member"("workspace_id")
              AND "created_by_user_id" = "api"."current_user_id"());--> statement-breakpoint
CREATE POLICY "dataset_schemas_update" ON "api"."dataset_schemas"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schemas_delete" ON "api"."dataset_schemas"
  FOR DELETE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'));--> statement-breakpoint

CREATE POLICY "dataset_schema_fields_select" ON "api"."dataset_schema_fields"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "dataset_schema_fields_select_api_client" ON "api"."dataset_schema_fields"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schema_fields_insert" ON "api"."dataset_schema_fields"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_member"("workspace_id")
              AND "schema_id" IN (SELECT id FROM "api"."dataset_schemas" WHERE workspace_id = "api"."current_workspace_id"()));--> statement-breakpoint
CREATE POLICY "dataset_schema_fields_update" ON "api"."dataset_schema_fields"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schema_fields_delete" ON "api"."dataset_schema_fields"
  FOR DELETE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen the change-event entity vocabulary so dataset_schema* events are
-- representable. The existing scientific_table event path is unchanged.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type" CHECK ("api"."change_events"."entity_type" IN ('project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Internal helper: validate and compile a dataset schema field spec. Wraps
-- internal.compile_scientific_column after asserting the slug shape, so the
-- 0019 validation vocabulary is reused without reinvention.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."validate_dataset_field_spec"(p_spec jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = '' AS $$
DECLARE v_slug text; v_compiled jsonb; v_compile_spec jsonb;
BEGIN
  IF jsonb_typeof(p_spec)<>'object' THEN RAISE EXCEPTION 'field spec must be an object' USING ERRCODE='22023'; END IF;
  v_slug := p_spec->>'slug';
  IF v_slug IS NULL OR v_slug !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'field slug must match ^[a-z][a-z0-9_]{0,59}$' USING ERRCODE='22023'; END IF;
  -- compile_scientific_column rejects unknown members, so strip the registry-
  -- only keys (slug, display_order) before delegating to the 0019 validator.
  v_compile_spec := p_spec - ARRAY['slug','display_order'];
  v_compiled := internal.compile_scientific_column(v_compile_spec);
  RETURN jsonb_build_object('slug',v_slug,'compiled',v_compiled);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."validate_dataset_field_spec"(jsonb) FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.create_dataset_schema: create a reusable or ad-hoc schema as a draft
-- revision. If the slug already exists in the workspace, a new draft revision
-- (max+1) is created; otherwise revision 1. Fields are cloned from p_fields.
-- Any workspace member may create a draft (ADR 0034 permission table).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_dataset_schema"(
  p_slug text,
  p_name text,
  p_description text DEFAULT NULL,
  p_fields jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE ws uuid := api.current_workspace_id(); a jsonb; sid uuid := gen_random_uuid(); rev int := 1; item jsonb; ord int := 0; field_id uuid; spec jsonb; compiled jsonb; chk text;
BEGIN
  IF ws IS NULL THEN RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE='42804'; END IF;
  a := internal.assert_scientific_actor(ws);
  IF p_slug IS NULL OR p_slug !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'slug must match ^[a-z][a-z0-9_]{0,59}$' USING ERRCODE='22023'; END IF;
  IF NULLIF(p_name,'') IS NULL THEN RAISE EXCEPTION 'name is required' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_fields)<>'array' THEN RAISE EXCEPTION 'fields must be an array' USING ERRCODE='22023'; END IF;
  -- Next revision for this slug (1 for a new schema).
  SELECT coalesce(max(revision),0)+1 INTO rev FROM api.dataset_schemas WHERE workspace_id=ws AND slug=p_slug;
  INSERT INTO api.dataset_schemas(id,workspace_id,slug,name,description,revision,status,created_by_user_id)
    VALUES(sid,ws,p_slug,p_name,p_description,rev,'draft',a->>'user_id');
  FOR item IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    ord := ord+1;
    spec := item;
    IF spec ? 'display_order' AND jsonb_typeof(spec->'display_order')='number' THEN ord := (spec->>'display_order')::int; END IF;
    compiled := internal.validate_dataset_field_spec(spec);
    field_id := gen_random_uuid();
    INSERT INTO api.dataset_schema_fields(id,schema_id,workspace_id,slug,label,description,display_order,logical_type,nullable,default_value,unit,validation,lifecycle)
      VALUES(field_id,sid,ws,compiled->>'slug',spec->>'label',spec->>'description',ord,spec->>'logical_type',COALESCE((spec->>'nullable')::boolean,true),spec->'default',spec->'unit',COALESCE(spec->'validation','{}'::jsonb),'active');
    -- Reject duplicate slugs within the same creation batch.
  END LOOP;
  PERFORM internal.emit_change_event(ws,'dataset_schema',sid,'create',NULL,NULL,jsonb_build_object('schemaId',sid,'slug',p_slug,'revision',rev,'fieldCount',ord));
  RETURN jsonb_build_object('schema',(SELECT to_jsonb(s) FROM api.dataset_schemas s WHERE id=sid),'fields',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY display_order),'[]') FROM api.dataset_schema_fields f WHERE schema_id=sid));
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_dataset_schema"(text,text,text,jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_dataset_schema"(text,text,text,jsonb) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.add_dataset_schema_field: add a field to a draft revision. The schema
-- creator or a workspace owner may edit drafts (ADR 0034).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."add_dataset_schema_field"(
  p_schema_id uuid,
  p_slug text,
  p_label text,
  p_logical_type text,
  p_nullable boolean DEFAULT true,
  p_default jsonb DEFAULT NULL,
  p_unit jsonb DEFAULT NULL,
  p_validation jsonb DEFAULT '{}'::jsonb,
  p_description text DEFAULT NULL,
  p_options jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE s api.dataset_schemas; a jsonb; n int; spec jsonb; compiled jsonb; field_id uuid; chk text;
BEGIN
  SELECT * INTO s FROM api.dataset_schemas WHERE id=p_schema_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'schema not found' USING ERRCODE='P0002'; END IF;
  a := internal.assert_scientific_actor(s.workspace_id);
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'fields can only be added to a draft revision' USING ERRCODE='23514'; END IF;
  IF NOT (s.created_by_user_id = a->>'user_id' OR api.is_workspace_member(s.workspace_id,'owner')) THEN RAISE EXCEPTION 'only the schema creator or a workspace owner may edit a draft' USING ERRCODE='42501'; END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'slug must match ^[a-z][a-z0-9_]{0,59}$' USING ERRCODE='22023'; END IF;
  IF NULLIF(p_label,'') IS NULL THEN RAISE EXCEPTION 'label is required' USING ERRCODE='22023'; END IF;
  spec := jsonb_build_object('slug',p_slug,'label',p_label,'logical_type',p_logical_type,'nullable',p_nullable,'validation',coalesce(p_validation,'{}'::jsonb))
    || CASE WHEN p_default IS NULL THEN '{}' ELSE jsonb_build_object('default',p_default) END
    || CASE WHEN p_unit IS NULL THEN '{}' ELSE jsonb_build_object('unit',p_unit) END
    || CASE WHEN p_options IS NULL THEN '{}' ELSE jsonb_build_object('options',p_options) END
    || CASE WHEN p_description IS NULL THEN '{}' ELSE jsonb_build_object('description',p_description) END;
  compiled := internal.validate_dataset_field_spec(spec);
  SELECT coalesce(max(display_order),0)+1 INTO n FROM api.dataset_schema_fields WHERE schema_id=s.id;
  field_id := gen_random_uuid();
  INSERT INTO api.dataset_schema_fields(id,schema_id,workspace_id,slug,label,description,display_order,logical_type,nullable,default_value,unit,validation,lifecycle)
    VALUES(field_id,s.id,s.workspace_id,compiled->>'slug',p_label,p_description,n,p_logical_type,p_nullable,p_default,p_unit,coalesce(p_validation,'{}'),'active');
  PERFORM internal.emit_change_event(s.workspace_id,'dataset_schema_field',field_id,'create',NULL,NULL,jsonb_build_object('schemaId',s.id,'slug',p_slug,'logicalType',p_logical_type));
  RETURN (SELECT to_jsonb(f) FROM api.dataset_schema_fields f WHERE id=field_id);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."add_dataset_schema_field"(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."add_dataset_schema_field"(uuid,text,text,text,boolean,jsonb,jsonb,jsonb,text,jsonb) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.retire_dataset_schema_field: retire a field (soft). Owner-only per the
-- ADR permission table. Existing data is preserved; the field slug stays
-- reserved (unique constraint). Prevents new writes/instantiations using it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."retire_dataset_schema_field"(p_schema_field_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE f api.dataset_schema_fields; a jsonb;
BEGIN
  SELECT * INTO f FROM api.dataset_schema_fields WHERE id=p_schema_field_id FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'field not found' USING ERRCODE='P0002'; END IF;
  a := internal.assert_scientific_actor(f.workspace_id);
  IF NOT api.is_workspace_member(f.workspace_id,'owner') THEN RAISE EXCEPTION 'only a workspace owner may retire a schema field' USING ERRCODE='42501'; END IF;
  IF f.lifecycle='retired' THEN RAISE EXCEPTION 'field is already retired' USING ERRCODE='23514'; END IF;
  UPDATE api.dataset_schema_fields SET lifecycle='retired' WHERE id=f.id;
  PERFORM internal.emit_change_event(f.workspace_id,'dataset_schema_field',f.id,'update',NULL,NULL,jsonb_build_object('schemaId',f.schema_id,'slug',f.slug,'lifecycle','retired'));
  RETURN jsonb_build_object('retired',true,'fieldId',f.id);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."retire_dataset_schema_field"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."retire_dataset_schema_field"(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.publish_dataset_schema: freeze a draft revision and set status=
-- published. Owner-only. Only one published revision per slug is active at a
-- time, so any prior published revision for the same slug is retired first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."publish_dataset_schema"(p_schema_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE s api.dataset_schemas; a jsonb; prior api.dataset_schemas;
BEGIN
  SELECT * INTO s FROM api.dataset_schemas WHERE id=p_schema_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'schema not found' USING ERRCODE='P0002'; END IF;
  a := internal.assert_scientific_actor(s.workspace_id);
  IF NOT api.is_workspace_member(s.workspace_id,'owner') THEN RAISE EXCEPTION 'only a workspace owner may publish a schema' USING ERRCODE='42501'; END IF;
  IF s.status <> 'draft' THEN RAISE EXCEPTION 'only a draft revision can be published' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM api.dataset_schema_fields WHERE schema_id=s.id AND lifecycle='active') THEN RAISE EXCEPTION 'cannot publish a schema with no active fields' USING ERRCODE='23514'; END IF;
  -- Retire any previously-published revision of the same slug.
  FOR prior IN SELECT * FROM api.dataset_schemas WHERE workspace_id=s.workspace_id AND slug=s.slug AND status='published' AND id<>s.id LOOP
    UPDATE api.dataset_schemas SET status='retired' WHERE id=prior.id;
    PERFORM internal.emit_change_event(s.workspace_id,'dataset_schema',prior.id,'update',NULL,NULL,jsonb_build_object('schemaId',prior.id,'slug',prior.slug,'status','retired','supersededBy',s.id));
  END LOOP;
  UPDATE api.dataset_schemas SET status='published' WHERE id=s.id;
  PERFORM internal.emit_change_event(s.workspace_id,'dataset_schema',s.id,'update',NULL,NULL,jsonb_build_object('schemaId',s.id,'slug',s.slug,'revision',s.revision,'status','published'));
  RETURN jsonb_build_object('published',true,'schemaId',s.id,'revision',s.revision);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."publish_dataset_schema"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."publish_dataset_schema"(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.instantiate_dataset_schema: create a scientific table bound to a
-- published schema revision. Clones the active fields into scientific_columns
-- and links each column to its dataset_schema_field_id. The physical storage
-- model (generated table, RLS, HyperFormula triggers) is identical to
-- create_scientific_table; this RPC reuses the same internal compilers.
-- Any workspace member may bind a sheet at creation (ADR 0034).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."instantiate_dataset_schema"(
  p_block_id uuid,
  p_schema_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE b api.blocks; r api.records; s api.dataset_schemas; a jsonb; tid uuid := gen_random_uuid(); rn text; f api.dataset_schema_fields; fn text; ord int := 0; colid uuid; compiled jsonb; spec jsonb; chk text; result jsonb; option_item jsonb; option_ord int;
BEGIN
  SELECT * INTO s FROM api.dataset_schemas WHERE id=p_schema_id;
  IF s.id IS NULL THEN RAISE EXCEPTION 'schema not found' USING ERRCODE='P0002'; END IF;
  a := internal.assert_scientific_actor(s.workspace_id);
  IF s.status <> 'published' THEN RAISE EXCEPTION 'can only instantiate a published schema revision' USING ERRCODE='23514'; END IF;
  SELECT * INTO b FROM api.blocks WHERE id=p_block_id;
  IF b.id IS NULL OR b.type<>'sheet' THEN RAISE EXCEPTION 'owning block must be sheet' USING ERRCODE='23514'; END IF;
  SELECT * INTO r FROM api.records WHERE id=b.record_id;
  IF r.workspace_id IS DISTINCT FROM s.workspace_id THEN RAISE EXCEPTION 'block workspace does not match schema workspace' USING ERRCODE='23514'; END IF;
  LOOP rn := internal.scientific_name('sheet_'); EXIT WHEN to_regclass(format('api.%I',rn)) IS NULL AND NOT EXISTS(SELECT 1 FROM api.scientific_tables WHERE resource_name=rn); END LOOP;
  INSERT INTO api.scientific_tables(id,workspace_id,record_id,block_id,resource_name,name,description,created_by_user_id,created_by_credential_id,dataset_schema_id,dataset_schema_revision)
    VALUES(tid,r.workspace_id,r.id,b.id,rn,COALESCE(p_name,s.name),p_description,a->>'user_id',(a->>'credential_id')::uuid,s.id,s.revision);
  EXECUTE format('CREATE TABLE api.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL DEFAULT api.current_workspace_id() CHECK (workspace_id=%L::uuid), version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), formula_column_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], created_by_user_id text, created_by_credential_id uuid, updated_by_user_id text, updated_by_credential_id uuid)',rn,r.workspace_id);
  FOR f IN SELECT * FROM api.dataset_schema_fields WHERE schema_id=s.id AND lifecycle='active' ORDER BY display_order LOOP
    ord := ord+1;
    spec := jsonb_build_object('label',f.label,'logical_type',f.logical_type,'nullable',f.nullable,'validation',coalesce(f.validation,'{}'::jsonb))
      || CASE WHEN f.default_value IS NULL THEN '{}' ELSE jsonb_build_object('default',f.default_value) END
      || CASE WHEN f.unit IS NULL THEN '{}' ELSE jsonb_build_object('unit',f.unit) END;
    compiled := internal.compile_scientific_column(spec);
    LOOP fn := internal.scientific_name('col_'); EXIT WHEN NOT EXISTS(SELECT 1 FROM api.scientific_columns WHERE field_name=fn); END LOOP;
    colid := gen_random_uuid();
    INSERT INTO api.scientific_columns(id,table_id,workspace_id,field_name,label,description,display_order,logical_type,nullable,default_value,unit,validation,created_by_user_id,created_by_credential_id,dataset_schema_field_id)
      VALUES(colid,tid,r.workspace_id,fn,f.label,f.description,ord,f.logical_type,f.nullable,f.default_value,f.unit,coalesce(f.validation,'{}'),a->>'user_id',(a->>'credential_id')::uuid,f.id);
    EXECUTE format('ALTER TABLE api.%I ADD COLUMN %I %s%s%s',rn,fn,compiled->>'storageType',compiled->>'defaultSql',compiled->>'notNullSql');
    FOR chk IN SELECT value#>>'{}' FROM jsonb_array_elements(compiled->'checks') LOOP EXECUTE format('ALTER TABLE api.%I ADD CHECK (%s)',rn,internal.render_scientific_check(chk::jsonb,fn)); END LOOP;
  END LOOP;
  EXECUTE format('ALTER TABLE api.%I ENABLE ROW LEVEL SECURITY',rn);
  EXECUTE format('CREATE POLICY %I ON api.%I FOR ALL TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)) WITH CHECK (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))','scientific_rows_member',rn);
  EXECUTE format('GRANT SELECT ON api.%I TO authenticated',rn);
  IF ord>0 THEN EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON api.%I TO authenticated',(SELECT string_agg(format('%I',field_name),',') FROM api.scientific_columns WHERE table_id=tid),(SELECT string_agg(format('%I',field_name),',') FROM api.scientific_columns WHERE table_id=tid),rn); END IF;
  EXECUTE format('CREATE TRIGGER scientific_row_before BEFORE INSERT OR UPDATE OR DELETE ON api.%I FOR EACH ROW EXECUTE FUNCTION internal.scientific_row_before()',rn);
  EXECUTE format('CREATE TRIGGER scientific_row_event AFTER INSERT OR UPDATE OR DELETE ON api.%I FOR EACH ROW EXECUTE FUNCTION internal.scientific_row_event()',rn);
  PERFORM internal.emit_change_event(r.workspace_id,'scientific_table',tid,'create',r.id,r.project_id,jsonb_build_object('tableId',tid,'schemaVersion',1,'operation','instantiate','datasetSchemaId',s.id,'datasetSchemaRevision',s.revision,'columnIds',(SELECT coalesce(jsonb_agg(id ORDER BY display_order),'[]') FROM api.scientific_columns WHERE table_id=tid)));
  PERFORM pg_notify('pgrst','reload schema');
  SELECT jsonb_build_object('table',to_jsonb(t),'columns',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY display_order),'[]') FROM api.scientific_columns c WHERE table_id=tid),'resourceName',rn) INTO result FROM api.scientific_tables t WHERE id=tid;
  RETURN result;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."instantiate_dataset_schema"(uuid,uuid,text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."instantiate_dataset_schema"(uuid,uuid,text,text) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.upgrade_scientific_schema: explicitly upgrade a bound sheet to a newer
-- published revision. Sheets are never auto-upgraded (ADR 0034). Additive-only
-- fast path: every field slug present in the current revision must exist in
-- the target revision with the same logical_type. New fields in the target
-- are added as columns and linked. Type changes or field retirements raise
-- (per-column confirmation/migration is a future step).
-- Any workspace member with write on the sheet may upgrade (ADR 0034).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."upgrade_scientific_schema"(
  p_table_id uuid,
  p_target_revision int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE t api.scientific_tables; a jsonb; s_cur api.dataset_schemas; s_tgt api.dataset_schemas; f_cur api.dataset_schema_fields; f_tgt api.dataset_schema_fields; missing text; type_mismatch text; fn text; colid uuid; compiled jsonb; spec jsonb; chk text; added uuid[];
BEGIN
  SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'table not found' USING ERRCODE='P0002'; END IF;
  IF t.dataset_schema_id IS NULL THEN RAISE EXCEPTION 'table is not bound to a dataset schema' USING ERRCODE='23514'; END IF;
  a := internal.assert_scientific_actor(t.workspace_id);
  -- The table is bound to a specific revision row (t.dataset_schema_id). The
  -- target is a different published row of the same slug + workspace.
  SELECT * INTO s_cur FROM api.dataset_schemas WHERE id=t.dataset_schema_id;
  SELECT * INTO s_tgt FROM api.dataset_schemas WHERE workspace_id=s_cur.workspace_id AND slug=s_cur.slug AND revision=p_target_revision AND status='published';
  IF s_tgt.id IS NULL THEN RAISE EXCEPTION 'target revision is not a published revision of this schema' USING ERRCODE='23514'; END IF;
  IF s_tgt.revision = t.dataset_schema_revision THEN RAISE EXCEPTION 'table is already bound to the target revision' USING ERRCODE='23514'; END IF;
  -- Additive check: every active field in the current revision must exist in
  -- the target with the same logical_type. Each revision is a separate
  -- dataset_schemas row, so fields are matched by slug across the two rows.
  SELECT string_agg(c.slug,', ') INTO missing
    FROM api.dataset_schema_fields c
    WHERE c.schema_id=s_cur.id AND c.lifecycle='active'
      AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_fields g WHERE g.schema_id=s_tgt.id AND g.slug=c.slug AND g.lifecycle='active');
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'target revision is missing active field(s): %', missing USING ERRCODE='23514'; END IF;
  SELECT string_agg(c.slug,', ') INTO type_mismatch
    FROM api.dataset_schema_fields c
    JOIN api.dataset_schema_fields g ON g.schema_id=s_tgt.id AND g.slug=c.slug
    WHERE c.schema_id=s_cur.id AND c.lifecycle='active'
      AND c.logical_type<>g.logical_type;
  IF type_mismatch IS NOT NULL THEN RAISE EXCEPTION 'target revision changes type of field(s): %; create a new sheet or use per-column conversion', type_mismatch USING ERRCODE='23514'; END IF;
  -- Re-bind existing columns to the target revision's field identities (matched
  -- by slug across the two revision rows) and add new physical columns for
  -- target fields that have no current-revision counterpart. Each revision is
  -- a separate dataset_schemas row with its own dataset_schema_fields rows, so
  -- the stable cross-revision key is the slug, not the field id.
  FOR f_tgt IN SELECT * FROM api.dataset_schema_fields WHERE schema_id=s_tgt.id AND lifecycle='active' ORDER BY display_order LOOP
    SELECT sc.id INTO colid FROM api.scientific_columns sc
      JOIN api.dataset_schema_fields cf ON cf.id=sc.dataset_schema_field_id AND cf.schema_id=s_cur.id
      WHERE sc.table_id=t.id AND cf.slug=f_tgt.slug AND sc.lifecycle='active';
    IF colid IS NOT NULL THEN
      UPDATE api.scientific_columns SET dataset_schema_field_id=f_tgt.id, updated_at=now() WHERE id=colid;
    ELSE
      spec := jsonb_build_object('label',f_tgt.label,'logical_type',f_tgt.logical_type,'nullable',f_tgt.nullable,'validation',coalesce(f_tgt.validation,'{}'::jsonb))
        || CASE WHEN f_tgt.default_value IS NULL THEN '{}' ELSE jsonb_build_object('default',f_tgt.default_value) END
        || CASE WHEN f_tgt.unit IS NULL THEN '{}' ELSE jsonb_build_object('unit',f_tgt.unit) END;
      compiled := internal.compile_scientific_column(spec);
      LOOP fn := internal.scientific_name('col_'); EXIT WHEN NOT EXISTS(SELECT 1 FROM api.scientific_columns WHERE field_name=fn); END LOOP;
      colid := gen_random_uuid();
      INSERT INTO api.scientific_columns(id,table_id,workspace_id,field_name,label,description,display_order,logical_type,nullable,default_value,unit,validation,created_by_user_id,created_by_credential_id,dataset_schema_field_id)
        VALUES(colid,t.id,t.workspace_id,fn,f_tgt.label,f_tgt.description,f_tgt.display_order,f_tgt.logical_type,f_tgt.nullable,f_tgt.default_value,f_tgt.unit,coalesce(f_tgt.validation,'{}'),a->>'user_id',(a->>'credential_id')::uuid,f_tgt.id);
      EXECUTE format('ALTER TABLE api.%I ADD COLUMN %I %s%s%s',t.resource_name,fn,compiled->>'storageType',compiled->>'defaultSql',compiled->>'notNullSql');
      FOR chk IN SELECT value#>>'{}' FROM jsonb_array_elements(compiled->'checks') LOOP EXECUTE format('ALTER TABLE api.%I ADD CHECK (%s)',t.resource_name,internal.render_scientific_check(chk::jsonb,fn)); END LOOP;
      EXECUTE format('GRANT INSERT (%I), UPDATE (%I) ON api.%I TO authenticated',fn,fn,t.resource_name);
      added := array_append(added,colid);
    END IF;
  END LOOP;
  UPDATE api.scientific_tables SET dataset_schema_id=s_tgt.id, dataset_schema_revision=p_target_revision, schema_version=schema_version+1, updated_at=now(), updated_by_user_id=a->>'user_id' WHERE id=t.id;
  PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','upgrade_schema','datasetSchemaId',s_tgt.id,'fromRevision',t.dataset_schema_revision,'toRevision',p_target_revision,'addedColumnIds',COALESCE(to_jsonb(added),'[]'::jsonb),'schemaVersion',t.schema_version+1));
  PERFORM pg_notify('pgrst','reload schema');
  RETURN jsonb_build_object('upgraded',true,'tableId',t.id,'fromRevision',t.dataset_schema_revision,'toRevision',p_target_revision,'addedColumnIds',COALESCE(to_jsonb(added),'[]'::jsonb));
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."upgrade_scientific_schema"(uuid,int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."upgrade_scientific_schema"(uuid,int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.query_dataset: cross-sheet typed query by schema id + revision.
-- SECURITY INVOKER: every SELECT is subject to RLS on both the
-- scientific_tables metadata and the generated physical tables, so the caller
-- only ever sees rows in workspaces they are a member of. Projects each
-- physical column (mapped through scientific_columns.dataset_schema_field_id)
-- into a stable JSONB object keyed by field slug. No physical resource_name
-- or field_name is exposed in the result. Single revision only (ADR 0034
-- settled default #2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."query_dataset"(
  p_schema_id uuid,
  p_revision int,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  row_id uuid,
  table_id uuid,
  record_id uuid,
  field_values jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = '' AS $$
DECLARE t api.scientific_tables; sql text := ''; proj text; filt text; col_fn text; field_lt text; st text; filter_slug text; filter_val jsonb; v_lim int; v_off int; skip boolean;
BEGIN
  v_lim := coalesce(p_limit,200); IF v_lim<1 THEN v_lim:=200; END IF; IF v_lim>5000 THEN v_lim:=5000; END IF;
  v_off := coalesce(p_offset,0); IF v_off<0 THEN v_off:=0; END IF;
  IF jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'filters must be an object' USING ERRCODE='22023'; END IF;

  -- Iterate every RLS-visible table bound to (schema_id, revision). RLS on
  -- scientific_tables filters to the caller's workspace, so a cross-workspace
  -- caller sees nothing.
  FOR t IN SELECT * FROM api.scientific_tables WHERE dataset_schema_id=p_schema_id AND dataset_schema_revision=p_revision AND lifecycle='active' LOOP
    -- Projection: build jsonb_build_object(<slug>, <physical_col>, ...) from
    -- the table's column->field mapping. Only fields with a stable identity
    -- are projected; local-only columns are excluded.
    SELECT string_agg(format('%L,%I',field.slug,col.field_name),', ') INTO proj
      FROM api.scientific_columns col
      JOIN api.dataset_schema_fields field ON field.id=col.dataset_schema_field_id AND field.lifecycle='active'
      WHERE col.table_id=t.id AND col.lifecycle='active';
    IF proj IS NULL THEN proj := ''; END IF;

    -- Filters: predicates on stable slugs, resolved to physical columns. If a
    -- filtered slug has no active column in this table, the table emits no rows.
    filt := ''; skip := false;
    FOR filter_slug, filter_val IN SELECT key, value FROM jsonb_each(p_filters) LOOP
      SELECT col2.field_name, field2.logical_type INTO col_fn, field_lt
        FROM api.scientific_columns col2
        JOIN api.dataset_schema_fields field2 ON field2.id=col2.dataset_schema_field_id
        WHERE col2.table_id=t.id AND field2.slug=filter_slug AND col2.lifecycle='active';
      IF col_fn IS NULL THEN skip := true; EXIT; END IF;
      st := internal.scientific_storage_type(field_lt);
      IF jsonb_typeof(filter_val)='object' THEN
        IF filter_val ? 'gte' THEN filt := filt || format(' AND %I >= %L::%s',col_fn,filter_val->>'gte',st); END IF;
        IF filter_val ? 'gt' THEN filt := filt || format(' AND %I > %L::%s',col_fn,filter_val->>'gt',st); END IF;
        IF filter_val ? 'lte' THEN filt := filt || format(' AND %I <= %L::%s',col_fn,filter_val->>'lte',st); END IF;
        IF filter_val ? 'lt' THEN filt := filt || format(' AND %I < %L::%s',col_fn,filter_val->>'lt',st); END IF;
        IF filter_val ? 'eq' THEN filt := filt || format(' AND %I = %L::%s',col_fn,filter_val->>'eq',st); END IF;
      ELSE
        filt := filt || format(' AND %I = %L::%s',col_fn,filter_val#>>'{}',st);
      END IF;
    END LOOP;
    IF skip THEN CONTINUE; END IF;

    IF filt <> '' THEN
      sql := sql || format('SELECT r.id::uuid AS row_id, %L::uuid AS table_id, %L::uuid AS record_id, jsonb_build_object(%s) AS field_values FROM api.%I r WHERE %s',
        t.id, t.record_id, proj, t.resource_name, substring(filt FROM 6));
    ELSE
      sql := sql || format('SELECT r.id::uuid AS row_id, %L::uuid AS table_id, %L::uuid AS record_id, jsonb_build_object(%s) AS field_values FROM api.%I r',
        t.id, t.record_id, proj, t.resource_name);
    END IF;
    sql := sql || ' UNION ALL ';
  END LOOP;

  -- Trim the trailing UNION ALL and wrap with order + limit/offset.
  sql := regexp_replace(sql, ' UNION ALL $', '');
  IF sql = '' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::jsonb WHERE FALSE;
    RETURN;
  END IF;
  sql := 'SELECT * FROM (' || sql || ') q ORDER BY table_id, row_id LIMIT ' || v_lim || ' OFFSET ' || v_off;
  RETURN QUERY EXECUTE sql;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int) TO api_client;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.bind_legacy_sheet: opt-in backfill for an existing unbound sheet.
-- Creates a published revision-1 dataset_schemas row from the sheet's existing
-- scientific_columns and links the table + columns to it. Explicit per-sheet;
-- the live demo database is never auto-disrupted (ADR 0034 settled default #3).
-- Any workspace member may backfill their own sheet (ADR 0034).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."bind_legacy_sheet"(
  p_table_id uuid,
  p_schema_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '' AS $$
DECLARE t api.scientific_tables; a jsonb; sid uuid; v_slug text; col api.scientific_columns; ord int := 0; field_id uuid; base text;
BEGIN
  SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'table not found' USING ERRCODE='P0002'; END IF;
  IF t.dataset_schema_id IS NOT NULL THEN RAISE EXCEPTION 'table is already bound to a dataset schema' USING ERRCODE='23514'; END IF;
  a := internal.assert_scientific_actor(t.workspace_id);
  -- Derive a workspace-unique slug from the sheet name.
  v_slug := lower(regexp_replace(regexp_replace(coalesce(p_schema_name,t.name),'[^a-zA-Z0-9]+','_','g'),'^_|_$','','g'));
  IF v_slug !~ '^[a-z][a-z0-9_]{0,59}$' THEN v_slug := 'legacy_' || substring(replace(t.id::text,'-',''),1,20); END IF;
  LOOP
    IF NOT EXISTS (SELECT 1 FROM api.dataset_schemas ds WHERE ds.workspace_id=t.workspace_id AND ds.slug=v_slug) THEN EXIT; END IF;
    v_slug := v_slug || '_2';
    IF length(v_slug) > 60 THEN v_slug := 'legacy_' || substring(replace(t.id::text,'-',''),1,20); EXIT; END IF;
  END LOOP;
  sid := gen_random_uuid();
  INSERT INTO api.dataset_schemas(id,workspace_id,slug,name,description,revision,status,created_by_user_id)
    VALUES(sid,t.workspace_id,v_slug,coalesce(p_schema_name,t.name),'Backfilled from legacy sheet '||t.name,1,'published',a->>'user_id');
  FOR col IN SELECT * FROM api.scientific_columns WHERE table_id=t.id ORDER BY display_order LOOP
    ord := ord+1;
    base := lower(regexp_replace(regexp_replace(col.label,'[^a-zA-Z0-9]+','_','g'),'^_|_$','','g'));
    IF base !~ '^[a-z][a-z0-9_]{0,59}$' THEN base := 'field_' || ord; END IF;
    -- Ensure slug uniqueness within the new schema.
    LOOP
      IF NOT EXISTS (SELECT 1 FROM api.dataset_schema_fields f WHERE f.schema_id=sid AND f.slug=base) THEN EXIT; END IF;
      base := base || '_2';
    END LOOP;
    field_id := gen_random_uuid();
    INSERT INTO api.dataset_schema_fields(id,schema_id,workspace_id,slug,label,description,display_order,logical_type,nullable,default_value,unit,validation,lifecycle)
      VALUES(field_id,sid,t.workspace_id,base,col.label,col.description,ord,col.logical_type,col.nullable,col.default_value,col.unit,coalesce(col.validation,'{}'),'active');
    UPDATE api.scientific_columns SET dataset_schema_field_id=field_id WHERE id=col.id;
  END LOOP;
  UPDATE api.scientific_tables SET dataset_schema_id=sid, dataset_schema_revision=1, updated_at=now(), updated_by_user_id=a->>'user_id' WHERE id=t.id;
  PERFORM internal.emit_change_event(t.workspace_id,'dataset_schema',sid,'create',NULL,NULL,jsonb_build_object('schemaId',sid,'slug',v_slug,'revision',1,'operation','backfill','tableId',t.id));
  RETURN jsonb_build_object('bound',true,'tableId',t.id,'schemaId',sid,'slug',v_slug,'revision',1);
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."bind_legacy_sheet"(uuid,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."bind_legacy_sheet"(uuid,text) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen api.scientific_table_metadata to include the dataset schema binding
-- (name, slug, revision, latest published revision) so the sheet editor can
-- render the bound-schema badge and the "upgrade available" indicator without
-- a second round-trip. Physical resource_name / field_name are still included
-- for sheet editing (they are never exposed through query_dataset).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.scientific_table_metadata(uuid);
CREATE OR REPLACE FUNCTION api.scientific_table_metadata(p_table_id uuid DEFAULT NULL) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT to_jsonb(t) || jsonb_build_object(
  'columns',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('options',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.display_order) FROM api.scientific_category_options o WHERE o.column_id=c.id AND o.lifecycle='active'),'[]'::jsonb)) ORDER BY c.display_order) FROM api.scientific_columns c WHERE c.table_id=t.id AND c.lifecycle='active'),'[]'::jsonb),
  'relationships','[]'::jsonb,
  'dataset_schema',CASE WHEN t.dataset_schema_id IS NOT NULL THEN (
    SELECT jsonb_build_object(
      'id',ds.id,'slug',ds.slug,'name',ds.name,'revision',ds.revision,'status',ds.status,
      'latest_published_revision',(SELECT max(d2.revision) FROM api.dataset_schemas d2 WHERE d2.workspace_id=ds.workspace_id AND d2.slug=ds.slug AND d2.status='published')
    ) FROM api.dataset_schemas ds WHERE ds.id=t.dataset_schema_id
  ) ELSE NULL END)
 FROM api.scientific_tables t WHERE t.lifecycle='active' AND (p_table_id IS NULL OR t.id=p_table_id) ORDER BY t.created_at,t.id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.scientific_table_metadata(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.scientific_table_metadata(uuid) TO authenticated,api_client;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen api.insert_sheet_block: accept an optional p_dataset_schema_id. When
-- provided, the sheet is created from a published schema revision via
-- instantiate_dataset_schema (bound table + linked columns) instead of an
-- empty ad-hoc table. Omitted preserves the existing ad-hoc behaviour. The
-- block + table creation stays atomic (SECURITY INVOKER wraps DEFINER RPCs).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "api"."insert_sheet_block"(uuid,uuid,int);
CREATE FUNCTION api.insert_sheet_block(
  p_record_id uuid,
  p_after_block_id uuid DEFAULT NULL,
  p_expected_structure_version int DEFAULT NULL,
  p_dataset_schema_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  inserted jsonb;
  created jsonb;
  table_id uuid;
  canonical api.blocks;
BEGIN
  inserted := api.insert_block(
    p_record_id,
    'sheet',
    '{}'::jsonb,
    1,
    p_after_block_id,
    p_expected_structure_version
  );

  IF p_dataset_schema_id IS NOT NULL THEN
    created := api.instantiate_dataset_schema(
      (inserted #>> '{block,id}')::uuid,
      p_dataset_schema_id,
      'Scientific sheet',
      NULL
    );
  ELSE
    created := api.create_scientific_table(
      (inserted #>> '{block,id}')::uuid,
      'Scientific sheet',
      '[]'::jsonb,
      NULL
    );
  END IF;
  table_id := (created #>> '{table,id}')::uuid;

  UPDATE api.blocks
  SET payload = jsonb_build_object('tableId', table_id), updated_at = now()
  WHERE id = (inserted #>> '{block,id}')::uuid
  RETURNING * INTO canonical;

  RETURN jsonb_build_object(
    'block', to_jsonb(canonical),
    'table', created->'table',
    'columns', created->'columns',
    'resourceName', created #>> '{table,resource_name}',
    'structure_version', (inserted->>'structure_version')::int
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."insert_sheet_block"(uuid,uuid,int,uuid) FROM PUBLIC,api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."insert_sheet_block"(uuid,uuid,int,uuid) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
