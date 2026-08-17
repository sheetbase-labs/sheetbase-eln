-- GOV-01: enforce viewer read-only on authenticated write RLS and
-- data-plane mutation RPCs. Existing viewer memberships stay `viewer`.
-- SELECT policies keep is_workspace_member / storage_member_using so
-- viewers can inspect. Owner-gated admin policies and api_client
-- policies are unchanged.
--
-- Enforcement is explicit:
--   * is_workspace_writer = has_capability(..., record.create)
--   * FOR ALL membership write policies are split so SELECT is not
--     capability-gated
--   * leftover write policies / mutation RPCs abort the migration

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

CREATE OR REPLACE FUNCTION internal.gov01_write_predicate(expr text, relname text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF expr IS NULL OR btrim(expr) = '' THEN
    RETURN expr;
  END IF;
  expr := regexp_replace(
    expr,
    'api\.storage_member_using\(([A-Za-z0-9_.]+)\)',
    'api.is_workspace_writer(\1)',
    'g'
  );
  IF relname = 'record_links' THEN
    expr := regexp_replace(
      expr,
      'api\.is_workspace_member\(([A-Za-z0-9_.]+)\)',
      'api.has_capability(\1, ''record.link'')',
      'g'
    );
  ELSE
    expr := regexp_replace(
      expr,
      'api\.is_workspace_member\(([A-Za-z0-9_.]+)\)',
      'api.is_workspace_writer(\1)',
      'g'
    );
  END IF;
  RETURN expr;
END;
$$;

CREATE OR REPLACE FUNCTION internal.gov01_needs_write_tighten(expr text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT expr IS NOT NULL
     AND (
       expr ~ 'is_workspace_member\([A-Za-z0-9_.]+\)'
       OR expr ~ 'storage_member_using\('
     )
$$;

CREATE OR REPLACE FUNCTION internal.gov01_authenticated_write_policy_violations()
RETURNS TABLE(relname name, polname name, cmd text, detail text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT c.relname,
         p.polname,
         CASE p.polcmd
           WHEN 'a' THEN 'INSERT'
           WHEN 'w' THEN 'UPDATE'
           WHEN 'd' THEN 'DELETE'
           WHEN '*' THEN 'ALL'
         END,
         concat_ws(
           ' | ',
           nullif(pg_get_expr(p.polqual, p.polrelid), ''),
           nullif(pg_get_expr(p.polwithcheck, p.polrelid), '')
         )
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api'
     AND p.polcmd IN ('a', 'w', 'd', '*')
     AND p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')]
     AND NOT p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'api_client')]
     AND concat_ws(
           '',
           coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         ) !~ 'is_workspace_writer|has_capability|is_workspace_member\([^)]+,'
$$;

CREATE OR REPLACE FUNCTION internal.gov01_authenticated_mutation_rpc_violations()
RETURNS TABLE(proname name, signature text, detail text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.proname,
         p.oid::regprocedure::text,
         CASE
           WHEN pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
             OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
             THEN 'membership write gate'
           WHEN pg_get_functiondef(p.oid) ~ 'storage_member_using\('
             THEN 'storage_member_using write gate'
           ELSE '1-arg membership in mutator'
         END
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api'
     AND p.prokind = 'f'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_get_functiondef(p.oid) ~* 'INSERT[[:space:]]+INTO|UPDATE[[:space:]]+"api"|UPDATE[[:space:]]+api\.|DELETE[[:space:]]+FROM'
     AND (
       pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
       OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
       OR (
         pg_get_functiondef(p.oid) ~ 'storage_member_using\('
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
       OR (
         pg_get_functiondef(p.oid) ~ 'is_workspace_member\([A-Za-z0-9_."]+\)'
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
     )
$$;

-- Split or tighten authenticated write policies.
DO $gov01_rls$
DECLARE
  pol record;
  using_expr text;
  check_expr text;
  new_using text;
  new_check text;
  has_select boolean;
  auth_oid oid;
BEGIN
  SELECT oid INTO auth_oid FROM pg_roles WHERE rolname = 'authenticated';

  FOR pol IN
    SELECT c.oid AS relid,
           n.nspname,
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
       AND p.polroles @> ARRAY[auth_oid]
       AND NOT p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'api_client')]
       AND (
         internal.gov01_needs_write_tighten(pg_get_expr(p.polqual, p.polrelid))
         OR internal.gov01_needs_write_tighten(pg_get_expr(p.polwithcheck, p.polrelid))
       )
  LOOP
    using_expr := pol.using_expr;
    check_expr := pol.check_expr;
    new_using := internal.gov01_write_predicate(using_expr, pol.relname);
    new_check := internal.gov01_write_predicate(check_expr, pol.relname);
    IF new_using IS NOT DISTINCT FROM using_expr AND new_check IS NOT DISTINCT FROM check_expr THEN
      RAISE EXCEPTION 'GOV-01 could not tighten policy %.% %', pol.nspname, pol.relname, pol.polname;
    END IF;

    IF pol.polcmd = '*' THEN
      SELECT EXISTS (
        SELECT 1
          FROM pg_policy p2
         WHERE p2.polrelid = pol.relid
           AND p2.polcmd = 'r'
           AND p2.polroles @> ARRAY[auth_oid]
           AND p2.polname IS DISTINCT FROM pol.polname
      ) INTO has_select;

      EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.polname, pol.nspname, pol.relname);

      IF NOT has_select THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR SELECT TO authenticated USING (%s)',
          pol.relname || '_select_member',
          pol.nspname,
          pol.relname,
          using_expr
        );
      END IF;

      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (%s)',
        pol.relname || '_insert_writer',
        pol.nspname,
        pol.relname,
        coalesce(new_check, new_using)
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
        pol.relname || '_update_writer',
        pol.nspname,
        pol.relname,
        coalesce(new_using, new_check),
        coalesce(new_check, new_using)
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (%s)',
        pol.relname || '_delete_writer',
        pol.nspname,
        pol.relname,
        coalesce(new_using, new_check)
      );
    ELSE
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I%s%s',
        pol.polname,
        pol.nspname,
        pol.relname,
        CASE WHEN new_using IS NOT NULL AND new_using <> ''
          THEN format(' USING (%s)', new_using) ELSE '' END,
        CASE WHEN new_check IS NOT NULL AND new_check <> ''
          THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
      );
    END IF;
  END LOOP;
