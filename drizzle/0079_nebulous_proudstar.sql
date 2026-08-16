CREATE TABLE "api"."sheet_instance_local_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"retry_token" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"result_revision" bigint NOT NULL,
	"result" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"operation" text NOT NULL,
	"affected" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_instance_local_mutations_instance_id_retry_token_unique" UNIQUE("instance_id","retry_token"),
	CONSTRAINT "sheet_instance_local_mutations_request_digest_check" CHECK ("api"."sheet_instance_local_mutations"."request_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sheet_instance_local_mutations_result_revision_check" CHECK ("api"."sheet_instance_local_mutations"."result_revision" > 0),
	CONSTRAINT "sheet_instance_local_mutations_operation_check" CHECK ("api"."sheet_instance_local_mutations"."operation" = 'local_mutation')
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_local_mutations" ADD CONSTRAINT "sheet_instance_local_mutations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_local_mutations" ADD CONSTRAINT "sheet_instance_local_mutations_instance_id_sheet_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_local_mutations" ADD CONSTRAINT "sheet_instance_local_mutations_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_instance_local_mutations_instance" ON "api"."sheet_instance_local_mutations" USING btree ("instance_id","created_at");--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "chk_sheet_instances_name" CHECK (length(btrim("api"."sheet_instances"."name")) BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "chk_sheet_instances_description" CHECK ("api"."sheet_instances"."description" IS NULL OR length("api"."sheet_instances"."description") <= 2000);