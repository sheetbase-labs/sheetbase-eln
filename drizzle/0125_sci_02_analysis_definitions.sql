-- ===========================================================================
-- 0125: SCI-02 — Reusable analysis definitions.
--
-- A workspace-level table storing named, reproducible analysis definitions
-- built on the Analysis Studio (the analysis counterpart of analysis_views).
-- Each definition carries:
--   - owner_user_id: the user who created it (actor attribution).
--   - version: bumped on every update so callers can detect a stale copy and
--     so a notebook analysis block (SCI-03) can pin the version it rendered.
--   - definition: the versioned AnalysisDefinition JSONB (kind, dataset
--     references by stable scientific-table UUID, column bindings, params).
--   - source_revisions: { table_id, schema_version, dataset_schema_id,
--     dataset_schema_revision } captured at save time so a later reader can
--     tell whether the underlying dataset evolved (stale-source detection).
--
-- RLS mirrors analysis_views: workspace members read shared definitions;
-- only the owner mutates their own. Reuses api.current_workspace_id() /
-- api.is_workspace_member() from AUTH-004.
-- ===========================================================================

CREATE TABLE "api"."analysis_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	-- Bumped by the bump_analysis_definition_version trigger on every UPDATE.
	"version" integer DEFAULT 1 NOT NULL,
	"definition" jsonb NOT NULL,
	"source_revisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analysis_definitions_workspace_owner_name" UNIQUE("workspace_id","owner_user_id","name"),
	-- POSIX classes: PostgreSQL 18's regexp engine rejects the single-letter
	-- \p{L} unicode-property escapes the older \p pattern relied on.
	CONSTRAINT "chk_analysis_definitions_name" CHECK ("api"."analysis_definitions"."name" ~ '^[[:alpha:][:digit:]][[:alpha:][:digit:] _.-]{0,98}[[:alpha:][:digit:]]$'),
	CONSTRAINT "chk_analysis_definitions_version" CHECK ("api"."analysis_definitions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."analysis_definitions" ADD CONSTRAINT "analysis_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."analysis_definitions" ADD CONSTRAINT "analysis_definitions_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_analysis_definitions_workspace" ON "api"."analysis_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_analysis_definitions_owner" ON "api"."analysis_definitions" USING btree ("workspace_id","owner_user_id");--> statement-breakpoint

-- updated_at bump on every UPDATE, plus version bump so callers can detect a
-- stale local copy. workspace/owner identity is immutable; the name is the
-- user-facing key and stays stable so saved references resolve.
CREATE OR REPLACE FUNCTION "internal"."bump_analysis_definition_version"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
		   OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
			RAISE EXCEPTION 'analysis definition identity (workspace_id, owner_user_id) is immutable';
		END IF;
		NEW.version := OLD.version + 1;
		NEW.updated_at := now();
		RETURN NEW;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "trg_analysis_definition_version" BEFORE UPDATE ON "api"."analysis_definitions"
	FOR EACH ROW EXECUTE FUNCTION "internal"."bump_analysis_definition_version"();--> statement-breakpoint

-- Row-level security.
ALTER TABLE "api"."analysis_definitions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."analysis_definitions" TO authenticated;
GRANT SELECT ON "api"."analysis_definitions" TO api_client;
--> statement-breakpoint
CREATE POLICY "analysis_definitions_select" ON "api"."analysis_definitions"
	FOR SELECT TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "analysis_definitions_select_api_client" ON "api"."analysis_definitions"
	FOR SELECT TO api_client
	USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
CREATE POLICY "analysis_definitions_insert" ON "api"."analysis_definitions"
	FOR INSERT TO authenticated
	WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
	            AND "api"."is_workspace_writer"("workspace_id")
	            AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint
CREATE POLICY "analysis_definitions_update" ON "api"."analysis_definitions"
	FOR UPDATE TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "api"."is_workspace_writer"("workspace_id")
	       AND "owner_user_id" = "api"."current_user_id"())
	WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
	            AND "api"."is_workspace_writer"("workspace_id")
	            AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint
CREATE POLICY "analysis_definitions_delete" ON "api"."analysis_definitions"
	FOR DELETE TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "api"."is_workspace_writer"("workspace_id")
	       AND "owner_user_id" = "api"."current_user_id"());--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Repair: the analysis_views name check (0047) uses single-letter
-- \p{L}/\p{N} unicode-property escapes, which PostgreSQL 18's rewritten
-- regexp engine rejects — every INSERT into analysis_views now fails. The
-- POSIX-class form is equivalent for this pattern and portable across
-- versions.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."analysis_views" DROP CONSTRAINT "chk_analysis_views_name";--> statement-breakpoint
ALTER TABLE "api"."analysis_views" ADD CONSTRAINT "chk_analysis_views_name"
	CHECK ("name" ~ '^[[:alpha:][:digit:]][[:alpha:][:digit:] _.-]{0,98}[[:alpha:][:digit:]]$');--> statement-breakpoint
