CREATE TABLE "api"."scientific_category_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"column_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"display_order" integer NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_scientific_category_options_order" UNIQUE("column_id","display_order"),
	CONSTRAINT "chk_scientific_category_options_lifecycle" CHECK ("api"."scientific_category_options"."lifecycle" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "api"."scientific_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"field_name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"logical_type" text NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"default_value" jsonb,
	"unit" jsonb,
	"validation" jsonb DEFAULT '{}' NOT NULL,
	"width" integer,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_by_credential_id" uuid,
	CONSTRAINT "uq_scientific_columns_table_field" UNIQUE("table_id","field_name"),
	CONSTRAINT "uq_scientific_columns_table_order" UNIQUE("table_id","display_order"),
	CONSTRAINT "chk_scientific_columns_field_name" CHECK ("api"."scientific_columns"."field_name" ~ '^col_[a-z2-7]{26}$'),
	CONSTRAINT "chk_scientific_columns_type" CHECK ("api"."scientific_columns"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category')),
	CONSTRAINT "chk_scientific_columns_lifecycle" CHECK ("api"."scientific_columns"."lifecycle" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "api"."scientific_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"resource_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"display_settings" jsonb DEFAULT '{}' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"created_by_credential_id" uuid,
	"updated_by_user_id" text,
	"updated_by_credential_id" uuid,
	CONSTRAINT "scientific_tables_block_id_unique" UNIQUE("block_id"),
	CONSTRAINT "scientific_tables_resource_name_unique" UNIQUE("resource_name"),
	CONSTRAINT "chk_scientific_tables_resource_name" CHECK ("api"."scientific_tables"."resource_name" ~ '^sheet_[a-z2-7]{26}$'),
	CONSTRAINT "chk_scientific_tables_lifecycle" CHECK ("api"."scientific_tables"."lifecycle" IN ('active', 'retired')),
	CONSTRAINT "chk_scientific_tables_schema_version" CHECK ("api"."scientific_tables"."schema_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."blocks" DROP CONSTRAINT "chk_blocks_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD COLUMN "actor_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."scientific_category_options" ADD CONSTRAINT "scientific_category_options_column_id_scientific_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "api"."scientific_columns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_category_options" ADD CONSTRAINT "scientific_category_options_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "scientific_columns_table_id_scientific_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "api"."scientific_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "scientific_columns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "scientific_columns_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_columns" ADD CONSTRAINT "scientific_columns_created_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("created_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "api"."blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_created_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("created_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."scientific_tables" ADD CONSTRAINT "scientific_tables_updated_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("updated_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_scientific_category_options_column" ON "api"."scientific_category_options" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "idx_scientific_category_options_workspace" ON "api"."scientific_category_options" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_scientific_columns_table" ON "api"."scientific_columns" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "idx_scientific_columns_workspace" ON "api"."scientific_columns" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_scientific_tables_workspace" ON "api"."scientific_tables" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_scientific_tables_record" ON "api"."scientific_tables" USING btree ("record_id");--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "change_events_actor_credential_id_api_credentials_id_fk" FOREIGN KEY ("actor_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "chk_blocks_type" CHECK ("api"."blocks"."type" IN ('heading', 'rich_text', 'checklist', 'linked_record', 'list', 'callout', 'table', 'sheet', 'chart', 'plate_map', 'file', 'metric', 'procedure_step'));--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type" CHECK ("api"."change_events"."entity_type" IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation'));
--> statement-breakpoint

-- DATA-002 controlled generated-resource surface. All executable identifiers
-- are generated here; labels and JSON metadata are never interpolated as SQL.
CREATE OR REPLACE FUNCTION internal.scientific_name(p_prefix text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE bits bit(130); alphabet constant text := 'abcdefghijklmnopqrstuvwxyz234567'; out text := p_prefix; i int;
BEGIN
  IF p_prefix NOT IN ('sheet_', 'col_') THEN RAISE EXCEPTION 'invalid generated-name prefix' USING ERRCODE='22023'; END IF;
  bits := (('x' || replace(gen_random_uuid()::text,'-',''))::bit(128)::text || '00')::bit(130);
  FOR i IN 0..25 LOOP out := out || substr(alphabet, substring(bits from i*5+1 for 5)::int+1, 1); END LOOP;
  RETURN out;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.scientific_name(text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.assert_scientific_actor(p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb := api.claim_probe(); uid text; cid uuid;
BEGIN
  IF c IS NULL OR (c->>'workspace_id')::uuid IS DISTINCT FROM p_workspace THEN RAISE EXCEPTION 'workspace denied' USING ERRCODE='42501'; END IF;
  uid := c->>'sub'; cid := NULLIF(c->>'credential_id','')::uuid;
  IF uid IS NULL AND cid IS NULL THEN RAISE EXCEPTION 'actor required' USING ERRCODE='42501'; END IF;
  IF uid IS NULL OR cid IS NOT NULL OR NOT api.is_workspace_member(p_workspace) THEN RAISE EXCEPTION 'authenticated membership required' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('user_id',uid,'credential_id',cid);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.assert_scientific_actor(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.scientific_storage_type(p_type text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 RETURN CASE p_type WHEN 'text' THEN 'text' WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' ELSE NULL END;
END $$;
--> statement-breakpoint

-- The single compiler for initial and subsequently-added columns. It accepts
-- declarative JSON only and returns server-authored DDL fragments.
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
   ELSIF typ='category' AND jsonb_typeof(d)='string' THEN BEGIN PERFORM (d#>>'{}')::uuid; def:=format(' DEFAULT %L::uuid',d#>>'{}'); EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid category default' USING ERRCODE='22023'; END;
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
REVOKE EXECUTE ON FUNCTION internal.compile_scientific_column(jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Check descriptors are data, never format strings. Each descriptor is
-- rendered exactly once with separately quoted identifier and literal slots.
CREATE OR REPLACE FUNCTION internal.render_scientific_check(p_check jsonb,p_field text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 RETURN CASE p_check->>'kind'
  WHEN 'finite' THEN format('%I <> %L::numeric AND %I <> %L::numeric AND %I <> %L::numeric',p_field,'NaN',p_field,'Infinity',p_field,'-Infinity')
  WHEN 'minLength' THEN format('length(%I) >= %L::integer',p_field,p_check->>'value')
  WHEN 'maxLength' THEN format('length(%I) <= %L::integer',p_field,p_check->>'value')
  WHEN 'regex' THEN format('%I ~ %L',p_field,p_check->>'value')
  WHEN 'min' THEN format('%I >= %L::numeric',p_field,p_check->>'value')
  WHEN 'max' THEN format('%I <= %L::numeric',p_field,p_check->>'value')
  WHEN 'exclusiveMin' THEN format('%I > %L::numeric',p_field,p_check->>'value')
  WHEN 'exclusiveMax' THEN format('%I < %L::numeric',p_field,p_check->>'value')
  WHEN 'earliest' THEN format('%I >= %L::%s',p_field,p_check->>'value',CASE p_check->>'type' WHEN 'date' THEN 'date' ELSE 'timestamptz' END)
  WHEN 'latest' THEN format('%I <= %L::%s',p_field,p_check->>'value',CASE p_check->>'type' WHEN 'date' THEN 'date' ELSE 'timestamptz' END)
  ELSE NULL END;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.render_scientific_check(jsonb,text) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.guard_scientific_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 IF TG_TABLE_NAME='scientific_tables' AND (to_jsonb(NEW)->'resource_name' IS DISTINCT FROM to_jsonb(OLD)->'resource_name' OR to_jsonb(NEW)->'workspace_id' IS DISTINCT FROM to_jsonb(OLD)->'workspace_id' OR to_jsonb(NEW)->'record_id' IS DISTINCT FROM to_jsonb(OLD)->'record_id' OR to_jsonb(NEW)->'block_id' IS DISTINCT FROM to_jsonb(OLD)->'block_id') THEN RAISE EXCEPTION 'scientific resource identity is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='scientific_columns' AND (to_jsonb(NEW)->'field_name' IS DISTINCT FROM to_jsonb(OLD)->'field_name' OR to_jsonb(NEW)->'table_id' IS DISTINCT FROM to_jsonb(OLD)->'table_id' OR to_jsonb(NEW)->'workspace_id' IS DISTINCT FROM to_jsonb(OLD)->'workspace_id') THEN RAISE EXCEPTION 'scientific field identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scientific_tables_immutable BEFORE UPDATE ON api.scientific_tables FOR EACH ROW EXECUTE FUNCTION internal.guard_scientific_metadata();
--> statement-breakpoint
CREATE TRIGGER scientific_columns_immutable BEFORE UPDATE ON api.scientific_columns FOR EACH ROW EXECUTE FUNCTION internal.guard_scientific_metadata();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.guard_scientific_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='scientific_tables' AND NOT EXISTS (SELECT 1 FROM api.blocks b JOIN api.records r ON r.id=b.record_id WHERE b.id=(to_jsonb(NEW)->>'block_id')::uuid AND b.type='sheet' AND b.record_id=(to_jsonb(NEW)->>'record_id')::uuid AND r.workspace_id=(to_jsonb(NEW)->>'workspace_id')::uuid) THEN RAISE EXCEPTION 'sheet block/record/workspace mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='scientific_columns' AND NOT EXISTS (SELECT 1 FROM api.scientific_tables t WHERE t.id=(to_jsonb(NEW)->>'table_id')::uuid AND t.workspace_id=(to_jsonb(NEW)->>'workspace_id')::uuid) THEN RAISE EXCEPTION 'column workspace mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='scientific_category_options' AND NOT EXISTS (SELECT 1 FROM api.scientific_columns c WHERE c.id=(to_jsonb(NEW)->>'column_id')::uuid AND c.workspace_id=(to_jsonb(NEW)->>'workspace_id')::uuid AND c.logical_type='category') THEN RAISE EXCEPTION 'category workspace/type mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scientific_tables_owner BEFORE INSERT OR UPDATE ON api.scientific_tables FOR EACH ROW EXECUTE FUNCTION internal.guard_scientific_owner();
--> statement-breakpoint
CREATE TRIGGER scientific_columns_owner BEFORE INSERT OR UPDATE ON api.scientific_columns FOR EACH ROW EXECUTE FUNCTION internal.guard_scientific_owner();
--> statement-breakpoint
CREATE TRIGGER scientific_options_owner BEFORE INSERT OR UPDATE ON api.scientific_category_options FOR EACH ROW EXECUTE FUNCTION internal.guard_scientific_owner();
--> statement-breakpoint

-- A block's record and type define its durable identity. In particular, a
-- scientific table relies on its owner remaining a sheet block in the same
-- notebook after creation. Current block operations update payload, order and
-- versions; changing record or type requires an explicit future conversion
-- contract rather than direct CRUD.
CREATE OR REPLACE FUNCTION internal.guard_block_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.record_id IS DISTINCT FROM OLD.record_id OR NEW.type IS DISTINCT FROM OLD.type THEN
   RAISE EXCEPTION 'block record and type are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.guard_block_identity() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER blocks_identity_immutable BEFORE UPDATE ON api.blocks FOR EACH ROW EXECUTE FUNCTION internal.guard_block_identity();
--> statement-breakpoint

ALTER TABLE api.scientific_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.scientific_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.scientific_category_options ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.scientific_tables,api.scientific_columns,api.scientific_category_options TO authenticated;
CREATE POLICY scientific_tables_read ON api.scientific_tables FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY scientific_columns_read ON api.scientific_columns FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY scientific_options_read ON api.scientific_category_options FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint

-- Generic generated-row guards/events. Payload contains identities and changed
-- stable column ids only, never scientific values.
CREATE OR REPLACE FUNCTION internal.scientific_row_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; c jsonb:=api.claim_probe(); col api.scientific_columns;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE resource_name=TG_TABLE_NAME;
 IF TG_OP='DELETE' THEN
   IF cardinality(OLD.formula_column_ids)>0 THEN RAISE EXCEPTION 'rows with formula targets cannot be deleted' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 ELSIF TG_OP='INSERT' THEN NEW.workspace_id:=COALESCE(NEW.workspace_id,api.current_workspace_id()); NEW.created_by_user_id:=c->>'sub'; NEW.created_by_credential_id:=NULLIF(c->>'credential_id','')::uuid;
 ELSE
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_by_credential_id IS DISTINCT FROM OLD.created_by_credential_id OR NEW.formula_column_ids IS DISTINCT FROM OLD.formula_column_ids THEN RAISE EXCEPTION 'reserved row fields are immutable' USING ERRCODE='23514'; END IF;
   NEW.version:=OLD.version+1; NEW.updated_at:=now(); NEW.updated_by_user_id:=c->>'sub'; NEW.updated_by_credential_id:=NULLIF(c->>'credential_id','')::uuid;
 END IF;
 IF NEW.workspace_id<>t.workspace_id THEN RAISE EXCEPTION 'generated row workspace mismatch' USING ERRCODE='23514'; END IF;
 FOR col IN SELECT * FROM api.scientific_columns WHERE table_id=t.id LOOP
   IF col.logical_type='category' AND to_jsonb(NEW)->>col.field_name IS NOT NULL AND (TG_OP='INSERT' OR to_jsonb(NEW)->col.field_name IS DISTINCT FROM to_jsonb(OLD)->col.field_name) AND NOT EXISTS (SELECT 1 FROM api.scientific_category_options o WHERE o.id=(to_jsonb(NEW)->>col.field_name)::uuid AND o.column_id=col.id AND o.workspace_id=t.workspace_id AND o.lifecycle='active') THEN RAISE EXCEPTION 'category option does not belong to active exact column' USING ERRCODE='23514'; END IF;
   IF col.id=ANY(NEW.formula_column_ids) AND to_jsonb(NEW)->col.field_name <> 'null'::jsonb THEN RAISE EXCEPTION 'formula cells cannot contain literals' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.scientific_row_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; rid uuid; ver bigint; changed jsonb;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE resource_name=TG_TABLE_NAME;
 rid:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END; ver:=CASE WHEN TG_OP='DELETE' THEN OLD.version ELSE NEW.version END;
 IF TG_OP='UPDATE' THEN SELECT COALESCE(jsonb_agg(c.id),'[]') INTO changed FROM api.scientific_columns c WHERE c.table_id=t.id AND to_jsonb(OLD)->c.field_name IS DISTINCT FROM to_jsonb(NEW)->c.field_name; ELSE SELECT COALESCE(jsonb_agg(c.id),'[]') INTO changed FROM api.scientific_columns c WHERE c.table_id=t.id AND (CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END)->c.field_name <> 'null'::jsonb; END IF;
 PERFORM internal.emit_change_event(t.workspace_id,'scientific_row',rid,CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,t.record_id,NULL,jsonb_build_object('tableId',t.id,'rowId',rid,'version',ver,'changedColumnIds',changed));
 RETURN NULL;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_scientific_table(p_block_id uuid,p_name text,p_columns jsonb DEFAULT '[]',p_description text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b api.blocks; r api.records; a jsonb; tid uuid:=gen_random_uuid(); rn text; item jsonb; fn text; typ text; ord int:=0; colid uuid; result jsonb; compiled jsonb; chk text; option_item jsonb; option_ord int;
BEGIN
 SELECT * INTO b FROM api.blocks WHERE id=p_block_id; SELECT * INTO r FROM api.records WHERE id=b.record_id;
 IF b.id IS NULL OR b.type<>'sheet' THEN RAISE EXCEPTION 'owning block must be sheet' USING ERRCODE='23514'; END IF;
 a:=internal.assert_scientific_actor(r.workspace_id);
 IF jsonb_typeof(p_columns)<>'array' THEN RAISE EXCEPTION 'columns must be an array' USING ERRCODE='22023'; END IF;
 LOOP rn:=internal.scientific_name('sheet_'); EXIT WHEN to_regclass(format('api.%I',rn)) IS NULL AND NOT EXISTS(SELECT 1 FROM api.scientific_tables WHERE resource_name=rn); END LOOP;
 INSERT INTO api.scientific_tables(id,workspace_id,record_id,block_id,resource_name,name,description,created_by_user_id,created_by_credential_id) VALUES(tid,r.workspace_id,r.id,b.id,rn,p_name,p_description,a->>'user_id',(a->>'credential_id')::uuid);
 EXECUTE format('CREATE TABLE api.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL DEFAULT api.current_workspace_id() CHECK (workspace_id=%L::uuid), version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), formula_column_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[], created_by_user_id text, created_by_credential_id uuid, updated_by_user_id text, updated_by_credential_id uuid)',rn,r.workspace_id);
 FOR item IN SELECT value FROM jsonb_array_elements(p_columns) LOOP
   ord:=ord+1; typ:=item->>'logical_type'; compiled:=internal.compile_scientific_column(item);
   LOOP fn:=internal.scientific_name('col_'); EXIT WHEN NOT EXISTS(SELECT 1 FROM api.scientific_columns WHERE field_name=fn); END LOOP; colid:=gen_random_uuid();
   INSERT INTO api.scientific_columns(id,table_id,workspace_id,field_name,label,description,display_order,logical_type,nullable,default_value,unit,validation,width,created_by_user_id,created_by_credential_id) VALUES(colid,tid,r.workspace_id,fn,item->>'label',item->>'description',ord,typ,COALESCE((item->>'nullable')::boolean,true),item->'default',item->'unit',COALESCE(item->'validation','{}'),(item->>'width')::int,a->>'user_id',(a->>'credential_id')::uuid);
   EXECUTE format('ALTER TABLE api.%I ADD COLUMN %I %s%s%s',rn,fn,compiled->>'storageType',compiled->>'defaultSql',compiled->>'notNullSql');
   FOR chk IN SELECT value#>>'{}' FROM jsonb_array_elements(compiled->'checks') LOOP EXECUTE format('ALTER TABLE api.%I ADD CHECK (%s)',rn,internal.render_scientific_check(chk::jsonb,fn)); END LOOP;
   IF typ='category' THEN option_ord:=0; IF item ? 'options' AND jsonb_typeof(item->'options')<>'array' THEN RAISE EXCEPTION 'options must be an array' USING ERRCODE='22023'; END IF; FOR option_item IN SELECT value FROM jsonb_array_elements(coalesce(item->'options','[]')) LOOP option_ord:=option_ord+1; IF jsonb_typeof(option_item)<>'object' OR (option_item - ARRAY['id','label']) <> '{}' OR jsonb_typeof(option_item->'label')<>'string' OR (option_item ? 'id' AND jsonb_typeof(option_item->'id')<>'string') OR NULLIF(option_item->>'label','') IS NULL THEN RAISE EXCEPTION 'invalid category option' USING ERRCODE='22023'; END IF; INSERT INTO api.scientific_category_options(id,column_id,workspace_id,label,display_order) VALUES(coalesce((option_item->>'id')::uuid,gen_random_uuid()),colid,r.workspace_id,option_item->>'label',option_ord); END LOOP; IF item ? 'default' AND NOT EXISTS (SELECT 1 FROM api.scientific_category_options o WHERE o.column_id=colid AND o.id=(item->>'default')::uuid AND o.lifecycle='active') THEN RAISE EXCEPTION 'category default must be an active option of the exact column' USING ERRCODE='23514'; END IF; END IF;
 END LOOP;
 EXECUTE format('ALTER TABLE api.%I ENABLE ROW LEVEL SECURITY',rn);
 EXECUTE format('CREATE POLICY %I ON api.%I FOR ALL TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)) WITH CHECK (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id))','scientific_rows_member',rn);
 EXECUTE format('GRANT SELECT ON api.%I TO authenticated',rn);
 IF ord>0 THEN EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON api.%I TO authenticated',(SELECT string_agg(format('%I',field_name),',') FROM api.scientific_columns WHERE table_id=tid),(SELECT string_agg(format('%I',field_name),',') FROM api.scientific_columns WHERE table_id=tid),rn); END IF;
 EXECUTE format('CREATE TRIGGER scientific_row_before BEFORE INSERT OR UPDATE OR DELETE ON api.%I FOR EACH ROW EXECUTE FUNCTION internal.scientific_row_before()',rn);
 EXECUTE format('CREATE TRIGGER scientific_row_event AFTER INSERT OR UPDATE OR DELETE ON api.%I FOR EACH ROW EXECUTE FUNCTION internal.scientific_row_event()',rn);
 PERFORM internal.emit_change_event(r.workspace_id,'scientific_table',tid,'create',r.id,r.project_id,jsonb_build_object('tableId',tid,'schemaVersion',1,'operation','create','columnIds',(SELECT coalesce(jsonb_agg(id ORDER BY display_order),'[]') FROM api.scientific_columns WHERE table_id=tid)));
 PERFORM pg_notify('pgrst','reload schema'); SELECT jsonb_build_object('table',to_jsonb(t),'columns',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY display_order),'[]') FROM api.scientific_columns c WHERE table_id=tid)) INTO result FROM api.scientific_tables t WHERE id=tid; RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_scientific_column(p_table_id uuid,p_expected_schema_version int,p_label text,p_logical_type text,p_nullable boolean DEFAULT true,p_default jsonb DEFAULT NULL,p_unit jsonb DEFAULT NULL,p_validation jsonb DEFAULT '{}',p_options jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t api.scientific_tables; a jsonb; fn text; cid uuid:=gen_random_uuid(); n int; compiled jsonb; spec jsonb; chk text; rows_exist boolean; option_item jsonb; option_ord int:=0;
BEGIN SELECT * INTO t FROM api.scientific_tables WHERE id=p_table_id FOR UPDATE; IF t.id IS NULL OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'active table required' USING ERRCODE='22023'; END IF; IF t.schema_version<>p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF; a:=internal.assert_scientific_actor(t.workspace_id); spec:=jsonb_build_object('label',p_label,'logical_type',p_logical_type,'nullable',p_nullable,'validation',coalesce(p_validation,'{}'::jsonb)) || CASE WHEN p_default IS NULL THEN '{}' ELSE jsonb_build_object('default',p_default) END || CASE WHEN p_unit IS NULL THEN '{}' ELSE jsonb_build_object('unit',p_unit) END || CASE WHEN p_options IS NULL THEN '{}' ELSE jsonb_build_object('options',p_options) END; compiled:=internal.compile_scientific_column(spec); IF p_options IS NOT NULL AND jsonb_typeof(p_options)<>'array' THEN RAISE EXCEPTION 'options must be an array' USING ERRCODE='22023'; END IF; EXECUTE format('SELECT EXISTS(SELECT 1 FROM api.%I)',t.resource_name) INTO rows_exist; IF NOT p_nullable AND rows_exist AND p_default IS NULL THEN RAISE EXCEPTION 'required column on populated table requires typed default/backfill' USING ERRCODE='23514'; END IF; SELECT coalesce(max(display_order),0)+1 INTO n FROM api.scientific_columns WHERE table_id=t.id; LOOP fn:=internal.scientific_name('col_'); EXIT WHEN NOT EXISTS(SELECT 1 FROM api.scientific_columns WHERE field_name=fn); END LOOP; INSERT INTO api.scientific_columns(id,table_id,workspace_id,field_name,label,display_order,logical_type,nullable,default_value,unit,validation,created_by_user_id,created_by_credential_id) VALUES(cid,t.id,t.workspace_id,fn,p_label,n,p_logical_type,p_nullable,p_default,p_unit,coalesce(p_validation,'{}'),a->>'user_id',(a->>'credential_id')::uuid); IF p_logical_type='category' THEN FOR option_item IN SELECT value FROM jsonb_array_elements(coalesce(p_options,'[]')) LOOP option_ord:=option_ord+1; IF jsonb_typeof(option_item)<>'object' OR option_item-ARRAY['id','label']<>'{}' OR jsonb_typeof(option_item->'label')<>'string' OR (option_item ? 'id' AND jsonb_typeof(option_item->'id')<>'string') OR NULLIF(option_item->>'label','') IS NULL THEN RAISE EXCEPTION 'invalid category option' USING ERRCODE='22023'; END IF; INSERT INTO api.scientific_category_options(id,column_id,workspace_id,label,display_order) VALUES(coalesce((option_item->>'id')::uuid,gen_random_uuid()),cid,t.workspace_id,option_item->>'label',option_ord); END LOOP; IF p_default IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.scientific_category_options WHERE column_id=cid AND id=(p_default#>>'{}')::uuid AND lifecycle='active') THEN RAISE EXCEPTION 'category default must be an active option of the exact column' USING ERRCODE='23514'; END IF; END IF; EXECUTE format('ALTER TABLE api.%I ADD COLUMN %I %s%s%s',t.resource_name,fn,compiled->>'storageType',compiled->>'defaultSql',compiled->>'notNullSql'); FOR chk IN SELECT value#>>'{}' FROM jsonb_array_elements(compiled->'checks') LOOP EXECUTE format('ALTER TABLE api.%I ADD CHECK (%s)',t.resource_name,internal.render_scientific_check(chk::jsonb,fn)); END LOOP; EXECUTE format('GRANT INSERT (%I), UPDATE (%I) ON api.%I TO authenticated',fn,fn,t.resource_name); UPDATE api.scientific_tables SET schema_version=schema_version+1,updated_at=now(),updated_by_user_id=a->>'user_id' WHERE id=t.id; PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','add_column','columnIds',jsonb_build_array(cid),'schemaVersion',t.schema_version+1)); PERFORM pg_notify('pgrst','reload schema'); RETURN (SELECT to_jsonb(c) FROM api.scientific_columns c WHERE id=cid); END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_scientific_column_display(p_column_id uuid,p_expected_schema_version int,p_label text DEFAULT NULL,p_display_order int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c api.scientific_columns; t api.scientific_tables; a jsonb;
DECLARE active_count int; changed jsonb;
BEGIN SELECT * INTO t FROM api.scientific_tables WHERE id=(SELECT table_id FROM api.scientific_columns WHERE id=p_column_id) FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'column not found' USING ERRCODE='P0002'; END IF; SELECT * INTO c FROM api.scientific_columns WHERE id=p_column_id FOR UPDATE; IF c.id IS NULL OR c.lifecycle<>'active' OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'active column required' USING ERRCODE='22023'; END IF; IF t.schema_version<>p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF; a:=internal.assert_scientific_actor(t.workspace_id); SELECT count(*) INTO active_count FROM api.scientific_columns WHERE table_id=t.id AND lifecycle='active'; IF p_display_order IS NOT NULL AND (p_display_order<1 OR p_display_order>active_count) THEN RAISE EXCEPTION 'display order out of bounds' USING ERRCODE='22023'; END IF; SELECT coalesce(jsonb_agg(id),'[]') INTO changed FROM api.scientific_columns WHERE table_id=t.id AND lifecycle='active' AND p_display_order IS NOT NULL AND (id=c.id OR (c.display_order<p_display_order AND display_order>c.display_order AND display_order<=p_display_order) OR (c.display_order>p_display_order AND display_order>=p_display_order AND display_order<c.display_order)); UPDATE api.scientific_columns SET display_order=display_order+1000000 WHERE table_id=t.id; WITH ranked AS (SELECT id,lifecycle,display_order,row_number() OVER (PARTITION BY lifecycle ORDER BY display_order)::int AS rn FROM api.scientific_columns WHERE table_id=t.id) UPDATE api.scientific_columns x SET display_order=CASE WHEN r.lifecycle='retired' THEN active_count+r.rn WHEN x.id=c.id AND p_display_order IS NOT NULL THEN p_display_order WHEN p_display_order IS NULL THEN r.rn WHEN c.display_order<p_display_order AND r.display_order-1000000>c.display_order AND r.display_order-1000000<=p_display_order THEN r.rn-1 WHEN c.display_order>p_display_order AND r.display_order-1000000>=p_display_order AND r.display_order-1000000<c.display_order THEN r.rn+1 ELSE r.rn END FROM ranked r WHERE x.id=r.id; IF p_label IS DISTINCT FROM NULL AND p_label IS DISTINCT FROM c.label THEN changed:=changed||jsonb_build_array(c.id); END IF; UPDATE api.scientific_columns SET label=coalesce(p_label,label),updated_at=now() WHERE id=c.id; UPDATE api.scientific_tables SET schema_version=schema_version+1,updated_at=now() WHERE id=t.id; PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','display','columnIds',(SELECT coalesce(jsonb_agg(DISTINCT value),'[]') FROM jsonb_array_elements(changed)),'schemaVersion',t.schema_version+1)); RETURN (SELECT to_jsonb(x) FROM api.scientific_columns x WHERE id=c.id); END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.retire_scientific_column(p_column_id uuid,p_expected_schema_version int,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE c api.scientific_columns; t api.scientific_tables; n bigint; formulas bigint; fingerprint text; h text; evidence jsonb; BEGIN SELECT * INTO t FROM api.scientific_tables WHERE id=(SELECT table_id FROM api.scientific_columns WHERE id=p_column_id) FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'column not found' USING ERRCODE='P0002'; END IF; SELECT * INTO c FROM api.scientific_columns WHERE id=p_column_id FOR UPDATE; IF c.id IS NULL OR c.lifecycle<>'active' OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'active column required' USING ERRCODE='22023'; END IF; PERFORM internal.assert_scientific_actor(t.workspace_id); IF t.schema_version<>p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF; EXECUTE format('LOCK TABLE api.%I IN ACCESS EXCLUSIVE MODE',t.resource_name); EXECUTE format('SELECT count(*) FILTER (WHERE %I IS NOT NULL),count(*) FILTER (WHERE %L::uuid=ANY(formula_column_ids)),md5(coalesce(jsonb_agg(to_jsonb(%I) ORDER BY id)::text,%L)) FROM api.%I',c.field_name,c.id,c.field_name,'[]',t.resource_name) INTO n,formulas,fingerprint; evidence:=jsonb_build_object('tableId',t.id,'columnId',c.id,'schemaVersion',t.schema_version,'nonNullRows',n,'formulaMarkers',formulas); h:=md5(evidence::text||fingerprint); IF p_confirmation_hash IS NULL THEN RETURN evidence||jsonb_build_object('requiresConfirmation',true,'hash',h); END IF; IF p_confirmation_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'retirement evidence changed' USING ERRCODE='23514'; END IF; UPDATE api.scientific_columns SET lifecycle='retired',updated_at=now() WHERE id=c.id; EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON api.%I FROM authenticated',c.field_name,c.field_name,t.resource_name); UPDATE api.scientific_tables SET schema_version=schema_version+1,updated_at=now() WHERE id=t.id; PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','retire_column','columnIds',jsonb_build_array(c.id),'schemaVersion',t.schema_version+1)); PERFORM pg_notify('pgrst','reload schema'); RETURN jsonb_build_object('retired',true,'schemaVersion',t.schema_version+1); END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.convert_scientific_column(p_column_id uuid,p_expected_schema_version int,p_new_logical_type text,p_confirmation_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c api.scientific_columns; t api.scientific_tables; target text; bad bigint; formulas bigint; h text; shadow text; spec jsonb; compiled jsonb; chk text; evidence jsonb;
BEGIN
 SELECT * INTO t FROM api.scientific_tables WHERE id=(SELECT table_id FROM api.scientific_columns WHERE id=p_column_id) FOR UPDATE; IF t.id IS NULL THEN RAISE EXCEPTION 'column not found' USING ERRCODE='P0002'; END IF; SELECT * INTO c FROM api.scientific_columns WHERE id=p_column_id FOR UPDATE; IF c.id IS NULL OR c.lifecycle<>'active' OR t.lifecycle<>'active' THEN RAISE EXCEPTION 'active column required' USING ERRCODE='22023'; END IF; PERFORM internal.assert_scientific_actor(t.workspace_id);
 IF t.schema_version<>p_expected_schema_version THEN RAISE EXCEPTION 'schema version mismatch' USING ERRCODE='SB001'; END IF; target:=internal.scientific_storage_type(p_new_logical_type); IF target IS NULL THEN RAISE EXCEPTION 'unsupported type' USING ERRCODE='22023'; END IF;
 IF NOT ((c.logical_type='integer' AND p_new_logical_type='decimal') OR (c.logical_type='text' AND p_new_logical_type IN ('integer','decimal','boolean','date','timestamp'))) THEN RAISE EXCEPTION 'incompatible conversion; create a new column' USING ERRCODE='22023'; END IF;
 IF c.logical_type='text' AND (c.default_value IS NOT NULL OR c.validation<>'{}'::jsonb OR c.unit IS NOT NULL) THEN RAISE EXCEPTION 'text conversion cannot safely map default, validation, or unit' USING ERRCODE='22023'; END IF;
 spec:=jsonb_build_object('label',c.label,'logical_type',p_new_logical_type,'nullable',c.nullable,'validation',c.validation)||CASE WHEN c.default_value IS NULL THEN '{}' ELSE jsonb_build_object('default',c.default_value) END||CASE WHEN c.unit IS NULL THEN '{}' ELSE jsonb_build_object('unit',c.unit) END; compiled:=internal.compile_scientific_column(spec); target:=compiled->>'storageType';
 EXECUTE format('LOCK TABLE api.%I IN ACCESS EXCLUSIVE MODE',t.resource_name);
 EXECUTE format('SELECT count(*) FILTER (WHERE %I IS NOT NULL AND NOT pg_input_is_valid(%I::text,%L)),count(*) FILTER (WHERE %L::uuid=ANY(formula_column_ids)) FROM api.%I',c.field_name,c.field_name,target,c.id,t.resource_name) INTO bad,formulas;
 evidence:=jsonb_build_object('tableId',t.id,'columnId',c.id,'schemaVersion',t.schema_version,'targetType',p_new_logical_type,'invalidRows',bad,'formulaMarkers',formulas); h:=md5(evidence::text); IF p_confirmation_hash IS NULL THEN RETURN evidence||jsonb_build_object('requiresConfirmation',true,'hash',h); END IF; IF p_confirmation_hash IS DISTINCT FROM h OR bad>0 OR formulas>0 THEN RAISE EXCEPTION 'conversion evidence changed, incompatible rows exist, or column is formula-owned' USING ERRCODE='23514'; END IF;
 shadow:='tmp_'||replace(c.id::text,'-',''); EXECUTE format('ALTER TABLE api.%I DISABLE TRIGGER scientific_row_before',t.resource_name); EXECUTE format('ALTER TABLE api.%I DISABLE TRIGGER scientific_row_event',t.resource_name); EXECUTE format('ALTER TABLE api.%I ADD COLUMN %I %s%s',t.resource_name,shadow,target,compiled->>'defaultSql'); EXECUTE format('UPDATE api.%I SET %I=%I::text::%s',t.resource_name,shadow,c.field_name,target); IF NOT c.nullable THEN EXECUTE format('ALTER TABLE api.%I ALTER COLUMN %I SET NOT NULL',t.resource_name,shadow); END IF; EXECUTE format('ALTER TABLE api.%I DROP COLUMN %I',t.resource_name,c.field_name); EXECUTE format('ALTER TABLE api.%I RENAME COLUMN %I TO %I',t.resource_name,shadow,c.field_name); FOR chk IN SELECT value#>>'{}' FROM jsonb_array_elements(compiled->'checks') LOOP EXECUTE format('ALTER TABLE api.%I ADD CHECK (%s)',t.resource_name,internal.render_scientific_check(chk::jsonb,c.field_name)); END LOOP; EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER scientific_row_before',t.resource_name); EXECUTE format('ALTER TABLE api.%I ENABLE TRIGGER scientific_row_event',t.resource_name);
 UPDATE api.scientific_columns SET logical_type=p_new_logical_type,updated_at=now() WHERE id=c.id; UPDATE api.scientific_tables SET schema_version=schema_version+1 WHERE id=t.id; EXECUTE format('GRANT INSERT (%I),UPDATE (%I) ON api.%I TO authenticated',c.field_name,c.field_name,t.resource_name); PERFORM internal.emit_change_event(t.workspace_id,'scientific_table',t.id,'update',t.record_id,NULL,jsonb_build_object('operation','convert_column','columnIds',jsonb_build_array(c.id),'schemaVersion',t.schema_version+1)); PERFORM pg_notify('pgrst','reload schema'); RETURN jsonb_build_object('converted',true,'schemaVersion',t.schema_version+1);
END $$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_scientific_table(uuid,text,jsonb,text),api.add_scientific_column(uuid,int,text,text,boolean,jsonb,jsonb,jsonb,jsonb),api.update_scientific_column_display(uuid,int,text,int),api.retire_scientific_column(uuid,int,text),api.convert_scientific_column(uuid,int,text,text) TO authenticated;
--> statement-breakpoint

-- Existing emitter now accepts either browser sub or external credential_id.
CREATE OR REPLACE FUNCTION internal.emit_change_event(p_workspace_id uuid,p_entity_type text,p_entity_uuid uuid,p_operation text,p_record_id uuid DEFAULT NULL,p_project_id uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb; uid text; cid uuid; seq bigint; eid uuid:=gen_random_uuid();
BEGIN c:=api.claim_probe(); IF c IS NULL THEN RETURN; END IF; uid:=c->>'sub'; cid:=NULLIF(c->>'credential_id','')::uuid; IF uid IS NULL AND cid IS NULL THEN RETURN; END IF; INSERT INTO api.workspace_change_seq(workspace_id,last_seq) VALUES(p_workspace_id,1) ON CONFLICT(workspace_id) DO UPDATE SET last_seq=api.workspace_change_seq.last_seq+1,updated_at=now() RETURNING last_seq INTO seq; INSERT INTO api.change_events(id,workspace_id,sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,actor_credential_id,client_id,payload) VALUES(eid,p_workspace_id,seq,p_entity_type,p_entity_uuid,p_operation,p_record_id,p_project_id,uid,cid,c->>'client_id',coalesce(p_payload,'{}')); PERFORM pg_notify('sheetbase_change',jsonb_build_object('workspace_id',p_workspace_id,'sequence',seq,'id',eid,'entity_type',p_entity_type,'operation',p_operation)::text); END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
