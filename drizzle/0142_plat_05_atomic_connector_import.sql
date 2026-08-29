-- PLAT-05 — atomic all-or-nothing connector import.
--
-- The connector import path previously issued one `commit_dataset_row_batch`
-- per 1000-row chunk as independent transactions, so a later chunk failure
-- left a failed run with a partially mutated Dataset. This migration adds one
-- SECURITY DEFINER RPC that runs every canonical ≤1000-row chunk inside a
-- single database transaction: any chunk failure aborts the whole statement
-- and rolls back every earlier chunk. Canonical validation, revision,
-- provenance, idempotency and write-back semantics are unchanged — the chunks
-- are executed by the existing governed RPCs.

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch_atomic(
  p_dataset_id uuid,
  p_expected_dataset_revision bigint,
  p_rows jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dataset api.datasets;
  existing api.dataset_bulk_commits;
  validation jsonb;
  digest text;
  actor_user text;
  actor_credential uuid;
  total_rows integer;
  chunk_rows jsonb;
  chunk_result jsonb;
  chunk_revision bigint;
  chunk_index integer;
  result_rows jsonb := '[]'::jsonb;
  final_revision bigint;
BEGIN
  actor_user := api.current_user_id();
  actor_credential := api.current_credential_id();
  SELECT * INTO dataset
    FROM api.datasets
   WHERE id = p_dataset_id
     AND workspace_id = api.current_workspace_id()
     AND api.is_workspace_writer(workspace_id)
   FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501';
  END IF;
  IF dataset.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'cannot commit to archived Dataset' USING ERRCODE = '22023';
  END IF;
  IF p_expected_dataset_revision IS NULL
     OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100000
     OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128
  THEN
    RAISE EXCEPTION 'expected Dataset revision and 1 to 100000 batch rows are required'
      USING ERRCODE = '22023';
  END IF;
  total_rows := jsonb_array_length(p_rows);

  -- Whole-request identity (matches the canonical digest over the full batch).
  digest := encode(sha256(convert_to(
    jsonb_build_object(
      'datasetId', p_dataset_id,
      'expectedDatasetRevision', p_expected_dataset_revision,
      'rows', p_rows
    )::text, 'UTF8')), 'hex');

  -- Idempotent replay of an identical atomic request.
  SELECT * INTO existing FROM api.dataset_bulk_commits
   WHERE workspace_id = dataset.workspace_id
     AND idempotency_key = p_idempotency_key
     AND (
       (actor_user IS NOT NULL AND actor_user_id = actor_user)
       OR (actor_credential IS NOT NULL AND actor_credential_id = actor_credential)
     );
  IF existing.id IS NOT NULL THEN
    IF existing.dataset_id <> p_dataset_id OR existing.request_digest <> digest THEN
      RAISE EXCEPTION 'idempotency key was used for a different Dataset batch'
        USING ERRCODE = '23505';
    END IF;
    RETURN existing.result || jsonb_build_object('idempotent', true);
  END IF;

  -- Fail fast before any write: pre-validate every chunk against the pinned
  -- expected revision (read-only). Data errors surface before a single row is
  -- inserted; the canonical per-chunk commits re-validate authoritatively.
  FOR chunk_index IN 0..(total_rows - 1) / 1000 LOOP
    chunk_rows := (
      SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
        FROM (
          SELECT elem FROM jsonb_array_elements(p_rows) WITH ORDINALITY t(elem, ordinal)
           WHERE ordinal BETWEEN (chunk_index * 1000) + 1 AND (chunk_index + 1) * 1000
        ) x
    );
    validation := api.validate_dataset_row_batch(
      p_dataset_id, p_expected_dataset_revision, chunk_rows
    );
    IF (validation->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'Dataset import rejected: %',
        left(coalesce(validation->>'errors', 'validation failed'), 500)
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Commit every chunk through the canonical governed RPC inside this one
  -- transaction. A failure anywhere aborts the statement and rolls back all
  -- earlier chunks (and their receipts) — all-or-nothing.
  chunk_revision := p_expected_dataset_revision;
  FOR chunk_index IN 0..(total_rows - 1) / 1000 LOOP
    chunk_rows := (
      SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
        FROM (
          SELECT elem FROM jsonb_array_elements(p_rows) WITH ORDINALITY t(elem, ordinal)
           WHERE ordinal BETWEEN (chunk_index * 1000) + 1 AND (chunk_index + 1) * 1000
        ) x
    );
    chunk_result := api.commit_dataset_row_batch(
      p_dataset_id, chunk_revision, chunk_rows,
      p_idempotency_key || ':' || chunk_index::text
    );
    IF (chunk_result->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'Dataset import commit rejected' USING ERRCODE = '22023';
    END IF;
    chunk_revision := (chunk_result->>'datasetRevision')::bigint;
    final_revision := chunk_revision;
    result_rows := result_rows || coalesce(chunk_result->'rows', '[]'::jsonb);
  END LOOP;

  -- One durable receipt for the whole atomic request.
  INSERT INTO api.dataset_bulk_commits(
    workspace_id, dataset_id, actor_user_id, actor_credential_id,
    idempotency_key, request_digest, result
  ) VALUES (
    dataset.workspace_id, dataset.id, actor_user, actor_credential,
    p_idempotency_key, digest,
    jsonb_build_object(
      'ok', true, 'datasetId', dataset.id,
      'datasetRevision', final_revision, 'rows', result_rows
    )
  );
  RETURN jsonb_build_object(
    'ok', true, 'datasetId', dataset.id,
    'datasetRevision', final_revision, 'rows', result_rows
  );
END;
$$;

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION api.commit_dataset_row_batch_atomic(uuid, bigint, jsonb, text) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.commit_dataset_row_batch_atomic(uuid, bigint, jsonb, text) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
