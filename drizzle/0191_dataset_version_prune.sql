-- DSET-04.2 — the retention job.
--
-- Removes the row data of eligible snapshots only: an archived dataset whose
-- uncited retention has passed, with no manual keep and no signed citation.
-- The snapshot's identity and history are kept, the removal is recorded and a
-- change event is emitted. Run by the server job as the migrator.

REVOKE ALL ON api.dataset_version_prunes FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- The immutability guard stays in force everywhere except inside the retention
-- job, which sets `sheetbase.dataset_prune` for its own transaction only.
CREATE OR REPLACE FUNCTION internal.prevent_dataset_version_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('sheetbase.dataset_prune', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Dataset Versions are immutable evidence' USING ERRCODE = 'SB072';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.prune_dataset_versions(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r record;
  seq bigint;
  pruned jsonb := '[]'::jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid prune limit' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('sheetbase.dataset_prune', 'on', true);

  FOR r IN
    SELECT v.id, v.workspace_id,
      (SELECT count(*) FROM api.dataset_version_rows vr
        WHERE vr.dataset_version_id = v.id) AS row_count
    FROM api.dataset_versions v
    JOIN api.datasets d ON d.id = v.dataset_id
    LEFT JOIN api.workspace_settings ws ON ws.workspace_id = v.workspace_id
    LEFT JOIN api.dataset_version_keeps k ON k.dataset_version_id = v.id
    WHERE NOT EXISTS (
        SELECT 1 FROM api.dataset_version_prunes p
        WHERE p.dataset_version_id = v.id
      )
      AND d.archived_at IS NOT NULL
      AND (k.kept_until IS NULL OR k.kept_until <= now())
      AND d.archived_at + make_interval(years => coalesce(ws.snapshot_uncited_retention_years, 2)) <= now()
      AND NOT EXISTS (
        SELECT 1 FROM api.revision_sheet_evidence e
        JOIN api.signatures s ON s.revision_id = e.revision_id
        WHERE s.signature_meaning = 'approve-for-record'
          AND e.dataset_versions ? v.id::text
      )
    ORDER BY d.archived_at, v.id
    LIMIT p_limit
    FOR UPDATE OF v SKIP LOCKED
  LOOP
    DELETE FROM api.dataset_version_values WHERE dataset_version_id = r.id;
    DELETE FROM api.dataset_version_rows WHERE dataset_version_id = r.id;
    INSERT INTO api.dataset_version_prunes
      (dataset_version_id, rows_removed_at, pruned_row_count)
    VALUES (r.id, now(), r.row_count);
    INSERT INTO api.workspace_change_seq (workspace_id, last_seq)
    VALUES (r.workspace_id, 1)
    ON CONFLICT (workspace_id) DO UPDATE
      SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO seq;
    INSERT INTO api.change_events
      (id, workspace_id, sequence, entity_type, entity_uuid, operation, payload)
    VALUES (gen_random_uuid(), r.workspace_id, seq, 'dataset_version', r.id, 'delete',
            jsonb_build_object('rowsRemoved', r.row_count));
    pruned := pruned || jsonb_build_object(
      'datasetVersionId', r.id,
      'rowsRemoved', r.row_count
    );
  END LOOP;

  PERFORM set_config('sheetbase.dataset_prune', '', true);

  RETURN jsonb_build_object(
    'prunedCount', jsonb_array_length(pruned),
    'pruned', pruned
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.prune_dataset_versions(integer) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
