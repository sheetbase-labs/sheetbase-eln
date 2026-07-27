-- ===========================================================================
-- 0047: ANALYSIS-001 — Saved analysis views.
--
-- A workspace-level table that stores reproducible analysis views built in
-- the Analysis Studio. Each view carries:
--   - owner_user_id: the user who created it (actor attribution).
--   - version: bumped on every update so the history of a named view is
--     traceable and a caller can detect a stale local copy.
--   - spec: the ChartSpec (SCI-004 decision 0029) the chart is rebuilt from.
--   - source_revisions: a jsonb array of { table_id, schema_version,
--     dataset_schema_id, dataset_schema_revision } captured at save time so
--     a later reader can tell whether the underlying dataset has evolved
--     since the view was authored (stale-source detection).
--   - export_settings: optional last-used export preferences (format,
--     dimensions, theme, provenance) so an export is reproducible.
--
-- RLS: workspace members can read every view in their workspace (analysis
-- views are shared evidence). Only the owner can update or delete a view.
-- Reuses api.current_workspace_id() / api.is_workspace_member() from AUTH-004.
-- ===========================================================================

CREATE TABLE "api"."analysis_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"spec" jsonb NOT NULL,
	"source_revisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"export_settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analysis_views_workspace_owner_name" UNIQUE("workspace_id","owner_user_id","name"),
	CONSTRAINT "chk_analysis_views_name" CHECK ("api"."analysis_views"."name" ~ '^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,98}[\p{L}\p{N}]$'),
	CONSTRAINT "chk_analysis_views_version" CHECK ("api"."analysis_views"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."analysis_views" ADD CONSTRAINT "analysis_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."analysis_views" ADD CONSTRAINT "analysis_views_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_views_workspace" ON "api"."analysis_views" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_views_owner" ON "api"."analysis_views" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint

-- updated_at bump on every UPDATE, and version bump so callers can detect a
-- stale local copy. The spec is replaced wholesale; the caller re-sends the
-- full ChartSpec so the stored view stays self-contained and reproducible.
CREATE OR REPLACE FUNCTION "internal"."bump_analysis_view_version"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		-- workspace_id and owner are immutable identity; the name is the
		-- user-facing key and must stay stable so saved references resolve.
		IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
		   OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
			RAISE EXCEPTION 'analysis view identity (workspace_id, owner_user_id) is immutable';
		END IF;
		NEW.version := OLD.version + 1;
		NEW.updated_at := now();
		RETURN NEW;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_analysis_view_version" BEFORE UPDATE ON "api"."analysis_views"
	FOR EACH ROW EXECUTE FUNCTION "internal"."bump_analysis_view_version"();--> statement-breakpoint

-- Row-level security.
ALTER TABLE "api"."analysis_views" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."analysis_views" TO authenticated;
GRANT SELECT ON "api"."analysis_views" TO api_client;
--> statement-breakpoint
CREATE POLICY "analysis_views_select" ON "api"."analysis_views"
	FOR SELECT TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "analysis_views_select_api_client" ON "api"."analysis_views"
	FOR SELECT TO api_client
	USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "analysis_views_insert" ON "api"."analysis_views"
	FOR INSERT TO authenticated
	WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
	            AND "api"."is_workspace_member"("workspace_id")
	            AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint
CREATE POLICY "analysis_views_update" ON "api"."analysis_views"
	FOR UPDATE TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "owner_user_id" = "api"."current_user_id"())
	WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
	            AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint
CREATE POLICY "analysis_views_delete" ON "api"."analysis_views"
	FOR DELETE TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint
