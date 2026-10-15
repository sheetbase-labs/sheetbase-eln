-- R5-STUDIO-03 — stale sources and citations are explicit and resolvable.
--
-- An `analysis_views` row records the exact source state it was authored
-- against in `source_revisions` (a jsonb array of
-- `{datasetId, schemaVersionNumber, revision}`). Until now the browser was the
-- only thing that compared those pins with the live Dataset, so "stale" had no
-- canonical definition, no resolution action and no record of who resolved it.
-- This migration moves the comparison to the database, defines what "newer"
-- means against the frozen-source contract, adds the two resolution paths and
-- exposes the records that cite an analysis.
--
-- WHAT MAKES A SOURCE NEWER (the canonical definition)
--   A pinned entry names a Dataset and the pair the freeze path itself pins
--   (`schemaVersionNumber`, dataset `revision`). A source is:
--     * `removed`  — the Dataset no longer resolves in the view's workspace
--                    (deleted, or moved out of the workspace);
--     * `stale`    — the Dataset's live schema version number, or its live
--                    `revision`, differs from the pinned pair;
--     * `current`  — both numbers match.
--   Irrelevant changes: everything that does not move either number — the
--   Dataset's name, description, display id, project placement and tags, and
--   the view's own name/export settings. A published Dataset Schema Version is
--   immutable (`prevent_published_dataset_schema_field_mutation`), so pinning
--   `schemaVersionNumber` fully determines the field set an analysis binds to;
--   no second schema fingerprint is needed.
--
-- RESOLUTION (recorded through the existing history path)
--   `api.resolve_analysis_view_sources` offers exactly two deliberate actions:
--     * `keep`   — leave the pins as they are. Nothing on the row changes; the
--                  decision (actor, view version, pinned revisions) is written
--                  as one `analysis_view` / `resolve` change event, and the
--                  status read model reports it as the acknowledgement.
--     * `update` — re-pin every source to its live schema version number and
--                  revision. Only the owner may do this, the caller must send
--                  the version it read (optimistic concurrency), a removed
--                  source refuses the update, and a view cited by a record is
--                  refused outright by the trigger below.
--   The trigger is the authority: a cited analysis keeps the sources it cited.
--   A citation is a `record_links` row (`link_type`/`target_kind` = 'analysis')
--   whose `target_identifier` is the view's stable `display_id`; record links
--   are the existing citation records (migration 0326 already resolves analysis
--   link targets against `api.analysis_views.display_id`). This is the same
--   predicate the analysis list's "Cited in records" tab uses. Analysis
--   notebook *blocks* cite saved analysis *definitions*
--   (`validate_scientific_block` requires `api.analysis_definitions`), so they
--   are not citations of a view and are deliberately not counted here.
--
-- DECISION RECORDED (R5-STUDIO-03): the conservative, reversible option was
-- taken — a cited analysis is refused an in-place change of its spec or source
-- revisions rather than silently forked. A deliberate alternative (explicit
-- version history for cited analyses) needs an owner decision because it adds
-- a stored version lineage that record links would have to resolve; the owner
-- may overrule this refusal by introducing that lineage. Consequence today: to
-- restate the sources of a cited analysis, save it under a new name and
-- re-cite deliberately, so the submitted evidence keeps the versions it cited.

