-- H5: new Notebook Templates use CORE-06 versioned catalogue RPCs.
-- Legacy records.kind = notebook_template remains readable; application
-- roles cannot create or instantiate those records.

CREATE OR REPLACE FUNCTION internal.reject_new_legacy_notebook_template(p_kind text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_kind = 'notebook_template' AND session_user IS DISTINCT FROM 'migrator' THEN
    RAISE EXCEPTION 'Legacy notebook template records are compatibility-only. Use api.create_notebook_template.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION internal.reject_new_legacy_notebook_template(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.reject_new_legacy_notebook_template(text) TO PUBLIC;

DO $h5$
DECLARE
  oid oid;
  def text;
BEGIN
  FOR oid IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname IN ('create_record', 'create_record_with_blocks')
  LOOP
    def := pg_get_functiondef(oid);
    IF def LIKE '%reject_new_legacy_notebook_template%' THEN
      CONTINUE;
    END IF;
    def := regexp_replace(
      def,
      E'\nBEGIN\n',
      E'\nBEGIN\n  PERFORM "internal"."reject_new_legacy_notebook_template"(p_kind);\n',
      1
    );
    EXECUTE def;
  END LOOP;
END
$h5$;

DO $h5i$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('api.instantiate_template(uuid,uuid,text,text)'::regprocedure);
  IF def LIKE '%instantiate_notebook_template_version%' THEN
    RETURN;
  END IF;
  def := regexp_replace(
    def,
    $r$IF v_template\.kind NOT IN \('protocol_template', 'notebook_template'\) THEN[[:space:]]+RAISE EXCEPTION 'record is not a template' USING ERRCODE = '42501';[[:space:]]+END IF;$r$,
    $n$IF v_template.kind NOT IN ('protocol_template', 'notebook_template') THEN
    RAISE EXCEPTION 'record is not a template' USING ERRCODE = '42501';
  END IF;
  IF v_template.kind = 'notebook_template' AND session_user IS DISTINCT FROM 'migrator' THEN
    RAISE EXCEPTION 'Legacy notebook template records are compatibility-only. Use api.instantiate_notebook_template_version.'
      USING ERRCODE = '42501';
  END IF;$n$,
    1
  );
  IF def NOT LIKE '%instantiate_notebook_template_version%' THEN
    RAISE EXCEPTION 'H5 could not patch api.instantiate_template';
  END IF;
  EXECUTE def;
END
$h5i$;

NOTIFY pgrst, 'reload schema';
