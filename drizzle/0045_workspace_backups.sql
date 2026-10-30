-- Whole-workspace export and scheduled backups.
--
-- A workspace administrator can download everything the workspace holds as one
-- archive, and the server can make the same archive on a schedule and keep the
-- newest few. This adds the settings for that, a record of every run (so
-- Diagnostics can say when the last good backup finished), the "backups"
-- settings area that decides who may use it, and a receipt type for exports of
-- the whole workspace.
--
-- Both tables are in `internal`, which the data API does not expose; the app
-- reads and writes them through its own connection.

CREATE TABLE internal.workspace_backup_settings (
    workspace_id uuid PRIMARY KEY REFERENCES api.workspaces (id) ON DELETE CASCADE,
    enabled boolean DEFAULT true NOT NULL,
    frequency text DEFAULT 'daily' NOT NULL,
    keep_count integer DEFAULT 7 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT chk_workspace_backup_settings_frequency CHECK (frequency IN ('daily', 'weekly')),
    CONSTRAINT chk_workspace_backup_settings_keep CHECK (keep_count BETWEEN 1 AND 90)
);
--> statement-breakpoint
ALTER TABLE internal.workspace_backup_settings OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE internal.workspace_backups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES api.workspaces (id) ON DELETE CASCADE,
    trigger text NOT NULL,
    status text DEFAULT 'running' NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    requested_by_user_id text,
    destination text,
    storage_key text,
    byte_size bigint,
    sha256 text,
    table_count integer,
    row_count bigint,
    file_count integer,
    missing_file_count integer,
    error text,
    CONSTRAINT chk_workspace_backups_trigger CHECK (trigger IN ('scheduled', 'manual')),
    CONSTRAINT chk_workspace_backups_status CHECK (status IN ('running', 'succeeded', 'failed')),
    CONSTRAINT chk_workspace_backups_sha256 CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE internal.workspace_backups OWNER TO migrator;
--> statement-breakpoint
-- One run at a time per workspace, so two replicas never back up the same
-- workspace together.
CREATE UNIQUE INDEX uq_workspace_backups_running
    ON internal.workspace_backups (workspace_id) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX idx_workspace_backups_workspace_started
    ON internal.workspace_backups (workspace_id, started_at DESC);
--> statement-breakpoint
ALTER TABLE api.settings_access DROP CONSTRAINT chk_settings_access_area;
--> statement-breakpoint
ALTER TABLE api.settings_access ADD CONSTRAINT chk_settings_access_area CHECK (area IN (
      'general', 'ai', 'members', 'signatures', 'clients', 'instruments',
      'integrations', 'storage', 'access', 'audit', 'diagnostics', 'usage', 'backups',
      'work_comments', 'work_records', 'work_experiments', 'work_sheets', 'work_samples', 'work_datasets', 'work_planning', 'work_protocols', 'work_reports', 'work_approvals', 'work_client_sharing', 'work_runs', 'work_parsers'));
--> statement-breakpoint
ALTER TABLE api.data_exports DROP CONSTRAINT data_exports_object_type_check;
--> statement-breakpoint
ALTER TABLE api.data_exports ADD CONSTRAINT data_exports_object_type_check
  CHECK (object_type = ANY (ARRAY['dataset'::text, 'dataset_version'::text, 'sheet_instance'::text, 'record'::text, 'revision'::text, 'workspace'::text]));
