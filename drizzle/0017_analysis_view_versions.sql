-- Every save of an analysis keeps the version it replaced. The current version
-- stays on analysis_views; this table holds the earlier ones, so the Versions
-- tab can list them and a person can restore one as the next save. Rows are
-- written only by the trigger below and are never edited.

CREATE TABLE api.analysis_view_versions (
    view_id uuid NOT NULL,
    version integer NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    charts jsonb NOT NULL,
    source_revisions jsonb NOT NULL,
    export_settings jsonb,
    saved_at timestamp with time zone NOT NULL,
    CONSTRAINT analysis_view_versions_pkey PRIMARY KEY (view_id, version)
);
--> statement-breakpoint
ALTER TABLE api.analysis_view_versions OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.analysis_view_versions
    ADD CONSTRAINT analysis_view_versions_view_id_analysis_views_id_fk FOREIGN KEY (view_id) REFERENCES api.analysis_views(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.analysis_view_versions
    ADD CONSTRAINT analysis_view_versions_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE api.analysis_view_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY analysis_view_versions_select ON api.analysis_view_versions FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.analysis_view_versions TO authenticated;
--> statement-breakpoint
CREATE FUNCTION internal.archive_analysis_view_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO api.analysis_view_versions
    (view_id, version, workspace_id, name, charts, source_revisions, export_settings, saved_at)
  VALUES
    (OLD.id, OLD.version, OLD.workspace_id, OLD.name, OLD.charts, OLD.source_revisions, OLD.export_settings, OLD.updated_at);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.archive_analysis_view_version() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.archive_analysis_view_version() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER trg_analysis_view_archive AFTER UPDATE ON api.analysis_views FOR EACH ROW EXECUTE FUNCTION internal.archive_analysis_view_version();
