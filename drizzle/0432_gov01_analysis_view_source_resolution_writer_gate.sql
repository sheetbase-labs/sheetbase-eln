-- GOV-01 — resolving an analysis source is a writer action, like every other
-- write to `api.analysis_views`.
--
-- Migration 0429 added `api.resolve_analysis_view_sources` to re-pin (or
-- acknowledge) the sources of a stale saved analysis. It is SECURITY DEFINER,
-- so it writes `api.analysis_views` past the row-level security that governs
-- the same statement, and it gated the caller on `api.is_workspace_member`
-- plus ownership. Membership alone is not the write authority for this table:
-- 0047's insert/update/delete policies were rewritten by 0112 (GOV-01) to
-- require `api.is_workspace_writer`, precisely because an owner-row check by
-- itself "still lets a demoted viewer mutate their own rows". A viewer who
-- owned a view before being demoted could therefore still write it through the
-- RPC, and a viewer who never wrote it should never have been able to.
--
-- The `update` path is the only row write, but the `keep` path writes the
-- acknowledgement change event, and the inventory treats the whole function as
-- a mutator, so the gate is applied once at the top: the caller must be a
-- workspace writer exactly as the table's own policies demand. `keep` (the
-- conservative acknowledgement) is not narrower than `update` on purpose —
-- nothing about "do not change the pins" is meaningful for a caller who may
-- not write the view at all.
--
-- This replaces the function definition wholesale (it is short) rather than
-- regex-patching the catalogue as 0112 did, so the gate is readable in the
-- migration that adds it.

CREATE OR REPLACE FUNCTION api.resolve_analysis_view_sources(
  p_view_id uuid,
  p_expected_version integer,
  p_resolution text,
  p_justification text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v api.analysis_views;
  stale_count integer;
  removed_count integer;
  cited_count integer;
  moved jsonb;
  revisions jsonb;
BEGIN
  SELECT * INTO v FROM api.analysis_views
    WHERE id = p_view_id AND workspace_id = api.current_workspace_id();
  -- The same authority the `analysis_views_update` policy requires: workspace
  -- membership is implied by writer, so this narrows nothing for a legitimate
  -- owner and closes the demoted-viewer path.
  IF v.id IS NULL OR NOT api.is_workspace_writer(v.workspace_id) THEN
    RAISE EXCEPTION 'Analysis denied' USING ERRCODE = '42501';
  END IF;
  IF v.owner_user_id IS DISTINCT FROM api.current_user_id() THEN
    RAISE EXCEPTION 'Only the owner can resolve an analysis source' USING ERRCODE = '42501';
  END IF;
  IF p_resolution NOT IN ('keep', 'update') THEN
    RAISE EXCEPTION 'resolution must be keep or update' USING ERRCODE = '23514';
  END IF;
  -- Optimistic concurrency: the caller resolves the version it read, exactly
  -- as the version bump trigger requires for any other update.
  IF v.version <> p_expected_version THEN
    RAISE EXCEPTION 'analysis view version conflict: expected %, found %', p_expected_version, v.version
      USING ERRCODE = 'SB077';
  END IF;

  SELECT count(*) FILTER (WHERE s.status = 'stale'),
         count(*) FILTER (WHERE s.status = 'removed')
    INTO stale_count, removed_count
    FROM internal.analysis_view_source_rows(v) s;

  IF stale_count + removed_count = 0 THEN
    RAISE EXCEPTION 'analysis sources are current; nothing to resolve' USING ERRCODE = 'SB079';
  END IF;

  SELECT count(*) INTO cited_count
    FROM internal.analysis_view_citations(v.workspace_id, v.display_id);

  IF p_resolution = 'keep' THEN
    PERFORM internal.emit_change_event(
      v.workspace_id, 'analysis_view', v.id, 'resolve', NULL, NULL,
      jsonb_build_object(
        'resolution', 'keep',
        'viewVersion', v.version,
        'pinnedRevisions', v.source_revisions,
        'staleSourceIds', coalesce((
          SELECT jsonb_agg(s.dataset_id ORDER BY s.pin_position)
            FROM internal.analysis_view_source_rows(v) s
           WHERE s.status <> 'current'), '[]'::jsonb),
        'citedByCount', cited_count,
        'justification', left(p_justification, 500)));
    RETURN jsonb_build_object(
      'resolution', 'keep',
      'state', 'stale',
      'acknowledged', true,
      'version', v.version,
      'revisions', v.source_revisions);
  END IF;

  -- update
  IF removed_count > 0 THEN
    RAISE EXCEPTION 'a source dataset is no longer available; keep the pinned version or re-author the analysis'
      USING ERRCODE = 'SB079';
  END IF;
  IF cited_count > 0 THEN
    RAISE EXCEPTION 'analysis is cited by % record(s); a cited analysis keeps the sources it cited', cited_count
      USING ERRCODE = 'SB078';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'datasetId', s.dataset_id,
           'schemaVersionNumber', s.live_schema_version_number,
           'revision', s.live_revision) ORDER BY s.pin_position), '[]'::jsonb),
         jsonb_agg(s.dataset_id ORDER BY s.pin_position)
    INTO revisions, moved
    FROM internal.analysis_view_source_rows(v) s;

  UPDATE api.analysis_views SET source_revisions = revisions
   WHERE id = v.id
  RETURNING * INTO v;

  PERFORM internal.emit_change_event(
    v.workspace_id, 'analysis_view', v.id, 'resolve', NULL, NULL,
    jsonb_build_object(
      'resolution', 'update',
      'viewVersion', v.version,
      'pinnedRevisions', v.source_revisions,
      'updatedSourceIds', moved,
      'citedByCount', 0,
      'justification', left(p_justification, 500)));

  RETURN jsonb_build_object(
    'resolution', 'update',
    'state', 'current',
    'acknowledged', false,
    'version', v.version,
    'revisions', v.source_revisions);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.resolve_analysis_view_sources(uuid,integer,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.resolve_analysis_view_sources(uuid,integer,text,text) TO authenticated;
--> statement-breakpoint

-- Fail closed in the migration itself: the function must carry the writer gate
-- and must leave the GOV-01 mutation-RPC inventory.
DO $gov01_proof$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname = 'resolve_analysis_view_sources'
       AND pg_get_functiondef(p.oid) LIKE '%is_workspace_writer%'
  ) THEN
    RAISE EXCEPTION 'GOV-01 resolve_analysis_view_sources is not writer-gated';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM internal.gov01_authenticated_mutation_rpc_violations() v
     WHERE v.proname = 'resolve_analysis_view_sources'
  ) THEN
    RAISE EXCEPTION 'GOV-01 resolve_analysis_view_sources is still membership-gated';
  END IF;
END
$gov01_proof$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
