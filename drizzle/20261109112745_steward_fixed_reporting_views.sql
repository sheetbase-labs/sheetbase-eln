-- Fixed reporting views for stewards.
--
-- Schema "data" holds one view per model (migration 0030). This adds the other
-- half: views over the lab's own operating tables (members, invitations, who
-- has access to what, groups, clients and what each client is shown), so a
-- steward can answer "who can see this project?" in SQL.
--
-- The mechanism is a small registry. A view is declared once with
-- internal.register_reporting_view(key, name, label, description, relation,
-- columns); the database then makes data.<name> in every workspace, owned by
-- reporting_owner, reading through a definer function so row level security
-- applies to the SQL login exactly as it does through the API. Another area
-- adds its views by registering them in its own migration.
--
-- Only the columns named are shown, so a secret column (a token hash) is left
-- out by not being listed.

CREATE TABLE internal.reporting_fixed_views (
    view_key text PRIMARY KEY CHECK (view_key ~ '^[a-z][a-z0-9_]{0,40}$'),
    view_name text NOT NULL UNIQUE CHECK (view_name ~ '^[a-z][a-z0-9_]{0,54}$'),
    label text NOT NULL,
    description text NOT NULL,
    relation text NOT NULL CHECK (relation ~ '^[a-z][a-z0-9_]{0,62}$'),
    workspace_column text NOT NULL DEFAULT 'workspace_id',
    columns text[] NOT NULL CHECK (cardinality(columns) > 0)
);
--> statement-breakpoint
ALTER TABLE internal.reporting_fixed_views OWNER TO migrator;
--> statement-breakpoint
-- The name each workspace's copy of a view was given (the plain name when it is
-- free, otherwise suffixed with the workspace, as for model views).
CREATE TABLE internal.reporting_fixed_view_names (
    workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
    view_key text NOT NULL REFERENCES internal.reporting_fixed_views(view_key) ON DELETE CASCADE,
    view_name text NOT NULL UNIQUE,
    PRIMARY KEY (workspace_id, view_key)
);
--> statement-breakpoint
ALTER TABLE internal.reporting_fixed_view_names OWNER TO migrator;
--> statement-breakpoint
-- Builds (or rebuilds) the fixed views of one workspace. Idempotent. A view that
-- fails to build is skipped with a warning, so a bad definition never blocks
-- anything else.
CREATE FUNCTION internal.regenerate_fixed_reporting_views(p_workspace uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v record;
  chosen text;
  fn text;
  select_list text;
  suffix text := right(replace(p_workspace::text, '-', ''), 6);
BEGIN
  IF NOT internal.reporting_ready() THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('reporting_fixed_views:' || p_workspace::text, 0));
  FOR v IN SELECT * FROM internal.reporting_fixed_views ORDER BY view_key LOOP
    BEGIN
      fn := format('data._fx_%s(uuid)', v.view_key);
      -- Made once: after the hand-over to reporting_owner, migrator cannot replace it.
      IF to_regprocedure(fn) IS NULL THEN
        EXECUTE format(
          'CREATE FUNCTION data._fx_%s(p_workspace uuid) RETURNS SETOF api.%I LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '''' AS $b$ SELECT * FROM api.%I WHERE %I = p_workspace $b$',
          v.view_key, v.relation, v.relation, v.workspace_column);
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO reporting_reader', fn);
        EXECUTE format('ALTER FUNCTION %s OWNER TO reporting_owner', fn);
      END IF;

      SELECT n.view_name INTO chosen FROM internal.reporting_fixed_view_names n
       WHERE n.workspace_id = p_workspace AND n.view_key = v.view_key;
      IF chosen IS NULL THEN
        IF NOT EXISTS (SELECT 1 FROM internal.reporting_fixed_view_names n WHERE n.view_name = v.view_name)
           AND to_regclass(format('data.%I', v.view_name)) IS NULL THEN
          chosen := v.view_name;
        ELSE
          chosen := left(v.view_name, 55) || '_' || suffix;
        END IF;
        INSERT INTO internal.reporting_fixed_view_names (workspace_id, view_key, view_name)
          VALUES (p_workspace, v.view_key, chosen);
      END IF;

      SELECT string_agg(quote_ident(c), ', ') INTO select_list FROM unnest(v.columns) AS c;
      EXECUTE format('DROP VIEW IF EXISTS data.%I', chosen);
      EXECUTE format('CREATE VIEW data.%I AS SELECT %s FROM data._fx_%s(%L::uuid)',
                     chosen, select_list, v.view_key, p_workspace);
      EXECUTE format('GRANT SELECT ON data.%I TO reporting_reader', chosen);
      EXECUTE format('COMMENT ON VIEW data.%I IS %L', chosen, v.label || '. ' || v.description);
      -- Last: once handed over, migrator can no longer change the view.
      EXECUTE format('ALTER VIEW data.%I OWNER TO reporting_owner', chosen);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'reporting view % was not built: %', v.view_key, SQLERRM;
    END;
  END LOOP;
END
$_$;
--> statement-breakpoint
ALTER FUNCTION internal.regenerate_fixed_reporting_views(uuid) OWNER TO migrator;
--> statement-breakpoint
-- Declares a fixed view and builds it in every workspace. Called from a
-- migration; running it again with the same key replaces the declaration.
CREATE FUNCTION internal.register_reporting_view(
    p_key text, p_name text, p_label text, p_description text,
    p_relation text, p_columns text[], p_workspace_column text DEFAULT 'workspace_id'
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w uuid;
BEGIN
  INSERT INTO internal.reporting_fixed_views (view_key, view_name, label, description, relation, workspace_column, columns)
    VALUES (p_key, p_name, p_label, p_description, p_relation, p_workspace_column, p_columns)
    ON CONFLICT (view_key) DO UPDATE
      SET label = EXCLUDED.label, description = EXCLUDED.description,
          relation = EXCLUDED.relation, workspace_column = EXCLUDED.workspace_column,
          columns = EXCLUDED.columns;
  FOR w IN SELECT id FROM api.workspaces LOOP
    PERFORM internal.regenerate_fixed_reporting_views(w);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.register_reporting_view(text, text, text, text, text, text[], text) OWNER TO migrator;
--> statement-breakpoint
-- A new workspace gets its fixed views along with its model views.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.regenerate_reporting_views(uuid)'::regprocedure) INTO v_def;
  IF position('PERFORM internal.ensure_reporting_functions();' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.regenerate_reporting_views';
  END IF;
  v_def := replace(v_def, 'PERFORM internal.ensure_reporting_functions();',
    'PERFORM internal.ensure_reporting_functions();
  PERFORM internal.regenerate_fixed_reporting_views(p_workspace);');
  EXECUTE v_def;
END $$;
--> statement-breakpoint
-- A deleted workspace takes its fixed views with it.
CREATE FUNCTION internal.trg_drop_fixed_reporting_views() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  n record;
BEGIN
  FOR n IN SELECT view_name FROM internal.reporting_fixed_view_names WHERE workspace_id = OLD.id LOOP
    EXECUTE format('DROP VIEW IF EXISTS data.%I', n.view_name);
  END LOOP;
  RETURN OLD;
END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_drop_fixed_reporting_views() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER drop_fixed_reporting_views BEFORE DELETE ON api.workspaces
  FOR EACH ROW EXECUTE FUNCTION internal.trg_drop_fixed_reporting_views();
--> statement-breakpoint

-- People and the workspace.
SELECT internal.register_reporting_view('members', 'members', 'Members',
  'Who is in the workspace: role, whether suspended and, for a client viewer, the client.',
  'workspace_memberships',
  ARRAY['user_id','role','role_source','username','client_id','suspended_at','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('invitations', 'invitations', 'Invitations',
  'Invitations to the workspace and their status. The link is never kept, so it is not here.',
  'workspace_invitations',
  ARRAY['id','email','role','status','client_id','project_grants','expires_at','accepted_at','accepted_by_user_id','revoked_at','created_by_user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('project_access', 'project_access', 'Project access',
  'Who has what access to each project: one rule per person or group.',
  'project_access',
  ARRAY['id','project_id','user_id','group_id','access_level','project_role','can_view','can_edit','can_review','can_manage','client_portal','granted_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('access_requests', 'access_requests', 'Access requests',
  'Requests for edit access to a project and how each was decided.',
  'project_access_requests',
  ARRAY['id','project_id','user_id','reason','status','decided_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('groups', 'groups', 'Groups',
  'Groups of people that can be given project access.',
  'workspace_groups',
  ARRAY['id','name','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('group_members', 'group_members', 'Group members',
  'Who is in each group.',
  'workspace_group_memberships',
  ARRAY['group_id','user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('settings_access', 'settings_access', 'Settings access',
  'What each role can do in each settings area: none, view or manage.',
  'settings_access',
  ARRAY['area','role','level','updated_by_user_id','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('clients', 'clients', 'Clients',
  'Client organisations.',
  'clients',
  ARRAY['id','code','name','archived_at','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('client_shares', 'client_shares', 'Client shares',
  'Which approved records each client sees in its portal.',
  'client_portal_shares',
  ARRAY['client_id','project_id','record_id','shared_at','shared_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('portal_messages', 'portal_messages', 'Portal messages',
  'Messages between staff and a client in its portal.',
  'client_portal_messages',
  ARRAY['id','client_id','project_id','author_user_id','author_kind','body','created_at']);
