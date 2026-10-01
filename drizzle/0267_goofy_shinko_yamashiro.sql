CREATE TABLE "api"."sample_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sample_record_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" numeric NOT NULL,
	"unit" text,
	"method" text,
	"measured_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sample_measurements_name" CHECK (length(btrim("api"."sample_measurements"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "api"."sample_measurements" ADD CONSTRAINT "sample_measurements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_measurements" ADD CONSTRAINT "sample_measurements_sample_record_id_records_id_fk" FOREIGN KEY ("sample_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_measurements" ADD CONSTRAINT "sample_measurements_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sample_measurements_sample" ON "api"."sample_measurements" USING btree ("sample_record_id","measured_at");--> statement-breakpoint
CREATE INDEX "idx_sample_measurements_workspace" ON "api"."sample_measurements" USING btree ("workspace_id");--> statement-breakpoint
-- RM-112 — sample measurements. Members read; writes only through the RPC.
ALTER TABLE api.sample_measurements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sample_measurements_select ON api.sample_measurements
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY sample_measurements_client_select ON api.sample_measurements
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON api.sample_measurements TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.sample_measurements TO api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_sample_measurement(
  p_sample_record_id uuid,
  p_name text,
  p_value numeric,
  p_unit text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_measured_at timestamptz DEFAULT now(),
  p_notes text DEFAULT NULL
)
RETURNS api.sample_measurements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.sample_measurements;
  r api.records;
BEGIN
  SELECT * INTO r FROM api.records
   WHERE id = p_sample_record_id AND deleted_at IS NULL;
  IF r.id IS NULL
     OR r.kind <> 'sample'
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'measurement name required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.sample_measurements (
    workspace_id, sample_record_id, name, value, unit, method, measured_at,
    notes, created_by_user_id
  ) VALUES (
    r.workspace_id, r.id, btrim(p_name), p_value, p_unit, p_method,
    COALESCE(p_measured_at, now()), p_notes, api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_sample_measurement(uuid, text, numeric, text, text, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_sample_measurement(uuid, text, numeric, text, text, timestamptz, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
