CREATE TABLE "api"."instrument_calibrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"certificate_file_id" uuid,
	"performed_by_user_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "chk_instrument_calibrations_due" CHECK ("api"."instrument_calibrations"."due_at" >= "api"."instrument_calibrations"."performed_at"),
	CONSTRAINT "chk_instrument_calibrations_notes" CHECK ("api"."instrument_calibrations"."notes" IS NULL OR length("api"."instrument_calibrations"."notes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "api"."instrument_calibrations" ADD CONSTRAINT "instrument_calibrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_calibrations" ADD CONSTRAINT "instrument_calibrations_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "api"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_calibrations" ADD CONSTRAINT "instrument_calibrations_certificate_file_id_file_objects_id_fk" FOREIGN KEY ("certificate_file_id") REFERENCES "api"."file_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_calibrations" ADD CONSTRAINT "instrument_calibrations_performed_by_user_id_user_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_calibrations" ADD CONSTRAINT "instrument_calibrations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_instrument_calibrations_instrument" ON "api"."instrument_calibrations" USING btree ("instrument_id","due_at");--> statement-breakpoint
CREATE INDEX "idx_instrument_calibrations_workspace" ON "api"."instrument_calibrations" USING btree ("workspace_id");--> statement-breakpoint
-- LAB-06 — instrument calibration. Members read; writes only through the RPC.
ALTER TABLE api.instrument_calibrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_calibrations_select ON api.instrument_calibrations
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_calibrations_client_select ON api.instrument_calibrations
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON api.instrument_calibrations TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.instrument_calibrations TO api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_instrument_calibration(
  p_instrument_id uuid,
  p_performed_at timestamptz,
  p_due_at timestamptz,
  p_certificate_file_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS api.instrument_calibrations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.instrument_calibrations;
  i api.instruments;
BEGIN
  SELECT * INTO i FROM api.instruments WHERE id = p_instrument_id;
  IF i.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM i.workspace_id
     OR NOT api.is_workspace_writer(i.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'instrument denied' USING ERRCODE = '42501';
  END IF;
  IF p_performed_at IS NULL OR p_due_at IS NULL OR p_due_at < p_performed_at THEN
    RAISE EXCEPTION 'invalid calibration dates' USING ERRCODE = '22023';
  END IF;
  IF p_certificate_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.file_objects
      WHERE id = p_certificate_file_id AND workspace_id = i.workspace_id
  ) THEN
    RAISE EXCEPTION 'certificate not in workspace' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.instrument_calibrations (
    workspace_id, instrument_id, performed_at, due_at,
    certificate_file_id, performed_by_user_id, notes, created_by_user_id
  ) VALUES (
    i.workspace_id, i.id, p_performed_at, p_due_at,
    p_certificate_file_id, api.current_user_id(), p_notes, api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_instrument_calibration(uuid, timestamptz, timestamptz, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_instrument_calibration(uuid, timestamptz, timestamptz, uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
