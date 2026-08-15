CREATE TABLE "api"."sheet_instance_definition_upgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"source_definition_version_id" uuid NOT NULL,
	"target_definition_version_id" uuid NOT NULL,
	"source_instance_revision" bigint NOT NULL,
	"resulting_instance_revision" bigint NOT NULL,
	"decision_manifest" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"upgraded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sheet_instance_definition_upgrade_revision" UNIQUE("instance_id","resulting_instance_revision"),
	CONSTRAINT "chk_sheet_instance_definition_upgrade_revisions" CHECK ("api"."sheet_instance_definition_upgrades"."source_instance_revision" > 0 AND "api"."sheet_instance_definition_upgrades"."resulting_instance_revision" = "api"."sheet_instance_definition_upgrades"."source_instance_revision" + 1),
	CONSTRAINT "chk_sheet_instance_definition_upgrade_versions" CHECK ("api"."sheet_instance_definition_upgrades"."source_definition_version_id" <> "api"."sheet_instance_definition_upgrades"."target_definition_version_id")
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_definition_upgrades" ADD CONSTRAINT "sheet_instance_definition_upgrades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_definition_upgrades" ADD CONSTRAINT "sheet_instance_definition_upgrades_instance_id_sheet_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_definition_upgrades" ADD CONSTRAINT "sheet_instance_definition_upgrades_source_definition_version_id_sheet_definition_versions_id_fk" FOREIGN KEY ("source_definition_version_id") REFERENCES "api"."sheet_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_definition_upgrades" ADD CONSTRAINT "sheet_instance_definition_upgrades_target_definition_version_id_sheet_definition_versions_id_fk" FOREIGN KEY ("target_definition_version_id") REFERENCES "api"."sheet_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_definition_upgrades" ADD CONSTRAINT "sheet_instance_definition_upgrades_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_instance_definition_upgrades_instance" ON "api"."sheet_instance_definition_upgrades" USING btree ("instance_id","upgraded_at");