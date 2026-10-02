CREATE TABLE "api"."protocol_training" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"protocol_record_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'required' NOT NULL,
	"trained_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"notes" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_protocol_training_protocol_user" UNIQUE("protocol_record_id","user_id"),
	CONSTRAINT "chk_protocol_training_status" CHECK ("api"."protocol_training"."status" IN ('required', 'trained', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "api"."protocol_training" ADD CONSTRAINT "protocol_training_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_training" ADD CONSTRAINT "protocol_training_protocol_record_id_records_id_fk" FOREIGN KEY ("protocol_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_training" ADD CONSTRAINT "protocol_training_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_training" ADD CONSTRAINT "protocol_training_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_protocol_training_protocol" ON "api"."protocol_training" USING btree ("protocol_record_id");--> statement-breakpoint
CREATE INDEX "idx_protocol_training_workspace" ON "api"."protocol_training" USING btree ("workspace_id");--> statement-breakpoint
-- RM-104 — protocol training. Members read; writes only through the RPC.
ALTER TABLE api.protocol_training ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY protocol_training_select ON api.protocol_training
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY protocol_training_client_select ON api.protocol_training
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON api.protocol_training TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.protocol_training TO api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_protocol_training(
  p_protocol_record_id uuid,
  p_user_id text,
  p_status text,
  p_due_at timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS api.protocol_training
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.protocol_training;
  r api.records;
BEGIN
  SELECT * INTO r FROM api.records
   WHERE id = p_protocol_record_id AND deleted_at IS NULL;
  IF r.id IS NULL
     OR r.kind <> 'protocol_template'
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id) THEN
    RAISE EXCEPTION 'protocol denied' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('required', 'trained', 'expired') THEN
    RAISE EXCEPTION 'invalid training status' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = r.workspace_id AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'person is not a workspace member' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.protocol_training (
    workspace_id, protocol_record_id, user_id, status, trained_at, due_at,
    notes, created_by_user_id
  ) VALUES (
    r.workspace_id, r.id, p_user_id, p_status,
    CASE WHEN p_status = 'trained' THEN now() ELSE NULL END,
    p_due_at, p_notes, api.current_user_id()
  )
  ON CONFLICT (protocol_record_id, user_id) DO UPDATE SET
    status = excluded.status,
    trained_at = CASE
      WHEN excluded.status = 'trained' THEN now()
      ELSE protocol_training.trained_at
    END,
    due_at = excluded.due_at,
    notes = excluded.notes,
    updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_protocol_training(uuid, text, text, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_protocol_training(uuid, text, text, timestamptz, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