END
$gov01_rls$;

-- Owner-row write policies (no membership helper) still let a demoted
-- viewer mutate their own rows. Require is_workspace_writer.
DO $gov01_owner_row$
DECLARE
  pol record;
  using_expr text;
  check_expr text;
  new_using text;
  new_check text;
BEGIN
  FOR pol IN
    SELECT n.nspname,
           c.relname,
           p.polname,
           pg_get_expr(p.polqual, p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
      FROM internal.gov01_authenticated_write_policy_violations() v
      JOIN pg_class c ON c.relname = v.relname
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'api'
      JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = v.polname
  LOOP
    using_expr := pol.using_expr;
    check_expr := pol.check_expr;
    IF coalesce(using_expr, '') NOT LIKE '%workspace_id%'
       AND coalesce(check_expr, '') NOT LIKE '%workspace_id%' THEN
      RAISE EXCEPTION
        'GOV-01 cannot add writer gate to policy %.% %',
        pol.nspname, pol.relname, pol.polname;
    END IF;
    new_using := using_expr;
    new_check := check_expr;
    IF new_using IS NOT NULL AND new_using <> '' THEN
      new_using := new_using || ' AND api.is_workspace_writer(workspace_id)';
    END IF;
    IF new_check IS NOT NULL AND new_check <> '' THEN
      new_check := new_check || ' AND api.is_workspace_writer(workspace_id)';
    END IF;
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I%s%s',
      pol.polname,
      pol.nspname,
      pol.relname,
      CASE WHEN new_using IS NOT NULL AND new_using <> ''
        THEN format(' USING (%s)', new_using) ELSE '' END,
      CASE WHEN new_check IS NOT NULL AND new_check <> ''
        THEN format(' WITH CHECK (%s)', new_check) ELSE '' END
    );
  END LOOP;
END
$gov01_owner_row$;

-- Patch authenticated mutation RPCs that still authorise writes with
-- membership or storage_member_using. Do not rewrite 2-arg owner checks.
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
       AND p.prokind = 'f'
       AND (
         p.proname = 'create_record'
         OR (
           has_function_privilege('authenticated', p.oid, 'EXECUTE')
           AND pg_get_functiondef(p.oid) ~* 'INSERT[[:space:]]+INTO|UPDATE[[:space:]]+"api"|UPDATE[[:space:]]+api\.|DELETE[[:space:]]+FROM'
           AND (
             pg_get_functiondef(p.oid) LIKE '%is_workspace_member%'
             OR pg_get_functiondef(p.oid) LIKE '%storage_member_using%'
           )
         )
       )
  LOOP
    def := pg_get_functiondef(fn.oid);
    new_def := regexp_replace(
      def,
      E'"api"\\."is_workspace_member"\\(([^,)]+)\\)',
      'api.is_workspace_writer(\1)',
      'g'
    );
    new_def := regexp_replace(
      new_def,
      E'api\\.is_workspace_member\\(([^,)]+)\\)',
      'api.is_workspace_writer(\1)',
      'g'
    );
    new_def := regexp_replace(
      new_def,
      E'"api"\\."storage_member_using"\\(([^,)]+)\\)',
      'api.is_workspace_writer(\1)',
      'g'
    );
    new_def := regexp_replace(
      new_def,
      E'api\\.storage_member_using\\(([^,)]+)\\)',
      'api.is_workspace_writer(\1)',
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

DO $gov01_proof$
DECLARE
  leftover_policies int;
  leftover_rpcs int;
  policy_names text;
  rpc_names text;
BEGIN
  SELECT count(*)::int, string_agg(relname || '.' || polname, ', ' ORDER BY relname, polname)
    INTO leftover_policies, policy_names
    FROM internal.gov01_authenticated_write_policy_violations();
  IF leftover_policies > 0 THEN
    RAISE EXCEPTION 'GOV-01 leftover authenticated write policies (%): %', leftover_policies, policy_names;
  END IF;

  SELECT count(*)::int, string_agg(signature, ', ' ORDER BY signature)
    INTO leftover_rpcs, rpc_names
    FROM internal.gov01_authenticated_mutation_rpc_violations();
  IF leftover_rpcs > 0 THEN
    RAISE EXCEPTION 'GOV-01 leftover authenticated mutation RPCs (%): %', leftover_rpcs, rpc_names;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname = 'create_record'
       AND pg_get_functiondef(p.oid) LIKE '%is_workspace_writer%'
  ) THEN
    RAISE EXCEPTION 'GOV-01 create_record is not writer-gated';
  END IF;
END
$gov01_proof$;

REVOKE ALL ON FUNCTION internal.gov01_write_predicate(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.gov01_needs_write_tighten(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.gov01_authenticated_write_policy_violations() FROM PUBLIC;
REVOKE ALL ON FUNCTION internal.gov01_authenticated_mutation_rpc_violations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.gov01_authenticated_write_policy_violations() TO migrator;
GRANT EXECUTE ON FUNCTION internal.gov01_authenticated_mutation_rpc_violations() TO migrator;

NOTIFY pgrst, 'reload schema';
