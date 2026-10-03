-- DSET-03.1 (remaining) — complete the snapshot list read model.
--
-- The list previously exposed maker/count/change/retention only. This adds,
-- per snapshot and additively:
--   * creator identity: the user or API credential plus a display name;
--   * `source`: the pipeline run that produced it, else manual/API;
--   * `contentHash`: a deterministic sha256 over the frozen rows, values and
--     flags, so identical content hashes identically and changed content does
--     not;
--   * `citedBy`: the signed revisions, analyses and pipeline runs that cite
--     the snapshot;
--   * `rowsRemovedAt`: when the retention job removed its rows, if so.
-- The list adds the workspace retention policy beside the existing
-- `dataset_version_retention` reason/keptUntil, so the UI can present the real
-- periods rather than repeating hardcoded text. The retention decision itself
-- is untouched.
--
-- Read-only: the version-row immutability guard forbids writing a stored hash
-- onto a frozen snapshot, so the hash is computed from the frozen evidence at
-- read time. RLS/membership is unchanged — the Dataset is resolved through the
-- caller's workspace as before, and every cited-by sub-read is scoped to the
-- version's workspace so it cannot leak another workspace's rows.

CREATE OR REPLACE FUNCTION internal.dataset_version_content_hash(p_version_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH entries AS (
    SELECT 'row|' || r.row_id::text || '|' || r.revision::text AS entry
      FROM api.dataset_version_rows r
     WHERE r.dataset_version_id = p_version_id
    UNION ALL
    SELECT 'value|' || v.row_id::text || '|' || v.field_id::text || '|' ||
           v.ordinal::text || '|' ||
           (to_jsonb(v) - 'dataset_version_id' - 'row_id' - 'field_id' - 'ordinal')::text
      FROM api.dataset_version_values v
     WHERE v.dataset_version_id = p_version_id
    UNION ALL
    SELECT 'flag|' || f.row_id::text || '|' || f.field_id::text || '|' ||
           f.kind || '|' || f.source || '|' || coalesce(f.reason, '') || '|' ||
           coalesce(f.comment, '') || '|' || coalesce(f.set_by_user_id, '') || '|' ||
           coalesce(f.set_at::text, '')
      FROM api.dataset_version_flags f
     WHERE f.dataset_version_id = p_version_id
  )
  SELECT 'sha256:' || encode(
    sha256(convert_to(coalesce(string_agg(entry, E'\n' ORDER BY entry), ''), 'UTF8')),
    'hex'
  )
  FROM entries;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.dataset_version_content_hash(uuid) FROM PUBLIC;
--> statement-breakpoint

-- The existing `api.dataset_version_retention` decision (reason/keptUntil) is
-- left exactly as it is; the list adds the workspace policy beside it so the
-- UI can state the real periods rather than repeating hardcoded text.

CREATE OR REPLACE FUNCTION api.dataset_version_list(p_dataset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
BEGIN
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'label', v.label,
        'createdAt', v.created_at,
        'createdByUserId', v.created_by_user_id,
        'createdByCredentialId', v.created_by_credential_id,
        'createdByName', coalesce(
          (SELECT u.name FROM internal."user" u WHERE u.id = v.created_by_user_id),
          (SELECT c.name FROM internal.api_credentials c WHERE c.id = v.created_by_credential_id)
        ),
        'sourceDatasetRevision', v.source_dataset_revision,
        'rowCount', (
          SELECT count(*) FROM api.dataset_version_rows r
          WHERE r.dataset_version_id = v.id
        ),
        'rowsRemovedAt', (
          SELECT p.rows_removed_at FROM api.dataset_version_prunes p
          WHERE p.dataset_version_id = v.id
        ),
        'contentHash', internal.dataset_version_content_hash(v.id),
        'change', CASE WHEN prev.id IS NULL THEN NULL
          ELSE api.compare_dataset_versions(prev.id, v.id, 1, 0) -> 'counts'
        END,
        'retention', api.dataset_version_retention(v.id) || jsonb_build_object(
          'policy', jsonb_build_object(
            'citedYears', coalesce(ws.snapshot_cited_retention_years, 15),
            'uncitedYears', coalesce(ws.snapshot_uncited_retention_years, 2)
          )
        ),
        'source', coalesce(
          (
            SELECT jsonb_build_object(
              'kind', 'pipeline_run',
              'runId', o.run_id,
              'definitionName', pd.name,
              'triggerKind', r.trigger_kind,
              'status', r.status,
              'label', o.label,
              'startedAt', r.started_at
            )
            FROM api.pipeline_run_outputs o
            LEFT JOIN api.pipeline_runs r
              ON r.id = o.run_id AND r.workspace_id = o.workspace_id
            LEFT JOIN api.pipeline_definition_versions dv
              ON dv.id = r.definition_version_id
            LEFT JOIN api.pipeline_definitions pd
              ON pd.id = dv.definition_id
            WHERE o.dataset_version_id = v.id
              AND o.workspace_id = v.workspace_id
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT 1
          ),
          jsonb_build_object(
            'kind', CASE WHEN v.created_by_credential_id IS NOT NULL THEN 'api' ELSE 'manual' END,
            'runId', NULL,
            'definitionName', NULL,
            'triggerKind', NULL,
            'status', NULL,
            'label', NULL,
            'startedAt', NULL
          )
        ),
        'citedBy', jsonb_build_object(
          'signedRevisions', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'revisionId', e.revision_id,
              'signedAt', s.signed_at,
              'signerUserId', s.signer_user_id
            ) ORDER BY s.signed_at)
            FROM api.revision_sheet_evidence e
            JOIN api.signatures s
              ON s.revision_id = e.revision_id AND s.workspace_id = e.workspace_id
            WHERE e.workspace_id = v.workspace_id
              AND e.dataset_versions ? v.id::text
              AND s.signature_meaning = 'approve-for-record'
          ), '[]'::jsonb),
          'pipelineRuns', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'runId', r.id,
              'status', r.status,
              'triggerKind', r.trigger_kind,
              'startedAt', r.started_at
            ) ORDER BY r.started_at)
            FROM api.pipeline_runs r
            WHERE r.workspace_id = v.workspace_id
              AND EXISTS (
                SELECT 1 FROM jsonb_each_text(r.input_versions) x
                WHERE x.value = v.id::text
              )
          ), '[]'::jsonb),
          'analyses', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'blockId', b.id,
              'recordId', b.record_id
            ) ORDER BY b.id)
            FROM api.blocks b
            JOIN api.records rec ON rec.id = b.record_id
            WHERE rec.workspace_id = v.workspace_id
              AND b.type = 'analysis'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  coalesce(b.payload->'frozen'->'datasetProvenance', '[]'::jsonb)
                ) p
                WHERE p->>'datasetVersionId' = v.id::text
              )
          ), '[]'::jsonb)
        )
      )
      ORDER BY v.created_at DESC, v.id DESC
    )
    FROM api.dataset_versions v
    LEFT JOIN LATERAL (
      SELECT p.id FROM api.dataset_versions p
      WHERE p.dataset_id = v.dataset_id
        AND (p.created_at, p.id) < (v.created_at, v.id)
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    ) prev ON true
    LEFT JOIN api.workspace_settings ws ON ws.workspace_id = v.workspace_id
    WHERE v.dataset_id = d.id
  ), '[]'::jsonb);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_version_list(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_version_list(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
