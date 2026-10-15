-- DSET follow-up — two read-model corrections, applied without rewriting the
-- migrations that environments have already run.
--
-- 1. `api.dataset_list_summary` counted *flag rows*. A value that carries a
--    system rule flag and a person's manual flag is one value out of range but
--    two flags, so "N out of range" overstated the number of offending values
--    (and "N columns missing units" the number of columns). `out_of_range_count`
--    now counts distinct values (`row_id`, `field_id`) and `missing_unit_count`
--    distinct columns (`field_id`, matching `missing_unit_fields`), which is
--    what the copy rendering them states: "N values are outside the model's
--    allowed range" and "N columns missing units".
--
-- 2. `api.dataset_version_list` attributed every non-pipeline, non-API
--    snapshot to a person ("Saved by hand"), including the snapshots the import
--    commit froze — so a snapshot labelled "Import qa3-append.csv" read as
--    hand-made. `source` now reports the import receipt behind it
--    (`api.dataset_imports.snapshot_version_id`, written by the import commit
--    RPCs) as kind 'import' with the file it read, falling back to pipeline
--    output and then manual/API as before.
--
-- Both are CREATE OR REPLACE of the current definitions, so signatures, ACLs,
-- grants and SECURITY settings are unchanged: the bodies below are those of
-- 0422_dataset_list_summary_project.sql and 0279_dataset_version_read_model.sql
-- with only the changes described above.

CREATE OR REPLACE FUNCTION api.dataset_list_summary(
  p_project_id uuid DEFAULT NULL,
  p_include_archived boolean DEFAULT true,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  display_id text,
  name text,
  model text,
  project_id uuid,
  created_by_user_id text,
  row_count bigint,
  issue_count bigint,
  updated_at timestamptz,
  archived_at timestamptz,
  experiment_display_id text,
  out_of_range_count bigint,
  missing_unit_count bigint,
  missing_unit_fields text[],
  review_state text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT d.id, d.display_id, d.name,
    -- The design's Model column carries the schema version ("ViCell v2").
    sd.name || ' v' || sv.version,
    d.primary_project_id,
    d.created_by_user_id,
    (SELECT count(*) FROM api.dataset_rows r WHERE r.dataset_id = d.id),
    (SELECT count(*) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL),
    d.updated_at, d.archived_at,
    exp.identifier,
    -- One row per out-of-range value, not per flag: a person's manual flag on a
    -- value the system rule already flagged is a second flag on the same value.
    (SELECT count(DISTINCT (f.row_id, f.field_id)) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'out_of_range'),
    -- One row per column with a missing unit, matching `missing_unit_fields`.
    (SELECT count(DISTINCT f.field_id) FROM api.dataset_value_flags f
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'missing_unit'),
    (SELECT array_agg(DISTINCT fv.label ORDER BY fv.label)
       FROM api.dataset_value_flags f
       JOIN api.dataset_schema_version_fields fv
         ON fv.schema_version_id = d.schema_version_id
        AND fv.field_id = f.field_id
      WHERE f.dataset_id = d.id AND f.cleared_at IS NULL
        AND f.kind = 'missing_unit'),
    CASE
      WHEN exp.status = 'approved' THEN 'locked'
      WHEN exp.status = 'in_review' AND exp.locked_at IS NULL THEN 'in_review'
      ELSE NULL
    END
  FROM api.datasets d
  LEFT JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
  LEFT JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
  LEFT JOIN LATERAL (
    SELECT r.identifier, r.status, r.locked_at
      FROM api.record_links l
      JOIN api.records r ON r.id = l.source_record_id
     WHERE l.target_kind = 'dataset'
       AND l.link_type = 'dataset'
       AND l.target_identifier = d.display_id
     ORDER BY r.created_at
     LIMIT 1
  ) exp ON true
  WHERE (p_project_id IS NULL OR d.primary_project_id = p_project_id)
    AND (p_include_archived OR d.archived_at IS NULL)
  ORDER BY d.updated_at DESC, d.id
  LIMIT p_limit OFFSET coalesce(p_offset, 0)
$$;
--> statement-breakpoint

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
          -- The import receipt that froze this snapshot: the import wizard and
          -- a connector both commit through the migration RPCs, which snapshot
          -- with 'Import <file>' as the label. Without this the snapshot was
          -- attributed to the person who ran the import ("Saved by hand")
          -- while its label said an import made it.
          (
            SELECT jsonb_build_object(
              'kind', 'import',
              'runId', NULL,
              'definitionName', NULL,
              'triggerKind', NULL,
              'status', NULL,
              'label', f.filename,
              'startedAt', NULL
            )
            FROM api.dataset_imports i
            LEFT JOIN api.dataset_import_files f ON f.id = i.file_id
            WHERE i.snapshot_version_id = v.id
              AND i.workspace_id = v.workspace_id
              AND i.status = 'committed'
            ORDER BY i.created_at DESC, i.id DESC
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
NOTIFY pgrst, 'reload schema';
