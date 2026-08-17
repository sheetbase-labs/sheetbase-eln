-- GOV-01: enforce viewer read-only on write RLS and data-plane RPCs.
-- Existing viewer memberships stay `viewer`. SELECT policies still use
-- is_workspace_member so viewers can inspect. Owner-gated admin policies
-- are unchanged. External api_client policies are unchanged.

CREATE OR REPLACE FUNCTION api.is_workspace_writer(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT api.has_capability(p_workspace_id, 'record.create')
$$;

COMMENT ON FUNCTION api.is_workspace_writer(uuid) IS
  'GOV-01: true when the session can mutate workspace data (record.create).';

REVOKE ALL ON FUNCTION api.is_workspace_writer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.is_workspace_writer(uuid) TO authenticated;

-- Tighten authenticated write policies that currently treat any member as a
-- writer. Skip owner-gated policies and anything already capability-aware.
DO $gov01_rls$
DECLARE
  pol record;
  using_expr text;
  check_expr text;
  new_using text;
  new_check text;
  cap text;
  sql text;
BEGIN
  FOR pol IN
    SELECT n.nspname,
           c.relname,
           p.polname,
           p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'api'
       AND p.polcmd IN ('a', 'w', 'd', '*')
       AND (
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%is_workspace_member%'
         OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%is_workspace_member%'
       )
       AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%has_capability%'
       AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%has_capability%'
       AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') NOT LIKE '%''owner''%'
       AND coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') NOT LIKE '%''owner''%'
  LOOP
    cap := CASE WHEN pol.relname = 'record_links' THEN 'record.link' ELSE 'record.create' END;
    using_expr := pol.using_expr;
    check_expr := pol.check_expr;
    new_using := using_expr;
    new_check := check_expr;
    IF new_using IS NOT NULL THEN
      new_using := regexp_replace(
        new_using,
        'api\.is_workspace_member\(([A-Za-z0-9_.]+)\)',
        format('(api.is_workspace_member(\1) AND api.has_capability(\1, %L))', cap),
        'g'
      );
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(
        new_check,
        'api\.is_workspace_member\(([A-Za-z0-9_.]+)\)',
        format('(api.is_workspace_member(\1) AND api.has_capability(\1, %L))', cap),
        'g'
      );
    END IF;
    IF new_using IS NOT DISTINCT FROM using_expr AND new_check IS NOT DISTINCT FROM check_expr THEN
      RAISE EXCEPTION 'GOV-01 could not tighten policy %.% %', pol.nspname, pol.relname, pol.polname;
    END IF;
    sql := format('ALTER POLICY %I ON %I.%I', pol.polname, pol.nspname, pol.relname);
    IF new_using IS NOT NULL AND new_using <> '' THEN
      sql := sql || format(' USING (%s)', new_using);
    END IF;
    IF new_check IS NOT NULL AND new_check <> '' THEN
      sql := sql || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE sql;
  END LOOP;
END
$gov01_rls$;

-- SECURITY DEFINER data-plane mutators still authorise with membership only.
-- Replace the 1-argument is_workspace_member gate with has_capability
-- (record.create). Leave 2-argument owner checks alone. Do not patch
-- read/preview/query/export/admin RPCs.
DO $gov01_rpc$
DECLARE
  fn record;
  def text;
  new_def text;
  patched int := 0;
  create_record_patched boolean := false;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname IN (
         'archive_dataset',
         'archive_sheet_instance',
         'assign_planner_item_to_study',
         'bind_chart_revision',
         'commit_dataset_row_batch',
         'create_amendment',
         'create_comment',
         'create_record',
         'create_record_with_blocks',
         'create_report_definition',
         'create_sheet_instance_core0311',
         'create_sheet_instance_from_definition',
         'create_sheet_instance_from_definition_core0311',
         'create_study',
         'duplicate_sheet_instance',
         'edit_study',
         'finalize_file_upload',
         'freeze_chart',
         'instantiate_dataset_schema',
         'instantiate_notebook_template_version',
         'instantiate_template',
         'link_study_experiment',
         'link_study_project',
         'materialize_sheet_instance',
         'mutate_sheet_instance_calculations',
         'mutate_sheet_instance_local_state',
         'pin_protocol_reference',
         'record_reagent_movement',
         'reopen_comment_thread',
         'reply_to_comment',
         'resolve_comment_thread',
         'resolve_sheet_instance_row_identity',
         'restore_dataset',
         'restore_sheet_instance',
         'run_revision_checks',
         'sign_revision',
         'snapshot_dataset',
         'snapshot_study_plan',
         'submit_record_revision_core067',
         'unfreeze_chart',
         'update_report_definition',
         'update_sheet_instance',
         'update_sheet_instance_core0311',
         'validate_dataset_row_batch'
       )
  LOOP
    def := pg_get_functiondef(fn.oid);
    new_def := regexp_replace(
      def,
      '"api"\."is_workspace_member"\(([A-Za-z0-9_.]+)\)',
      'api.has_capability(\1, ''record.create'')',
      'g'
    );
    new_def := regexp_replace(
      new_def,
      'api\.is_workspace_member\(([A-Za-z0-9_.]+)\)',
      'api.has_capability(\1, ''record.create'')',
      'g'
    );
    IF new_def IS NOT DISTINCT FROM def THEN
      CONTINUE;
    END IF;
    EXECUTE new_def;
    patched := patched + 1;
    IF fn.proname = 'create_record' THEN
      create_record_patched := true;
    END IF;
  END LOOP;
  IF NOT create_record_patched THEN
    RAISE EXCEPTION 'GOV-01 could not patch api.create_record';
  END IF;
  IF patched < 1 THEN
    RAISE EXCEPTION 'GOV-01 patched no data-plane RPCs';
  END IF;
END
$gov01_rpc$;

NOTIFY pgrst, 'reload schema';
