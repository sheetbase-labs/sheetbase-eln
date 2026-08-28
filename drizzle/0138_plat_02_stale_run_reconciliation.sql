-- PLAT-02 — bounded reconciliation of stale connector runs.
--
-- A connector run is request-scoped work executed inside the application
-- process. If the process dies after the run enters `running`, the run would
-- otherwise stay ambiguous forever: request-digest retries raise SB044
-- ('run already in progress') and the partial unique index on
-- (connector_id, selector_digest) blocks a second running attempt.
--
-- Policy: a run that has been `running` longer than the authoritative
-- database threshold is reconciled deterministically — it is marked failed
-- with the bounded error code `stale_run_reconciled`, a warning is appended
-- to the run's durable log, and the starting attempt is linked to it as its
-- retry (attempt + 1, retry_of_run_id set). A legitimate long-running
-- execution must finish within the threshold.
--
-- SECURITY/RELIABILITY BOUNDARY: the threshold is a fixed database policy,
-- NOT a callable parameter. The function is executable by any workspace
-- writer; if callers could pass their own threshold, any member could fail
-- someone else's in-flight run by requesting a tiny threshold. Changing the
-- threshold is a deliberate migration decision (or, later, a controlled
-- system configuration only privileged code can mutate).

DROP FUNCTION IF EXISTS "api"."start_connector_run"(uuid, uuid, text, text, uuid, text);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "api"."start_connector_run"(
  p_workspace_id uuid,
  p_connector_id uuid,
  p_trigger_kind text DEFAULT 'manual',
  p_request_digest text DEFAULT NULL,
  p_retry_of_run_id uuid DEFAULT NULL,
  p_selector_digest text DEFAULT NULL
)
RETURNS "api"."connector_runs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Authoritative staleness threshold (seconds). Fixed server/database
  -- policy: callers cannot lower, raise, or bypass it.
  v_stale_threshold_seconds CONSTANT integer := 900;
  v_connector "api"."connectors";
  v_retry_of "api"."connector_runs";
  v_existing "api"."connector_runs";
  v_running uuid;
  v "api"."connector_runs";