-- ---------------------------------------------------------------------------
-- 1. `analysis_view` joins the change-event vocabulary so the resolution and
--    the citation history are readable under the same guard as every other
--    entity. The constraint is widened from its own definition, so later
--    vocabulary changes cannot be silently dropped here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint WHERE conname = 'chk_change_events_entity_type';
  IF def IS NULL THEN RAISE EXCEPTION 'chk_change_events_entity_type missing'; END IF;
  IF position('''analysis_view''' in def) > 0 THEN RETURN; END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  -- pg_get_constraintdef already returns the leading CHECK (...).
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '
    || replace(def, '''project''', '''project'', ''analysis_view''');
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Object access for an analysis view resolves through its workspace, the
--    same rule its RLS policies use (workspace member, workspace-scoped).
-- ---------------------------------------------------------------------------
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition := pg_get_functiondef('internal.can_access_object(text,uuid,text)'::regprocedure);
  IF position('''analysis_view''' in definition) > 0 THEN RETURN; END IF;
  anchor := 'WHEN ''project'' THEN SELECT workspace_id,id INTO workspace,project FROM api.projects WHERE id=p_id;';
  IF position(anchor in definition) = 0 THEN RAISE EXCEPTION 'can_access_object anchor missing'; END IF;
  definition := replace(definition, anchor,
    'WHEN ''analysis_view'' THEN SELECT workspace_id INTO workspace FROM api.analysis_views WHERE id=p_id; ' || anchor);
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- The history guard learns the new entity type; without it a resolution event
-- would fall through the entity check (kind NULL) and be readable by any
-- workspace member regardless of workspace scoping.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition := pg_get_functiondef('internal.can_read_change_event(api.change_events)'::regprocedure);
  IF position('''analysis_view''' in definition) > 0 THEN RETURN; END IF;
  anchor := 'WHEN ''dataset'' THEN ''dataset''';
  IF position(anchor in definition) = 0 THEN RAISE EXCEPTION 'can_read_change_event anchor missing'; END IF;
  definition := replace(definition, anchor, anchor || ' WHEN ''analysis_view'' THEN ''analysis_view''');
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Safe uuid parse for pin entries: `source_revisions` is caller-written
--    jsonb and a malformed entry must read as "removed", never abort the read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.try_uuid(p_text text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN p_text::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.try_uuid(text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. The canonical staleness computation. One row per pinned source, in the
--    pin order the ChartSpec stores, so both the status read model and the
--    resolution writer agree on what "newer" means (see the header).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.analysis_view_source_rows(p_view api.analysis_views)
RETURNS TABLE (
  pin_position integer,
  dataset_id uuid,
  dataset_name text,
  dataset_display_id text,
  pinned_schema_version_number integer,
  pinned_revision bigint,
  live_schema_version_number integer,
  live_revision bigint,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    (pinned.ordinality)::integer,
    internal.try_uuid(pinned.value->>'datasetId'),
    d.name,
    d.display_id,
    CASE WHEN pinned.value->>'schemaVersionNumber' ~ '^[0-9]+$'
      THEN (pinned.value->>'schemaVersionNumber')::integer ELSE 0 END,
    CASE WHEN pinned.value->>'revision' ~ '^[0-9]+$'
      THEN (pinned.value->>'revision')::bigint ELSE 0 END,
    sv.version,
    d.revision,
    CASE
      WHEN d.id IS NULL THEN 'removed'
      WHEN sv.version IS DISTINCT FROM
             CASE WHEN pinned.value->>'schemaVersionNumber' ~ '^[0-9]+$'
               THEN (pinned.value->>'schemaVersionNumber')::integer ELSE 0 END
        OR d.revision IS DISTINCT FROM
             CASE WHEN pinned.value->>'revision' ~ '^[0-9]+$'
               THEN (pinned.value->>'revision')::bigint ELSE 0 END
      THEN 'stale'
      ELSE 'current'
    END
  FROM jsonb_array_elements(p_view.source_revisions) WITH ORDINALITY AS pinned(value, ordinality)
  LEFT JOIN api.datasets d
    ON d.id = internal.try_uuid(pinned.value->>'datasetId')
   AND d.workspace_id = p_view.workspace_id
  LEFT JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.analysis_view_source_rows(api.analysis_views) FROM PUBLIC;
--> statement-breakpoint

/**
 * The records that cite an analysis view, through the existing citation
 * records (record links). `locked` is the record's approve-for-record lock
 * state; `signed` is whether the citing record carries any signature.
 */
CREATE OR REPLACE FUNCTION internal.analysis_view_citations(p_workspace_id uuid, p_display_id text)
RETURNS TABLE (
  link_id uuid,
  source_record_id uuid,
  record_identifier text,
  record_title text,
  record_status text,
  linked_at timestamptz,
  locked boolean,
  locked_at timestamptz,
  signed boolean,
  signed_at timestamptz,
  signer_user_id text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    l.id,
    r.id,
    r.identifier,
    r.title,
    r.status,
    l.created_at,
    r.locked_at IS NOT NULL,
    r.locked_at,
    sig.id IS NOT NULL,
    sig.signed_at,
    sig.signer_user_id
  FROM api.record_links l
  JOIN api.records r ON r.id = l.source_record_id
  LEFT JOIN LATERAL (
    SELECT s.id, s.signed_at, s.signer_user_id
      FROM api.signatures s
     WHERE s.record_id = r.id
       AND (r.locked_by_revision_id IS NULL OR s.revision_id = r.locked_by_revision_id)
     ORDER BY s.signed_at DESC
     LIMIT 1
  ) sig ON true
  WHERE l.link_type = 'analysis'
    AND l.target_kind = 'analysis'
    AND l.target_identifier = p_display_id
    AND r.workspace_id = p_workspace_id
    AND r.deleted_at IS NULL
  ORDER BY l.created_at, l.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.analysis_view_citations(uuid,text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A cited analysis keeps the sources it cited. Metadata-only edits (name,
--    export settings) stay allowed; changing the spec or the pinned sources on
--    a cited view is refused at the boundary, for every writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.guard_analysis_view_cited_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cited integer;
BEGIN
  IF NEW.spec IS NOT DISTINCT FROM OLD.spec
     AND NEW.source_revisions IS NOT DISTINCT FROM OLD.source_revisions THEN
    RETURN NEW;
  END IF;
  -- Request-role gate: this rule exists for browser and API-client writes,
  -- which are the only writers that carry request claims. The trigger is
  -- SECURITY DEFINER so its citation count reads every citing record
  -- authoritatively, which means `current_user` is the definer here — the
  -- request role has to come from the claims (`api.claim_probe`), the same
  -- marker `internal.can_read_record_link_target` uses. Seed and migration
  -- connections carry no claims and maintain this data directly;
  -- `api.resolve_analysis_view_sources` also runs as its definer and performs
  -- the identical citation check itself before re-pinning.
  IF coalesce(api.claim_probe()->>'role','') NOT IN ('authenticated', 'api_client') THEN
    RETURN NEW;
  END IF;
  IF OLD.display_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO cited
    FROM internal.analysis_view_citations(OLD.workspace_id, OLD.display_id);
  IF cited > 0 THEN
    RAISE EXCEPTION 'analysis is cited by % record(s); a cited analysis keeps the sources it cited — save it under a new name', cited
      USING ERRCODE = 'SB078';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_analysis_view_cited_update
  BEFORE UPDATE ON api.analysis_views
  FOR EACH ROW EXECUTE FUNCTION internal.guard_analysis_view_cited_update();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Status read model: the canonical answer to "is this analysis's source
--    stale, what moved, and who already resolved it".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.analysis_view_source_status(p_view_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v api.analysis_views;
  sources jsonb;
  stale_count integer;
  removed_count integer;
  cited_count integer;
  cited_locked integer;
  acknowledgement jsonb;
BEGIN
  SELECT * INTO v FROM api.analysis_views
    WHERE id = p_view_id AND workspace_id = api.current_workspace_id();
  IF v.id IS NULL OR NOT api.is_workspace_member(v.workspace_id) THEN
    RAISE EXCEPTION 'Analysis denied' USING ERRCODE = '42501';
  END IF;

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'datasetId', s.dataset_id,
      'datasetName', coalesce(s.dataset_name, s.dataset_id::text),
      'displayId', s.dataset_display_id,
      'pinned', jsonb_build_object(
        'schemaVersionNumber', s.pinned_schema_version_number,
        'revision', s.pinned_revision),
      'live', CASE WHEN s.status = 'removed' THEN NULL ELSE jsonb_build_object(
        'schemaVersionNumber', s.live_schema_version_number,
        'revision', s.live_revision) END,
      'status', s.status,
      'detail', CASE s.status
        WHEN 'removed' THEN coalesce(s.dataset_name, s.dataset_id::text) || ' is no longer available.'
        WHEN 'stale' THEN coalesce(s.dataset_name, s.dataset_id::text)
          || ' moved to schema v' || s.live_schema_version_number
          || ' (saved against v' || s.pinned_schema_version_number || ')'
          || ' and/or was revised (r' || s.pinned_revision || ' → r' || s.live_revision || ').'
        ELSE coalesce(s.dataset_name, s.dataset_id::text) || ' is unchanged since it was saved.' END
    ) ORDER BY s.pin_position), '[]'::jsonb),
    count(*) FILTER (WHERE s.status = 'stale'),
    count(*) FILTER (WHERE s.status = 'removed')
  INTO sources, stale_count, removed_count
  FROM internal.analysis_view_source_rows(v) s;

  SELECT count(*), count(*) FILTER (WHERE c.locked)
    INTO cited_count, cited_locked
    FROM internal.analysis_view_citations(v.workspace_id, v.display_id) c;

  -- A keep acknowledgement is only current while the pins it acknowledged are
  -- still the pins on the row; any later re-pin voids it.
  SELECT jsonb_build_object(
      'at', e.created_at,
      'actorUserId', e.actor_user_id,
      'viewVersion', e.payload->'viewVersion',
      'revisions', e.payload->'pinnedRevisions')
    INTO acknowledgement
    FROM api.change_events e
   WHERE e.workspace_id = v.workspace_id
     AND e.entity_type = 'analysis_view'
     AND e.entity_uuid = v.id
     AND e.operation = 'resolve'
     AND e.payload->>'resolution' = 'keep'
     AND e.payload->'pinnedRevisions' = v.source_revisions
   ORDER BY e.sequence DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'viewId', v.id,
    'displayId', v.display_id,
    'name', v.name,
    'version', v.version,
    'state', CASE WHEN stale_count + removed_count > 0 THEN 'stale' ELSE 'current' END,
    'staleCount', stale_count,
    'removedCount', removed_count,
    'sources', sources,
    'citedByCount', cited_count,
    'citedByLockedCount', cited_locked,
    'acknowledged', acknowledgement
  );
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.analysis_view_source_status(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.analysis_view_source_status(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Resolution. `keep` writes history only; `update` re-pins and therefore
--    runs through the version bump trigger (and the citation guard).
-- ---------------------------------------------------------------------------
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
  IF v.id IS NULL OR NOT api.is_workspace_member(v.workspace_id) THEN
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

-- ---------------------------------------------------------------------------
-- 8. Citation list for a saved analysis: the citing record and whether it is
--    signed or locked, from the existing citation records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.analysis_view_citations(p_view_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v api.analysis_views;
BEGIN
  SELECT * INTO v FROM api.analysis_views
    WHERE id = p_view_id AND workspace_id = api.current_workspace_id();
  IF v.id IS NULL OR NOT api.is_workspace_member(v.workspace_id) THEN
    RAISE EXCEPTION 'Analysis denied' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'linkId', c.link_id,
      'sourceRecordId', c.source_record_id,
      'identifier', c.record_identifier,
      'title', c.record_title,
      'recordStatus', c.record_status,
      'linkedAt', c.linked_at,
      'locked', c.locked,
      'lockedAt', c.locked_at,
      'signed', c.signed,
      'signedAt', c.signed_at,
      'signerUserId', c.signer_user_id) ORDER BY c.linked_at, c.link_id)
    FROM internal.analysis_view_citations(v.workspace_id, v.display_id) c
  ), '[]'::jsonb);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.analysis_view_citations(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.analysis_view_citations(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
