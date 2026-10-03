CREATE TABLE "api"."sample_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sample_record_id" uuid NOT NULL,
	"experiment_record_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text,
	"planned" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by_user_id" text,
	"cancelled_by_user_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sample_reservations_quantity" CHECK ("api"."sample_reservations"."quantity" > 0),
	CONSTRAINT "chk_sample_reservations_state" CHECK ("api"."sample_reservations"."state" IN ('active','cancelled','fulfilled'))
);
--> statement-breakpoint
ALTER TABLE "api"."sample_reservations" ADD CONSTRAINT "sample_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_reservations" ADD CONSTRAINT "sample_reservations_sample_record_id_records_id_fk" FOREIGN KEY ("sample_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_reservations" ADD CONSTRAINT "sample_reservations_experiment_record_id_records_id_fk" FOREIGN KEY ("experiment_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_reservations" ADD CONSTRAINT "sample_reservations_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_reservations" ADD CONSTRAINT "sample_reservations_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sample_reservations_sample" ON "api"."sample_reservations" USING btree ("sample_record_id","state");--> statement-breakpoint
CREATE INDEX "idx_sample_reservations_experiment" ON "api"."sample_reservations" USING btree ("experiment_record_id");--> statement-breakpoint
CREATE INDEX "idx_sample_reservations_workspace" ON "api"."sample_reservations" USING btree ("workspace_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- LAB-01 step 2 — sample reservations.
--
-- A reservation holds part of a sample's current volume for a planned
-- experiment. It is deliberately separate from the canonical consume/quantity
-- ledger (`api.sample_events`): it never changes `records.properties.quantity`.
-- Instead it reduces the *free* balance, and `api.withdraw_sample` already
-- subtracts `internal.sample_reserved_quantity` from the current quantity, so
-- the withdrawal refusal into reserved volume becomes authoritative with no
-- change to that RPC.
--
-- RLS/membership is unchanged: members read; writes require the same
-- `record.create` writer capability (`api.is_workspace_writer`) as every other
-- workspace mutation. The create/cancel RPCs are SECURITY INVOKER, so records
-- and sample_reservations RLS remain the database access-control boundary.
-- ---------------------------------------------------------------------------

-- Replace the step-1 hook (which returned 0) with the real sum of active
-- reservations for the sample. SECURITY INVOKER, so sample_reservations RLS
-- scopes the sum to the caller's workspace before it is subtracted in
-- api.withdraw_sample.
CREATE OR REPLACE FUNCTION "internal"."sample_reserved_quantity"(p_record_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(r.quantity), 0)::numeric
    FROM "api"."sample_reservations" r
   WHERE r.sample_record_id = p_record_id
     AND r.state = 'active'
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."sample_reserved_quantity"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."sample_reserved_quantity"(uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "internal"."sample_reserved_quantity"(uuid) IS
  'LAB-01 step 2: the sum of active api.sample_reservations for a sample. api.withdraw_sample subtracts it from the current quantity, so a withdrawal into reserved volume is refused.';

-- ---------------------------------------------------------------------------
-- Create a reservation: locks the sample, refuses archived/non-sample records,
-- requires a purpose experiment in the active workspace and a unit that matches
-- the sample, and refuses anything above the free (current - already reserved)
-- balance. SECURITY INVOKER: RLS on records/sample_reservations applies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_sample_reservation"(
  p_record_id uuid,
  p_experiment_id uuid,
  p_quantity numeric,
  p_unit text DEFAULT NULL,
  p_planned boolean DEFAULT true,
  p_notes text DEFAULT NULL
)
RETURNS "api"."sample_reservations"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sample "api"."records";
  v_experiment "api"."records";
  v_before numeric;
  v_reserved numeric;
  v_free numeric;
  v_unit text;
  v_reservation "api"."sample_reservations";
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'reservation quantity must be positive' USING ERRCODE = 'SB006';
  END IF;

  -- A reservation is a data mutation: viewers are refused explicitly.
  IF NOT "api"."is_workspace_writer"("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'reservation denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sample FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_sample.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_sample.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_sample.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot reserve an archived sample' USING ERRCODE = 'SB004';
  END IF;

  IF p_experiment_id IS NULL THEN
    RAISE EXCEPTION 'a planned experiment is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_experiment FROM "api"."records"
   WHERE id = p_experiment_id AND kind = 'experiment';
  IF v_experiment.id IS NULL THEN
    RAISE EXCEPTION 'experiment not found in active workspace' USING ERRCODE = '42501';
  END IF;

  v_before := NULLIF(v_sample.properties ->> 'quantity', '')::numeric;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sample has no quantity to reserve' USING ERRCODE = 'SB006';
  END IF;

  v_unit := NULLIF(btrim(coalesce(v_sample.properties ->> 'quantityUnit', '')), '');
  IF p_unit IS NOT NULL AND btrim(p_unit) <> ''
     AND v_unit IS NOT NULL AND btrim(p_unit) <> v_unit THEN
    RAISE EXCEPTION 'reservation unit % does not match the sample unit %', btrim(p_unit), v_unit
      USING ERRCODE = '22023';
  END IF;
  v_unit := COALESCE(NULLIF(btrim(coalesce(p_unit, '')), ''), v_unit);

  v_reserved := COALESCE("internal"."sample_reserved_quantity"(p_record_id), 0);
  v_free := v_before - v_reserved;
  IF p_quantity > v_free THEN
    RAISE EXCEPTION 'insufficient free quantity: available %, reserved %, reserving %',
      v_free, v_reserved, p_quantity
      USING ERRCODE = 'SB006';
  END IF;

  INSERT INTO "api"."sample_reservations"
    (workspace_id, sample_record_id, experiment_record_id, quantity, unit,
     planned, notes, created_by_user_id)
  VALUES
    (v_sample.workspace_id, v_sample.id, p_experiment_id, p_quantity, v_unit,
     COALESCE(p_planned, true), p_notes, "api"."current_user_id"())
  RETURNING * INTO v_reservation;

  RETURN v_reservation;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_sample_reservation"(uuid, uuid, numeric, text, boolean, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_sample_reservation"(uuid, uuid, numeric, text, boolean, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."create_sample_reservation"(uuid, uuid, numeric, text, boolean, text) IS
  'LAB-01 step 2: hold quantity for a planned experiment. Refuses archived/non-sample records, a purpose experiment outside the active workspace, a mismatched unit and any reservation above the free (current - reserved) balance.';

-- ---------------------------------------------------------------------------
-- Cancel a reservation: releases the held volume. Only active reservations may
-- be cancelled; the actor is recorded on the row. SECURITY INVOKER.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."cancel_sample_reservation"(
  p_reservation_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS "api"."sample_reservations"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_reservation "api"."sample_reservations";
BEGIN
  IF NOT "api"."is_workspace_writer"("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'reservation denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_reservation FROM "api"."sample_reservations"
   WHERE id = p_reservation_id FOR UPDATE;
  IF v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'reservation not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_reservation.state <> 'active' THEN
    RAISE EXCEPTION 'reservation is already %', v_reservation.state
      USING ERRCODE = 'SB004';
  END IF;

  UPDATE "api"."sample_reservations"
     SET state = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = "api"."current_user_id"(),
         notes = COALESCE(p_notes, notes),
         updated_at = now()
   WHERE id = p_reservation_id
   RETURNING * INTO v_reservation;

  RETURN v_reservation;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."cancel_sample_reservation"(uuid, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."cancel_sample_reservation"(uuid, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."cancel_sample_reservation"(uuid, text) IS
  'LAB-01 step 2: release an active reservation (state -> cancelled), recording the actor. Cancelling frees the reserved volume for withdrawal.';

-- ---------------------------------------------------------------------------
-- Read model: used / reserved / free for a sample. `used` is the cumulative
-- consumed volume from the canonical sample_events ledger; `reserved` is the
-- active reservation sum; `free` is the current quantity minus reserved.
-- SECURITY DEFINER with an explicit workspace/membership check so the single
-- object is returned atomically and other workspaces can never appear.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."sample_quantity_balances"(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v_sample api.records;
  v_current numeric;
  v_used numeric;
  v_reserved numeric;
  v_unit text;
BEGIN
  v_workspace := "api"."current_workspace_id"();
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sample FROM api.records
   WHERE id = p_record_id
     AND workspace_id = v_workspace
     AND "api"."is_workspace_member"(workspace_id)
     AND kind = 'sample'
     AND deleted_at IS NULL;
  IF v_sample.id IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  v_current := COALESCE(NULLIF(v_sample.properties ->> 'quantity', '')::numeric, 0);
  v_unit := v_sample.properties ->> 'quantityUnit';
  v_used := COALESCE((
    SELECT SUM(-e.quantity_delta)
      FROM api.sample_events e
     WHERE e.record_id = p_record_id
       AND e.operation = 'consume'
  ), 0);
  v_reserved := COALESCE((
    SELECT SUM(r.quantity)
      FROM api.sample_reservations r
     WHERE r.sample_record_id = p_record_id
       AND r.state = 'active'
  ), 0);

  RETURN jsonb_build_object(
    'sampleRecordId', p_record_id,
    'unit', v_unit,
    'current', v_current,
    'used', v_used,
    'reserved', v_reserved,
    'free', v_current - v_reserved
  );
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "api"."sample_quantity_balances"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."sample_quantity_balances"(uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."sample_quantity_balances"(uuid) IS
  'LAB-01 step 2: read-only used/reserved/free balances for a sample. used is the cumulative consumed volume from api.sample_events; reserved is the sum of active api.sample_reservations; free is the current quantity minus reserved.';

-- ---------------------------------------------------------------------------
-- RLS: members read; the record.create writer capability may insert/update.
-- There is no delete grant: cancelling is an audited state change.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."sample_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "api"."sample_reservations" TO authenticated;--> statement-breakpoint

CREATE POLICY "sample_reservations_select" ON "api"."sample_reservations"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

CREATE POLICY "sample_reservations_insert" ON "api"."sample_reservations"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_writer"("workspace_id")
              AND "created_by_user_id" = "api"."current_user_id"());--> statement-breakpoint

CREATE POLICY "sample_reservations_update" ON "api"."sample_reservations"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_writer"("workspace_id"))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_writer"("workspace_id"));--> statement-breakpoint

NOTIFY pgrst, 'reload schema';