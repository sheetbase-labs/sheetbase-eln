-- ===========================================================================
-- SCI-011: Dataset schema relationships (decision 0035).
-- Adds typed, directed relationships between dataset schemas, a `reference`
-- logical type, relationship RPCs, a publish-time repoint trigger, and
-- optional reference expansion in query_dataset.
--
-- Reuses internal.assert_scientific_actor, internal.emit_change_event,
-- internal.compile_scientific_column, internal.scientific_storage_type,
-- api.is_workspace_member. SECURITY DEFINER RPCs enforce the create/delete
-- business logic; RLS guards direct PostgREST CRUD. Relationships are
-- slug-level (not revision-level): publish_dataset_schema repoints
-- relationships to the latest published revision.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- New table: api.dataset_schema_relationships
-- ---------------------------------------------------------------------------
CREATE TABLE "api"."dataset_schema_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_schema_id" uuid NOT NULL,
	"target_schema_id" uuid NOT NULL,
	"relationship_type" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"cardinality" text DEFAULT 'one_to_many' NOT NULL,
	"source_field_id" uuid,
	"target_field_id" uuid,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dataset_schema_relationships_type" CHECK ("api"."dataset_schema_relationships"."relationship_type" IN ('references','derives_from','composed_of')),
	CONSTRAINT "chk_dataset_schema_relationships_cardinality" CHECK ("api"."dataset_schema_relationships"."cardinality" IN ('one_to_one','one_to_many','many_to_many')),
	CONSTRAINT "chk_dataset_schema_relationships_lifecycle" CHECK ("api"."dataset_schema_relationships"."lifecycle" IN ('active','inactive')),
	CONSTRAINT "no_self_reference" CHECK ("api"."dataset_schema_relationships"."source_schema_id" <> "api"."dataset_schema_relationships"."target_schema_id")
);--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_source_schema_id_dataset_schemas_id_fk" FOREIGN KEY ("source_schema_id") REFERENCES "api"."dataset_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_target_schema_id_dataset_schemas_id_fk" FOREIGN KEY ("target_schema_id") REFERENCES "api"."dataset_schemas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_source_field_id_dataset_schema_fields_id_fk" FOREIGN KEY ("source_field_id") REFERENCES "api"."dataset_schema_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_target_field_id_dataset_schema_fields_id_fk" FOREIGN KEY ("target_field_id") REFERENCES "api"."dataset_schema_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_relationships" ADD CONSTRAINT "dataset_schema_relationships_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_relationships_workspace" ON "api"."dataset_schema_relationships" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_relationships_source" ON "api"."dataset_schema_relationships" USING btree ("source_schema_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_relationships_target" ON "api"."dataset_schema_relationships" USING btree ("target_schema_id");--> statement-breakpoint
-- One *active* relationship of each type between any two schemas. Soft-deleted
-- (inactive) rows are excluded so a relationship can be recreated after delete.
CREATE UNIQUE INDEX "uq_dataset_schema_relationships_active" ON "api"."dataset_schema_relationships" USING btree ("source_schema_id","target_schema_id","relationship_type") WHERE "api"."dataset_schema_relationships"."lifecycle" = 'active';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS. Members read; members create; owners delete (soft). The SECURITY
-- DEFINER RPCs below enforce the business logic; these policies guard direct
-- PostgREST CRUD.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."dataset_schema_relationships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "api"."dataset_schema_relationships" TO authenticated;--> statement-breakpoint
GRANT SELECT ON "api"."dataset_schema_relationships" TO api_client;--> statement-breakpoint

CREATE POLICY "dataset_schema_relationships_select" ON "api"."dataset_schema_relationships"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "dataset_schema_relationships_select_api_client" ON "api"."dataset_schema_relationships"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schema_relationships_insert" ON "api"."dataset_schema_relationships"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "dataset_schema_relationships_update" ON "api"."dataset_schema_relationships"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "dataset_schema_relationships_delete" ON "api"."dataset_schema_relationships"
  FOR DELETE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id",'owner'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen the change-event entity vocabulary for relationship events.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type" CHECK ("api"."change_events"."entity_type" IN ('project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen the logical-type vocabulary: add `reference` (physical storage uuid,
-- same as category). Update both check constraints and the storage/compile
-- helpers.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."dataset_schema_fields" DROP CONSTRAINT "chk_dataset_schema_fields_type";--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_fields" ADD CONSTRAINT "chk_dataset_schema_fields_type" CHECK ("api"."dataset_schema_fields"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category','reference'));--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" DROP CONSTRAINT "chk_scientific_columns_type";--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "chk_scientific_columns_type" CHECK ("api"."scientific_columns"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category','reference'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Extend internal.scientific_storage_type: reference -> uuid (same as category).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.scientific_storage_type(p_type text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 RETURN CASE p_type WHEN 'text' THEN 'text' WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE NULL END;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Extend internal.compile_scientific_column: accept `reference`. It has no
-- validation rules (like boolean) and its default is a uuid (like category).
-- The allowed-member set and options check are unchanged: `options` stays
-- category-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.compile_scientific_column(p_spec jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE typ text; v jsonb; d jsonb; st text; def text:=''; checks text[]:=ARRAY[]::text[]; n numeric; lo numeric; hi numeric; prec int; scale int; pat text; nullable boolean;
BEGIN
 IF jsonb_typeof(p_spec)<>'object' OR p_spec - ARRAY['label','description','logical_type','nullable','default','unit','validation','width','options'] <> '{}'::jsonb THEN RAISE EXCEPTION 'unknown column specification member' USING ERRCODE='22023'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_each(p_spec) x WHERE x.value='null'::jsonb) THEN RAISE EXCEPTION 'supplied values cannot be JSON null' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(p_spec->'label')<>'string' OR jsonb_typeof(p_spec->'logical_type')<>'string' OR (p_spec ? 'description' AND jsonb_typeof(p_spec->'description')<>'string') OR (p_spec ? 'width' AND jsonb_typeof(p_spec->'width')<>'number') THEN RAISE EXCEPTION 'invalid column primitive type' USING ERRCODE='22023'; END IF;
 typ:=p_spec->>'logical_type'; st:=internal.scientific_storage_type(typ); IF st IS NULL OR NULLIF(p_spec->>'label','') IS NULL THEN RAISE EXCEPTION 'label and supported logical_type are required' USING ERRCODE='22023'; END IF;
 IF p_spec ? 'nullable' AND jsonb_typeof(p_spec->'nullable')<>'boolean' THEN RAISE EXCEPTION 'nullable must be boolean' USING ERRCODE='22023'; END IF; nullable:=coalesce((p_spec->>'nullable')::boolean,true);
 v:=coalesce(p_spec->'validation','{}'); IF jsonb_typeof(v)<>'object' THEN RAISE EXCEPTION 'validation must be an object' USING ERRCODE='22023'; END IF;
 IF p_spec ? 'options' AND typ<>'category' THEN RAISE EXCEPTION 'options are only valid for category' USING ERRCODE='22023'; END IF;
 IF p_spec ? 'unit' AND (jsonb_typeof(p_spec->'unit')<>'object' OR jsonb_typeof(p_spec->'unit'->'code')<>'string' OR jsonb_typeof(p_spec->'unit'->'symbol')<>'string' OR NULLIF(p_spec->'unit'->>'code','') IS NULL OR NULLIF(p_spec->'unit'->>'symbol','') IS NULL OR (p_spec->'unit') - ARRAY['code','symbol','quantity','vocabulary'] <> '{}'::jsonb OR typ NOT IN ('integer','decimal')) THEN RAISE EXCEPTION 'invalid unit' USING ERRCODE='22023'; END IF;
 IF typ='decimal' THEN
   IF v - ARRAY['min','max','exclusiveMin','exclusiveMax','precision','scale'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid decimal validation' USING ERRCODE='22023'; END IF;
   IF v ? 'precision' THEN IF jsonb_typeof(v->'precision')<>'number' OR (v->>'precision')::numeric<>trunc((v->>'precision')::numeric) THEN RAISE EXCEPTION 'precision must be an integer' USING ERRCODE='22023'; END IF; prec:=(v->>'precision')::int; IF prec<1 OR prec>1000 THEN RAISE EXCEPTION 'invalid precision' USING ERRCODE='22023'; END IF; END IF;
   IF v ? 'scale' THEN IF jsonb_typeof(v->'scale')<>'number' OR (v->>'scale')::numeric<>trunc((v->>'scale')::numeric) THEN RAISE EXCEPTION 'scale must be an integer' USING ERRCODE='22023'; END IF; scale:=(v->>'scale')::int; IF scale<0 OR prec IS NULL OR scale>prec THEN RAISE EXCEPTION 'invalid scale' USING ERRCODE='22023'; END IF; END IF;
   IF prec IS NOT NULL THEN st:=format('numeric(%s,%s)',prec,coalesce(scale,0)); END IF;
   checks:=array_append(checks,jsonb_build_object('kind','finite')::text);
 ELSIF typ='integer' THEN IF v - ARRAY['min','max','exclusiveMin','exclusiveMax'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid integer validation' USING ERRCODE='22023'; END IF;
 ELSIF typ='text' THEN
   IF v - ARRAY['minLength','maxLength','regex'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid text validation' USING ERRCODE='22023'; END IF;
   IF v ? 'minLength' THEN checks:=array_append(checks,jsonb_build_object('kind','minLength','value',(v->>'minLength')::int)::text); END IF;
   IF v ? 'maxLength' THEN checks:=array_append(checks,jsonb_build_object('kind','maxLength','value',(v->>'maxLength')::int)::text); END IF;
   IF (v ? 'minLength' AND (v->>'minLength')::int<0) OR (v ? 'maxLength' AND (v->>'maxLength')::int<0) OR (v ? 'minLength' AND v ? 'maxLength' AND (v->>'minLength')::int>(v->>'maxLength')::int) THEN RAISE EXCEPTION 'invalid text lengths' USING ERRCODE='22023'; END IF;
   IF v ? 'regex' THEN IF jsonb_typeof(v->'regex')<>'string' THEN RAISE EXCEPTION 'regex must be string' USING ERRCODE='22023'; END IF; pat:=v->>'regex'; IF left(pat,1)<>'^' OR right(pat,1)<>'$' THEN RAISE EXCEPTION 'regex must be anchored' USING ERRCODE='22023'; END IF; BEGIN PERFORM '' ~ pat; EXCEPTION WHEN invalid_regular_expression THEN RAISE EXCEPTION 'invalid regex' USING ERRCODE='22023'; END; checks:=array_append(checks,jsonb_build_object('kind','regex','value',pat)::text); END IF;
 ELSIF typ='date' THEN IF v - ARRAY['earliest','latest'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid date validation' USING ERRCODE='22023'; END IF;
 ELSIF typ='timestamp' THEN IF v - ARRAY['earliest','latest'] <> '{}'::jsonb THEN RAISE EXCEPTION 'invalid timestamp validation' USING ERRCODE='22023'; END IF;
 ELSE IF v<>'{}'::jsonb THEN RAISE EXCEPTION 'validation is not supported for this type' USING ERRCODE='22023'; END IF; END IF;
 IF typ IN ('integer','decimal') THEN
   IF (v ? 'min' AND v ? 'exclusiveMin') OR (v ? 'max' AND v ? 'exclusiveMax') THEN RAISE EXCEPTION 'contradictory numeric bounds' USING ERRCODE='22023'; END IF;
   FOREACH pat IN ARRAY ARRAY['min','max','exclusiveMin','exclusiveMax'] LOOP IF v ? pat THEN IF jsonb_typeof(v->pat)<>'number' THEN RAISE EXCEPTION 'numeric bound must be number' USING ERRCODE='22023'; END IF; n:=(v->>pat)::numeric; checks:=array_append(checks,jsonb_build_object('kind',pat,'value',n)::text); END IF; END LOOP;
   lo:=coalesce((v->>'min')::numeric,(v->>'exclusiveMin')::numeric); hi:=coalesce((v->>'max')::numeric,(v->>'exclusiveMax')::numeric); IF lo IS NOT NULL AND hi IS NOT NULL AND (lo>hi OR (lo=hi AND (v ? 'exclusiveMin' OR v ? 'exclusiveMax'))) THEN RAISE EXCEPTION 'invalid numeric bounds' USING ERRCODE='22023'; END IF;
 ELSIF typ IN ('date','timestamp') THEN
   IF v ? 'earliest' THEN checks:=array_append(checks,jsonb_build_object('kind','earliest','value',v->>'earliest','type',st)::text); END IF; IF v ? 'latest' THEN checks:=array_append(checks,jsonb_build_object('kind','latest','value',v->>'latest','type',st)::text); END IF;
   BEGIN IF typ='date' THEN PERFORM (v->>'earliest')::date; PERFORM (v->>'latest')::date; IF v ? 'earliest' AND v ? 'latest' AND (v->>'earliest')::date>(v->>'latest')::date THEN RAISE EXCEPTION 'earliest must not exceed latest' USING ERRCODE='22023'; END IF; ELSE PERFORM (v->>'earliest')::timestamptz; PERFORM (v->>'latest')::timestamptz; IF v ? 'earliest' AND v ? 'latest' AND (v->>'earliest')::timestamptz>(v->>'latest')::timestamptz THEN RAISE EXCEPTION 'earliest must not exceed latest' USING ERRCODE='22023'; END IF; END IF; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid temporal bound' USING ERRCODE='22023'; END;
 END IF;
 d:=p_spec->'default'; IF p_spec ? 'default' AND d<>'null'::jsonb THEN
   IF typ='timestamp' AND d='"now"'::jsonb THEN def:=' DEFAULT now()';
   ELSIF typ='text' AND jsonb_typeof(d)='string' THEN def:=format(' DEFAULT %L::text',d#>>'{}');
   ELSIF typ='integer' AND jsonb_typeof(d)='number' AND (d#>>'{}')::numeric=trunc((d#>>'{}')::numeric) THEN def:=format(' DEFAULT %L::bigint',d#>>'{}');
   ELSIF typ='decimal' AND jsonb_typeof(d)='number' THEN def:=format(' DEFAULT %L::%s',d#>>'{}',st);
   ELSIF typ='boolean' AND jsonb_typeof(d)='boolean' THEN def:=format(' DEFAULT %L::boolean',d#>>'{}');
   ELSIF typ='date' AND jsonb_typeof(d)='string' THEN BEGIN PERFORM (d#>>'{}')::date; def:=format(' DEFAULT %L::date',d#>>'{}'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid date default' USING ERRCODE='22023'; END;
   ELSIF typ='timestamp' AND jsonb_typeof(d)='string' THEN BEGIN PERFORM (d#>>'{}')::timestamptz; def:=format(' DEFAULT %L::timestamptz',d#>>'{}'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid timestamp default' USING ERRCODE='22023'; END;
   ELSIF typ IN ('category','reference') AND jsonb_typeof(d)='string' THEN BEGIN PERFORM (d#>>'{}')::uuid; def:=format(' DEFAULT %L::uuid',d#>>'{}'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid % default', typ USING ERRCODE='22023'; END;
   ELSE RAISE EXCEPTION 'default does not match logical type' USING ERRCODE='22023'; END IF;
   IF typ='timestamp' AND d='"now"'::jsonb AND (v ? 'latest' OR (v ? 'earliest' AND (v->>'earliest')::timestamptz>now())) THEN RAISE EXCEPTION 'now default cannot guarantee fixed temporal bounds' USING ERRCODE='22023'; END IF;
   IF typ='text' AND ((v ? 'minLength' AND length(d#>>'{}')<(v->>'minLength')::int) OR (v ? 'maxLength' AND length(d#>>'{}')>(v->>'maxLength')::int) OR (v ? 'regex' AND NOT (d#>>'{}' ~ (v->>'regex')))) THEN RAISE EXCEPTION 'default violates text validation' USING ERRCODE='23514'; END IF;
   IF typ IN ('integer','decimal') THEN n:=(d#>>'{}')::numeric; IF n IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR (v ? 'min' AND n<(v->>'min')::numeric) OR (v ? 'max' AND n>(v->>'max')::numeric) OR (v ? 'exclusiveMin' AND n<=(v->>'exclusiveMin')::numeric) OR (v ? 'exclusiveMax' AND n>=(v->>'exclusiveMax')::numeric) THEN RAISE EXCEPTION 'default violates numeric validation' USING ERRCODE='23514'; END IF; END IF;
   IF typ='date' AND ((v ? 'earliest' AND (d#>>'{}')::date<(v->>'earliest')::date) OR (v ? 'latest' AND (d#>>'{}')::date>(v->>'latest')::date)) THEN RAISE EXCEPTION 'default violates date validation' USING ERRCODE='23514'; END IF;
   IF typ='timestamp' AND d<>'"now"'::jsonb AND ((v ? 'earliest' AND (d#>>'{}')::timestamptz<(v->>'earliest')::timestamptz) OR (v ? 'latest' AND (d#>>'{}')::timestamptz>(v->>'latest')::timestamptz)) THEN RAISE EXCEPTION 'default violates timestamp validation' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN jsonb_build_object('storageType',st,'defaultSql',def,'notNullSql',CASE WHEN nullable THEN '' ELSE ' NOT NULL' END,'checks',to_jsonb(checks));
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.compile_scientific_column(jsonb) FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- internal.expand_reference_fields: resolve reference UUIDs in a field_values
-- object into nested {referenced_table_id,referenced_record_id,referenced_fields}
-- objects. SECURITY INVOKER: every SELECT is RLS-filtered. Max depth 2.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.expand_reference_fields(
  p_schema_id uuid,
  p_field_values jsonb,
  p_expand jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_slug text; v_opts jsonb; v_depth int;
  field api.dataset_schema_fields; rel api.dataset_schema_relationships;
  target api.dataset_schemas; ref_id uuid; ref_val text;
  t api.scientific_tables; proj text; row_json jsonb;
  nested_expand jsonb; expanded_val jsonb;
BEGIN
  IF p_expand IS NULL OR jsonb_typeof(p_expand) <> 'object' OR p_expand = '{}'::jsonb THEN
    RETURN p_field_values;
  END IF;
  FOR v_slug, v_opts IN SELECT key, value FROM jsonb_each(p_expand) LOOP
    SELECT * INTO field FROM api.dataset_schema_fields AS f
      WHERE f.schema_id = p_schema_id AND f.slug = v_slug AND f.logical_type = 'reference' AND f.lifecycle = 'active';
    IF field.id IS NULL THEN CONTINUE; END IF;
    v_depth := LEAST(2, GREATEST(1, COALESCE((v_opts->>'depth')::int, 1)));
    ref_val := p_field_values ->> v_slug;
    IF ref_val IS NULL THEN CONTINUE; END IF;
    BEGIN ref_id := ref_val::uuid; EXCEPTION WHEN others THEN CONTINUE; END;
    SELECT * INTO rel FROM api.dataset_schema_relationships AS r
      WHERE r.source_schema_id = p_schema_id AND r.source_field_id = field.id
        AND r.relationship_type = 'references' AND r.lifecycle = 'active'
      LIMIT 1;
    IF rel.target_schema_id IS NULL THEN CONTINUE; END IF;
    SELECT * INTO target FROM api.dataset_schemas AS ds WHERE ds.id = rel.target_schema_id;
    IF target.id IS NULL THEN CONTINUE; END IF;
    row_json := NULL;
    FOR t IN SELECT * FROM api.scientific_tables AS st
               WHERE st.dataset_schema_id = target.id
                 AND st.dataset_schema_revision = target.revision
                 AND st.lifecycle = 'active' LOOP
      SELECT string_agg(format('%L,%I', f.slug, c.field_name), ', ') INTO proj
        FROM api.scientific_columns c
        JOIN api.dataset_schema_fields f ON f.id = c.dataset_schema_field_id AND f.lifecycle = 'active'
        WHERE c.table_id = t.id AND c.lifecycle = 'active';
      IF proj IS NULL THEN CONTINUE; END IF;
      BEGIN
        EXECUTE format('SELECT jsonb_build_object(%s) FROM api.%I WHERE id = %L', proj, t.resource_name, ref_id) INTO row_json;
      EXCEPTION WHEN others THEN row_json := NULL; END;
      IF row_json IS NOT NULL THEN
        EXIT;
      END IF;
    END LOOP;
    IF row_json IS NULL THEN CONTINUE; END IF;
    IF v_depth > 1 THEN
      SELECT COALESCE(jsonb_object_agg(f.slug, jsonb_build_object('depth', v_depth - 1)), '{}'::jsonb) INTO nested_expand
        FROM api.dataset_schema_fields f
        WHERE f.schema_id = target.id AND f.logical_type = 'reference' AND f.lifecycle = 'active';
      row_json := internal.expand_reference_fields(target.id, row_json, nested_expand);
    END IF;
    expanded_val := jsonb_build_object('referenced_table_id', t.id, 'referenced_record_id', t.record_id, 'referenced_fields', row_json);
    p_field_values := jsonb_set(p_field_values, ARRAY[v_slug], expanded_val);
  END LOOP;
  RETURN p_field_values;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.expand_reference_fields(uuid, jsonb, jsonb) TO authenticated, api_client;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.create_schema_relationship: create a typed relationship between two
-- schemas. Any workspace member may create (ADR 0035 permission table).
-- Validates same workspace, no self-reference, no duplicate active, field
-- ownership. Returns the created relationship row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.create_schema_relationship(
  p_source_schema_id uuid,
  p_target_schema_id uuid,
  p_relationship_type text,
  p_label text DEFAULT '',
  p_cardinality text DEFAULT 'one_to_many',
  p_source_field_id uuid DEFAULT NULL,
  p_target_field_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ws uuid := api.current_workspace_id(); a jsonb; rid uuid := gen_random_uuid();
  src api.dataset_schemas; tgt api.dataset_schemas;
BEGIN
  IF ws IS NULL THEN RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE='42804'; END IF;
  a := internal.assert_scientific_actor(ws);
  IF p_relationship_type IS NULL OR p_relationship_type NOT IN ('references','derives_from','composed_of') THEN RAISE EXCEPTION 'relationship_type must be references, derives_from, or composed_of' USING ERRCODE='22023'; END IF;
  IF p_cardinality IS NULL OR p_cardinality NOT IN ('one_to_one','one_to_many','many_to_many') THEN RAISE EXCEPTION 'cardinality must be one_to_one, one_to_many, or many_to_many' USING ERRCODE='22023'; END IF;
  SELECT * INTO src FROM api.dataset_schemas WHERE id = p_source_schema_id;
  SELECT * INTO tgt FROM api.dataset_schemas WHERE id = p_target_schema_id;
  IF src.id IS NULL OR tgt.id IS NULL THEN RAISE EXCEPTION 'schema not found' USING ERRCODE='P0002'; END IF;
  IF src.workspace_id <> ws OR tgt.workspace_id <> ws THEN RAISE EXCEPTION 'both schemas must be in the caller''s workspace' USING ERRCODE='42501'; END IF;
  IF src.id = tgt.id OR src.slug = tgt.slug THEN RAISE EXCEPTION 'self-referential relationships are not allowed' USING ERRCODE='23514'; END IF;
  IF src.status <> 'published' AND tgt.status <> 'published' THEN RAISE EXCEPTION 'at least one schema must be published' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM api.dataset_schema_relationships WHERE source_schema_id = src.id AND target_schema_id = tgt.id AND relationship_type = p_relationship_type AND lifecycle = 'active') THEN RAISE EXCEPTION 'an active relationship of this type already exists between these schemas' USING ERRCODE='23514'; END IF;
  IF p_source_field_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_fields WHERE id = p_source_field_id AND schema_id = src.id) THEN RAISE EXCEPTION 'source_field_id does not belong to the source schema' USING ERRCODE='23514'; END IF;
  IF p_target_field_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.dataset_schema_fields WHERE id = p_target_field_id AND schema_id = tgt.id) THEN RAISE EXCEPTION 'target_field_id does not belong to the target schema' USING ERRCODE='23514'; END IF;
  INSERT INTO api.dataset_schema_relationships(id, workspace_id, source_schema_id, target_schema_id, relationship_type, label, cardinality, source_field_id, target_field_id, lifecycle, created_by_user_id)
    VALUES (rid, ws, src.id, tgt.id, p_relationship_type, COALESCE(p_label,''), p_cardinality, p_source_field_id, p_target_field_id, 'active', a->>'user_id');
  PERFORM internal.emit_change_event(ws, 'dataset_schema_relationship', rid, 'create', NULL, NULL, jsonb_build_object('relationshipId', rid, 'sourceSchemaId', src.id, 'targetSchemaId', tgt.id, 'relationshipType', p_relationship_type));
  RETURN (SELECT to_jsonb(r) FROM api.dataset_schema_relationships r WHERE id = rid);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_schema_relationship(uuid,uuid,text,text,text,uuid,uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_schema_relationship(uuid,uuid,text,text,text,uuid,uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.delete_schema_relationship: soft delete (lifecycle=inactive). Owner-only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.delete_schema_relationship(p_relationship_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r api.dataset_schema_relationships; a jsonb;
BEGIN
  SELECT * INTO r FROM api.dataset_schema_relationships WHERE id = p_relationship_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'relationship not found' USING ERRCODE='P0002'; END IF;
  a := internal.assert_scientific_actor(r.workspace_id);
  IF NOT api.is_workspace_member(r.workspace_id, 'owner') THEN RAISE EXCEPTION 'only a workspace owner may delete a schema relationship' USING ERRCODE='42501'; END IF;
  IF r.lifecycle = 'inactive' THEN RAISE EXCEPTION 'relationship is already inactive' USING ERRCODE='23514'; END IF;
  UPDATE api.dataset_schema_relationships SET lifecycle = 'inactive', updated_at = now() WHERE id = r.id;
  PERFORM internal.emit_change_event(r.workspace_id, 'dataset_schema_relationship', r.id, 'update', NULL, NULL, jsonb_build_object('relationshipId', r.id, 'lifecycle', 'inactive'));
  RETURN jsonb_build_object('deleted', true, 'relationshipId', r.id);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.delete_schema_relationship(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_schema_relationship(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Replace publish_dataset_schema: repoint relationships from the retired
-- revision to the newly published revision (slug-level, not revision-level).
-- Field ids are remapped by slug so source_field_id/target_field_id stay
-- consistent with the new revision's field identities.
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
  -- Retire any previously-published revision of the same slug and repoint
  -- relationships to the newly published revision.
  FOR prior IN SELECT * FROM api.dataset_schemas WHERE workspace_id=s.workspace_id AND slug=s.slug AND status='published' AND id<>s.id LOOP
    UPDATE api.dataset_schemas SET status='retired' WHERE id=prior.id;
    -- Repoint relationships where the retired revision was the source.
    UPDATE api.dataset_schema_relationships
      SET source_schema_id = s.id,
          source_field_id = CASE WHEN source_field_id IS NOT NULL THEN (
            SELECT nf.id FROM api.dataset_schema_fields nf
            WHERE nf.schema_id = s.id AND nf.slug = (
              SELECT of.slug FROM api.dataset_schema_fields of WHERE of.id = dataset_schema_relationships.source_field_id
            ) LIMIT 1
          ) END,
          updated_at = now()
      WHERE source_schema_id = prior.id AND lifecycle = 'active';
    -- Repoint relationships where the retired revision was the target.
    UPDATE api.dataset_schema_relationships
      SET target_schema_id = s.id,
          target_field_id = CASE WHEN target_field_id IS NOT NULL THEN (
            SELECT nf.id FROM api.dataset_schema_fields nf
            WHERE nf.schema_id = s.id AND nf.slug = (
              SELECT of.slug FROM api.dataset_schema_fields of WHERE of.id = dataset_schema_relationships.target_field_id
            ) LIMIT 1
          ) END,
          updated_at = now()
      WHERE target_schema_id = prior.id AND lifecycle = 'active';
    PERFORM internal.emit_change_event(s.workspace_id,'dataset_schema',prior.id,'update',NULL,NULL,jsonb_build_object('schemaId',prior.id,'slug',prior.slug,'status','retired','supersededBy',s.id));
  END LOOP;
  UPDATE api.dataset_schemas SET status='published' WHERE id=s.id;
  PERFORM internal.emit_change_event(s.workspace_id,'dataset_schema',s.id,'update',NULL,NULL,jsonb_build_object('schemaId',s.id,'slug',s.slug,'revision',s.revision,'status','published'));
  RETURN jsonb_build_object('published',true,'schemaId',s.id,'revision',s.revision);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."publish_dataset_schema"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."publish_dataset_schema"(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Replace query_dataset: add optional p_expand for reference field expansion
-- (max depth 2). Without p_expand the behaviour is unchanged (bare UUIDs).
-- The signature changes (new p_expand arg), so DROP the old one first.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "api"."query_dataset"(uuid,int,jsonb,int,int);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "api"."query_dataset"(
  p_schema_id uuid,
  p_revision int,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0,
  p_expand jsonb DEFAULT '{}'::jsonb
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
DECLARE t api.scientific_tables; sql text := ''; proj text; filt text; col_fn text; field_lt text; st text; filter_slug text; filter_val jsonb; v_lim int; v_off int; skip boolean; do_expand boolean; r RECORD;
BEGIN
  v_lim := coalesce(p_limit,200); IF v_lim<1 THEN v_lim:=200; END IF; IF v_lim>5000 THEN v_lim:=5000; END IF;
  v_off := coalesce(p_offset,0); IF v_off<0 THEN v_off:=0; END IF;
  IF jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'filters must be an object' USING ERRCODE='22023'; END IF;
  IF p_expand IS NULL THEN p_expand := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_expand)<>'object' THEN RAISE EXCEPTION 'expand must be an object' USING ERRCODE='22023'; END IF;
  do_expand := p_expand <> '{}'::jsonb;

  FOR t IN SELECT * FROM api.scientific_tables WHERE dataset_schema_id=p_schema_id AND dataset_schema_revision=p_revision AND lifecycle='active' LOOP
    SELECT string_agg(format('%L,%I',field.slug,col.field_name),', ') INTO proj
      FROM api.scientific_columns col
      JOIN api.dataset_schema_fields field ON field.id=col.dataset_schema_field_id AND field.lifecycle='active'
      WHERE col.table_id=t.id AND col.lifecycle='active';
    IF proj IS NULL THEN proj := ''; END IF;

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

  sql := regexp_replace(sql, ' UNION ALL $', '');
  IF sql = '' THEN
    RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::uuid, NULL::jsonb WHERE FALSE;
    RETURN;
  END IF;
  sql := 'SELECT * FROM (' || sql || ') q ORDER BY table_id, row_id LIMIT ' || v_lim || ' OFFSET ' || v_off;

  IF NOT do_expand THEN
    RETURN QUERY EXECUTE sql;
    RETURN;
  END IF;

  -- Expansion path: collect base rows, resolve reference fields, then return.
  CREATE TEMP TABLE _qd_rows (row_id uuid, table_id uuid, record_id uuid, field_values jsonb) ON COMMIT DROP;
  EXECUTE 'INSERT INTO _qd_rows ' || sql;
  FOR r IN SELECT * FROM _qd_rows LOOP
    UPDATE _qd_rows AS q SET field_values = internal.expand_reference_fields(p_schema_id, r.field_values, p_expand)
      WHERE q.row_id = r.row_id AND q.table_id = r.table_id;
  END LOOP;
  RETURN QUERY SELECT q.row_id, q.table_id, q.record_id, q.field_values FROM _qd_rows q ORDER BY q.table_id, q.row_id;
  DROP TABLE _qd_rows;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int,jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int,jsonb) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."query_dataset"(uuid,int,jsonb,int,int,jsonb) TO api_client;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