BEGIN
  IF "api"."current_workspace_id"() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT "api"."is_workspace_writer"(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_trigger_kind NOT IN ('manual', 'scheduled', 'event') THEN
    RAISE EXCEPTION 'invalid run trigger' USING ERRCODE = 'SB034';
  END IF;
  SELECT * INTO v_connector FROM "api"."connectors"
   WHERE id = p_connector_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_connector IS NULL THEN
    RAISE EXCEPTION 'connector not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_connector.status <> 'active' THEN
    RAISE EXCEPTION 'connector is not active' USING ERRCODE = 'SB042';
  END IF;

  IF p_request_digest IS NOT NULL THEN
    IF length(btrim(p_request_digest)) NOT BETWEEN 16 AND 128 THEN
      RAISE EXCEPTION 'invalid request digest' USING ERRCODE = 'SB034';
    END IF;
    SELECT * INTO v_existing FROM "api"."connector_runs"
     WHERE connector_id = p_connector_id
       AND request_digest = btrim(p_request_digest)
       AND workspace_id = p_workspace_id
     ORDER BY started_at DESC
     LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.status = 'running' THEN
        IF v_existing.started_at < clock_timestamp() - make_interval(secs => v_stale_threshold_seconds) THEN
          UPDATE "api"."connector_runs"
             SET status = 'failed',
                 error_code = 'stale_run_reconciled',
                 error_message = 'run exceeded the staleness threshold and was reconciled',
                 finished_at = clock_timestamp()
           WHERE id = v_existing.id;
          PERFORM "api"."append_connector_run_log"(
            p_workspace_id,
            v_existing.id,
            'warning',
            'reconcile',
            'Stale running attempt reconciled by a newer start.',
            '{"reason": "stale_run_reconciled"}'::jsonb
          );
          -- The reconciled attempt becomes the retry lineage of this start.
          v_retry_of := v_existing;
        ELSE
          RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
        END IF;
      END IF;
      IF v_existing.status = 'succeeded' THEN
        RETURN v_existing;
      END IF;
      -- Failed prior attempt: retrying the same request identity is normally
      -- an explicit new attempt linked to that failed run. An auto-reconciled
      -- stale run already set v_retry_of above; only an untouched failed run
      -- still requires the explicit linkage.
      IF v_retry_of.id IS NULL
        AND (p_retry_of_run_id IS NULL OR p_retry_of_run_id <> v_existing.id) THEN
        RAISE EXCEPTION 'request previously failed; retry with retry_of_run_id'
          USING ERRCODE = 'SB045';
      END IF;
    END IF;
  END IF;

  -- INT-03: provisional selector identity — conflict only with a run that is
  -- still running; failed runs are retried as linked attempts via the
  -- product flow, and prior successes are decided on content identity later.
  IF p_selector_digest IS NOT NULL THEN
    IF length(btrim(p_selector_digest)) NOT BETWEEN 16 AND 128 THEN
      RAISE EXCEPTION 'invalid selector digest' USING ERRCODE = 'SB034';
    END IF;
    SELECT id INTO v_running FROM "api"."connector_runs"
     WHERE connector_id = p_connector_id
       AND selector_digest = btrim(p_selector_digest)
       AND workspace_id = p_workspace_id
       AND status = 'running'
     LIMIT 1;
    IF v_running IS NOT NULL THEN
      IF (
        SELECT started_at FROM "api"."connector_runs" WHERE id = v_running
      ) < clock_timestamp() - make_interval(secs => v_stale_threshold_seconds) THEN
        UPDATE "api"."connector_runs"
           SET status = 'failed',
               error_code = 'stale_run_reconciled',
               error_message = 'run exceeded the staleness threshold and was reconciled',
               finished_at = clock_timestamp()
         WHERE id = v_running;
        PERFORM "api"."append_connector_run_log"(
          p_workspace_id,
          v_running,
          'warning',
          'reconcile',
          'Stale running attempt reconciled by a newer start.',
          '{"reason": "stale_run_reconciled"}'::jsonb
        );
        IF v_retry_of.id IS NULL THEN
          SELECT * INTO v_retry_of FROM "api"."connector_runs" WHERE id = v_running;
        END IF;
      ELSE
        RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
      END IF;
    END IF;
  END IF;

  IF p_retry_of_run_id IS NOT NULL THEN
    IF v_retry_of.id IS DISTINCT FROM p_retry_of_run_id THEN
      SELECT * INTO v_retry_of FROM "api"."connector_runs"
       WHERE id = p_retry_of_run_id AND workspace_id = p_workspace_id;
      IF v_retry_of IS NULL THEN
        RAISE EXCEPTION 'retry target not found' USING ERRCODE = 'SB036';
      END IF;
    END IF;
  END IF;

  INSERT INTO "api"."connector_runs"(
    workspace_id, connector_id, trigger_kind, status, attempt, retry_of_run_id,
    request_digest, selector_digest, actor_user_id, actor_credential_id
  ) VALUES (
    p_workspace_id, p_connector_id, p_trigger_kind, 'running',
    CASE WHEN v_retry_of.id IS NOT NULL THEN v_retry_of.attempt + 1 ELSE 1 END,
    COALESCE(v_retry_of.id, p_retry_of_run_id),
    CASE WHEN p_request_digest IS NULL THEN NULL ELSE btrim(p_request_digest) END,
    CASE WHEN p_selector_digest IS NULL THEN NULL ELSE btrim(p_selector_digest) END,
    "api"."current_user_id"(), "api"."current_credential_id"()
  ) RETURNING * INTO v;
  RETURN v;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."start_connector_run"(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."start_connector_run"(uuid, uuid, text, text, uuid, text) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
