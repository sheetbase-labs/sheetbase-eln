-- INT-03: governed run boundary for enterprise connectors.
--
-- Enterprise imports read external sources server-side, so the source work
-- must happen INSIDE a governed connector run: connection, authentication,
-- download/query and row/byte-limit failures have to be recorded as failed
-- runs with bounded error codes, not as bare HTTP errors.
--
-- Content-aware idempotency is preserved without moving execution outside
-- the run by separating two identities:
--
--   selector_digest  (new column) — the provisional logical source identity
--       (connector + selector + parser + target + mapping). Known before any
--       external work; guards concurrent duplicate attempts (partial unique
--       index while running) and carries retry lineage for failed runs.
--   request_digest   (existing)  — the canonical content-aware identity
--       (everything above + the retained/read content sha256). A running
--       attempt establishes it, before commit, through
--       api.establish_connector_run_request. A prior successful run holding
--       the same content identity short-circuits the attempt as a replay,
--       so identical S3 replays never manufacture duplicate retained files.
--
-- Instrument ingestion (INT-02) is unchanged: it knows its payload before
-- the run starts and keeps using request_digest at start_connector_run.

ALTER TABLE "api"."connector_runs" ADD COLUMN "selector_digest" text;--> statement-breakpoint
ALTER TABLE "api"."connector_runs" ADD CONSTRAINT "chk_connector_runs_selector" CHECK (
  "selector_digest" IS NULL OR length(btrim("selector_digest")) BETWEEN 16 AND 128
);--> statement-breakpoint
-- One running attempt per logical selector identity: concurrent duplicate
-- imports of the same selector conflict instead of double-importing.
CREATE UNIQUE INDEX "uq_connector_runs_selector_running"
  ON "api"."connector_runs"("connector_id", "selector_digest")
  WHERE "selector_digest" IS NOT NULL AND "status" = 'running';--> statement-breakpoint
COMMENT ON COLUMN "api"."connector_runs"."selector_digest" IS
  'INT-03 provisional logical source identity; guards concurrent attempts and retry lineage. The canonical content-aware request_digest is established inside the running attempt before commit.';

--> statement-breakpoint

-- start_connector_run gains an optional provisional selector digest. When
-- only the selector identity is known (enterprise source work happens inside
-- the run), the caller passes it here instead of p_request_digest: running
-- duplicates conflict, prior failed/succeeded runs never block a start (the
-- content-aware decision happens via establish_connector_run_request).
DROP FUNCTION IF EXISTS "api"."start_connector_run"(uuid, uuid, text, text, uuid);--> statement-breakpoint
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
        RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
      END IF;
      IF v_existing.status = 'succeeded' THEN
        RETURN v_existing;
      END IF;
      -- Failed prior attempt: retrying the same request identity is only
      -- meaningful as an explicit new attempt linked to that failed run.
      IF p_retry_of_run_id IS NULL OR p_retry_of_run_id <> v_existing.id THEN
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
      RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
    END IF;
  END IF;

  IF p_retry_of_run_id IS NOT NULL THEN
    SELECT * INTO v_retry_of FROM "api"."connector_runs"
     WHERE id = p_retry_of_run_id AND workspace_id = p_workspace_id;
    IF v_retry_of IS NULL THEN
      RAISE EXCEPTION 'retry target not found' USING ERRCODE = 'SB036';
    END IF;
  END IF;

  INSERT INTO "api"."connector_runs"(
    workspace_id, connector_id, trigger_kind, status, attempt, retry_of_run_id,
    request_digest, selector_digest, actor_user_id, actor_credential_id
  ) VALUES (
    p_workspace_id, p_connector_id, p_trigger_kind, 'running',
    CASE WHEN v_retry_of.id IS NOT NULL THEN v_retry_of.attempt + 1 ELSE 1 END,
    p_retry_of_run_id,
    CASE WHEN p_request_digest IS NULL THEN NULL ELSE btrim(p_request_digest) END,
    CASE WHEN p_selector_digest IS NULL THEN NULL ELSE btrim(p_selector_digest) END,
    "api"."current_user_id"(), "api"."current_credential_id"()
  ) RETURNING * INTO v;
  RETURN v;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."start_connector_run"(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."start_connector_run"(uuid, uuid, text, text, uuid, text) TO authenticated;

--> statement-breakpoint

-- INT-03: a running enterprise attempt establishes its canonical
-- content-aware request identity after the source read, before any commit.
-- A prior successful run holding the same content identity means the identical
-- request was already imported: the attempt must not retain files or commit
-- rows again — the caller short-circuits into a replay of the prior result.
CREATE OR REPLACE FUNCTION "api"."establish_connector_run_request"(
  p_workspace_id uuid,
  p_run_id uuid,
  p_request_digest text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v "api"."connector_runs";
BEGIN
  IF "api"."current_workspace_id"() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT "api"."is_workspace_writer"(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_request_digest IS NULL OR length(btrim(p_request_digest)) NOT BETWEEN 16 AND 128 THEN
    RAISE EXCEPTION 'invalid request digest' USING ERRCODE = 'SB034';
  END IF;
  SELECT * INTO v FROM "api"."connector_runs"
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run already finished' USING ERRCODE = 'SB042';
  END IF;
  -- Identical content was already imported successfully: replay, never
  -- duplicate retained files or Dataset rows.
  IF EXISTS (
    SELECT 1 FROM "api"."connector_runs"
     WHERE connector_id = v.connector_id
       AND request_digest = btrim(p_request_digest)
       AND workspace_id = p_workspace_id
       AND status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'request already imported' USING ERRCODE = 'SB047';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."connector_runs"
     WHERE connector_id = v.connector_id
       AND request_digest = btrim(p_request_digest)
       AND workspace_id = p_workspace_id
       AND status = 'running'
       AND id <> p_run_id
  ) THEN
    RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
  END IF;
  UPDATE "api"."connector_runs"
     SET request_digest = btrim(p_request_digest)
   WHERE id = p_run_id;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."establish_connector_run_request"(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."establish_connector_run_request"(uuid, uuid, text) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
