-- REG-003: reagent inventory ledger and controlled movement RPC.
-- Reagents are `records` of kind='reagent' with configurable properties
-- (supplier, catalog_no, lot, expiry, quantity, unit, storage) defined by
-- record_field_definitions (SCI-001 / decision 0026). This migration adds the
-- auditable quantity-change ledger and the controlled mutation RPC that
-- receive, consume, quarantine and restore workflows call.
--
-- `reagent_movements` snapshots supplier / catalog_no / lot / expiry at the
-- time of each movement so the historical identity used by experiments is
-- preserved even when the reagent record's properties are later updated
-- (decision: REG-003 §"Preserve historical supplier and lot details").
--
-- Low-stock and expiry attention are NOT stored statuses: they are derived
-- from configured thresholds (low_stock_threshold, expiry_warning_days
-- properties) by the application library. The RPC never sets status to
-- 'low_stock'; it keeps the lifecycle vocabulary authoritative.

CREATE TABLE "api"."reagent_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reagent_record_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"quantity_delta" numeric NOT NULL DEFAULT 0,
	"resulting_quantity" numeric NOT NULL,
	"unit" text,
	"supplier" text,
	"catalog_no" text,
	"lot" text,
	"expiry" date,
	"reason" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "reagent_movements_workspace_id_workspaces_id_fk"
	FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "reagent_movements_reagent_record_id_records_id_fk"
	FOREIGN KEY ("reagent_record_id") REFERENCES "api"."records"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "reagent_movements_actor_user_id_user_id_fk"
	FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id")
	ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "chk_reagent_movements_operation"
	CHECK ("operation" IN ('receive','consume','quarantine','restore'));
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "chk_reagent_movements_quantity_delta"
	CHECK (
		("operation" = 'receive' AND "quantity_delta" > 0)
		OR ("operation" = 'consume' AND "quantity_delta" < 0)
		OR ("operation" IN ('quarantine','restore') AND "quantity_delta" = 0)
	);
--> statement-breakpoint
ALTER TABLE "api"."reagent_movements"
	ADD CONSTRAINT "chk_reagent_movements_resulting_quantity"
	CHECK ("resulting_quantity" >= 0);
--> statement-breakpoint
CREATE INDEX "idx_reagent_movements_workspace"
	ON "api"."reagent_movements" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_reagent_movements_reagent_created"
	ON "api"."reagent_movements" ("reagent_record_id", "created_at" DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants + RLS. Members read their workspace's movements; api_client reads
-- with workspace pinning. No INSERT/UPDATE/DELETE grant to any request role:
-- the `record_reagent_movement` RPC (SECURITY DEFINER) is the only writer, so
-- quantity logic cannot be bypassed by a direct PostgREST POST. RLS is
-- enabled but not forced, so the SECURITY DEFINER function (owned by the
-- table owner) can INSERT while request roles are still scoped on SELECT.
-- ---------------------------------------------------------------------------
REVOKE ALL ON "api"."reagent_movements" FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."reagent_movements" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."reagent_movements" TO api_client;
--> statement-breakpoint

ALTER TABLE "api"."reagent_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "reagent_movements_select" ON "api"."reagent_movements"
	FOR SELECT TO authenticated
	USING ("workspace_id" = "api"."current_workspace_id"()
	       AND "api"."is_workspace_member"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "reagent_movements_select_api_client" ON "api"."reagent_movements"
	FOR SELECT TO api_client
	USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- record_reagent_movement: controlled inventory mutation.
-- SECURITY DEFINER (owned by migrator) so it can INSERT into reagent_movements
-- without a direct INSERT grant. It performs its own workspace-membership and
-- record-ownership checks (the FOR UPDATE SELECT is workspace-scoped), so the
-- SECURITY DEFINER elevation does not widen access. The records UPDATE fires
-- the existing change_event_records trigger, which emits a durable change
-- event with actor attribution from the request JWT claims.
--
-- Quantity rules:
--   receive   — delta > 0; resulting = qty + delta; status -> 'available'
--               (restocks a consumed/reserved reagent). Rejected when the
--               reagent is quarantined (restore first) or expired.
--   consume   — delta < 0 (caller passes a positive magnitude; the RPC
--               negates it); resulting = qty - |delta|. Rejects below zero
--               with SB006 insufficient_stock. At zero the status becomes
--               'consumed'. Rejected when quarantined or expired.
--   quarantine — delta 0; requires status 'available'; status -> 'quarantined'.
--   restore    — delta 0; requires status 'quarantined'; status -> 'available'.
--
-- Optimistic concurrency: p_expected_metadata_version must match. Archived
-- reagents are frozen (restore the record before moving stock). Returns
-- { movement, record } as JSONB.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."record_reagent_movement"(
  p_reagent_record_id uuid,
  p_operation text,
  p_expected_metadata_version int,
  p_quantity_delta numeric DEFAULT 0,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_record "api"."records";
  v_props jsonb;
  v_qty numeric;
  v_unit text;
  v_supplier text;
  v_catalog_no text;
  v_lot text;
  v_expiry date;
  v_magnitude numeric;
  v_resulting numeric;
  v_next_status text;
  v_op text := p_operation;
  v_movement "api"."reagent_movements";
  v_new_props jsonb;
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_op NOT IN ('receive','consume','quarantine','restore') THEN
    RAISE EXCEPTION 'unsupported reagent movement operation: %', v_op USING ERRCODE = 'SB004';
  END IF;

  SELECT * INTO v_record FROM "api"."records"
    WHERE id = p_reagent_record_id
      AND workspace_id = v_workspace_id
    FOR UPDATE;
  IF v_record IS NULL THEN
    RAISE EXCEPTION 'reagent not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_record.kind <> 'reagent' THEN
    RAISE EXCEPTION 'record is not a reagent' USING ERRCODE = 'SB004';
  END IF;
  IF v_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived reagents are frozen until restored' USING ERRCODE = 'SB004';
  END IF;
  IF v_record.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_record.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_props := COALESCE(v_record.properties, '{}'::jsonb);
  BEGIN
    v_qty := NULLIF(v_props ->> 'quantity', '')::numeric;
  EXCEPTION WHEN invalid_text_representation THEN
    v_qty := NULL;
  END;
  v_qty := COALESCE(v_qty, 0);
  v_unit := v_props ->> 'unit';
  v_supplier := v_props ->> 'supplier';
  v_catalog_no := v_props ->> 'catalog_no';
  v_lot := v_props ->> 'lot';
  BEGIN
    v_expiry := NULLIF(v_props ->> 'expiry', '')::date;
  EXCEPTION WHEN invalid_text_representation THEN
    v_expiry := NULL;
  END;

  v_next_status := v_record.status;
  v_magnitude := ABS(COALESCE(p_quantity_delta, 0));

  IF v_op = 'receive' THEN
    IF v_magnitude <= 0 THEN
      RAISE EXCEPTION 'receive quantity must be positive' USING ERRCODE = 'SB004';
    END IF;
    IF v_record.status NOT IN ('available','reserved','consumed') THEN
      RAISE EXCEPTION 'cannot receive a % reagent (restore or replace it first)',
        v_record.status USING ERRCODE = 'SB004';
    END IF;
    v_resulting := v_qty + v_magnitude;
    v_next_status := 'available';
    v_magnitude := v_magnitude;  -- stored delta is positive

  ELSIF v_op = 'consume' THEN
    IF v_magnitude <= 0 THEN
      RAISE EXCEPTION 'consume quantity must be positive' USING ERRCODE = 'SB004';
    END IF;
    IF v_record.status NOT IN ('available','reserved') THEN
      RAISE EXCEPTION 'cannot consume a % reagent', v_record.status USING ERRCODE = 'SB004';
    END IF;
    v_resulting := v_qty - v_magnitude;
    IF v_resulting < 0 THEN
      RAISE EXCEPTION 'insufficient stock: have %, need %', v_qty, v_magnitude
        USING ERRCODE = 'SB006';
    END IF;
    IF v_resulting = 0 THEN
      v_next_status := 'consumed';
    END IF;
    v_magnitude := -v_magnitude;  -- stored delta is negative

  ELSIF v_op = 'quarantine' THEN
    IF v_record.status <> 'available' THEN
      RAISE EXCEPTION 'only available reagents can be quarantined' USING ERRCODE = 'SB004';
    END IF;
    v_resulting := v_qty;
    v_next_status := 'quarantined';
    v_magnitude := 0;

  ELSIF v_op = 'restore' THEN
    IF v_record.status <> 'quarantined' THEN
      RAISE EXCEPTION 'only quarantined reagents can be restored' USING ERRCODE = 'SB004';
    END IF;
    v_resulting := v_qty;
    v_next_status := 'available';
    v_magnitude := 0;
  END IF;

  -- Update the reagent record: quantity (for receive/consume) and status.
  IF v_op IN ('receive','consume') THEN
    v_new_props := jsonb_set(v_props, '{quantity}', to_jsonb(v_resulting), true);
  ELSE
    v_new_props := v_props;
  END IF;

  UPDATE "api"."records"
    SET properties = v_new_props,
        status = v_next_status,
        metadata_version = v_record.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = v_record.id
    RETURNING * INTO v_record;

  -- Append the ledger row with the supplier/lot/expiry snapshot.
  INSERT INTO "api"."reagent_movements" (
    workspace_id, reagent_record_id, operation, quantity_delta,
    resulting_quantity, unit, supplier, catalog_no, lot, expiry, reason,
    actor_user_id
  ) VALUES (
    v_workspace_id, v_record.id, v_op, v_magnitude,
    v_resulting, v_unit, v_supplier, v_catalog_no, v_lot, v_expiry, p_reason,
    "api"."current_user_id"()
  ) RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'movement', to_jsonb(v_movement),
    'record', to_jsonb(v_record)
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."record_reagent_movement"(uuid, text, int, numeric, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."record_reagent_movement"(uuid, text, int, numeric, text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- reagent_attention_summary: server-side count of low-stock, near-expiry,
-- expired and quarantined reagents in the active workspace. Low-stock and
-- expiry attention are derived from configured thresholds
-- (properties.low_stock_threshold, properties.expiry + the warning window)
-- rather than a stored status, so the dashboard summaries stay authoritative
-- without loading every row into the browser. SECURITY INVOKER STABLE: RLS
-- scopes api.records to the caller's workspace. JSONB casts are guarded by
-- regex checks so malformed property values never raise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."reagent_attention_summary"(
  p_expiry_warning_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_total int;
  v_low int;
  v_near int;
  v_exp int;
  v_quar int;
  v_cutoff date := current_date + GREATEST(COALESCE(p_expiry_warning_days, 30), 0);
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN jsonb_build_object(
      'total', 0, 'lowStock', 0, 'nearExpiry', 0, 'expired', 0, 'quarantined', 0
    );
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE (properties ? 'low_stock_threshold')
        AND (properties->>'low_stock_threshold') ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND (properties->>'quantity') ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND NULLIF(properties->>'quantity','')::numeric
            <= NULLIF(properties->>'low_stock_threshold','')::numeric
        AND status NOT IN ('consumed','expired','quarantined')
    ),
    count(*) FILTER (
      WHERE (properties ? 'expiry')
        AND (properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
        AND (properties->>'expiry')::date BETWEEN current_date AND v_cutoff
        AND status NOT IN ('expired','quarantined')
    ),
    count(*) FILTER (
      WHERE (properties ? 'expiry')
        AND (properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
        AND (properties->>'expiry')::date < current_date
        AND status <> 'quarantined'
    ),
    count(*) FILTER (WHERE status = 'quarantined')
  INTO v_total, v_low, v_near, v_exp, v_quar
  FROM "api"."records"
  WHERE workspace_id = v_workspace_id
    AND kind = 'reagent'
    AND archived_at IS NULL
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'total', COALESCE(v_total, 0),
    'lowStock', COALESCE(v_low, 0),
    'nearExpiry', COALESCE(v_near, 0),
    'expired', COALESCE(v_exp, 0),
    'quarantined', COALESCE(v_quar, 0)
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."reagent_attention_summary"(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."reagent_attention_summary"(int) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."reagent_attention_summary"(int) TO api_client;
--> statement-breakpoint
