-- LAB-02 step 2 — sample release checks, quarantine and disposal.
--
-- Builds on step 1 (drizzle/0281_sample_hold_limits.sql). Reuses the existing
-- sample lifecycle (`records.status`), the canonical `api.sample_events`
-- chain-of-custody log and the `api.change_events` stream; it introduces no
-- second status or event engine.
--
-- Release checks: a rule set per sample type, stored workspace-side in
-- `api.sample_release_rules` (sample_type = '*' is the workspace default). When
-- no row exists, `internal.canonical_sample_release_rules()` supplies a minimal
-- canonical set: no measurement may carry a failing result. Rules are evaluated
-- against the authoritative LAB-03 measurement read model
-- (`api.sample_measurement_provenance`), never against a typed-in value and
-- never against the standalone bench-reading table.
--
-- RPCs (all SECURITY INVOKER, so records/sample_events RLS stays the
-- authoritative boundary; each locks the row, checks optimistic concurrency and
-- appends the matching canonical sample event):
--   * api.quarantine_sample(sample, expected_version, reason, notes) — status to
--     'quarantined', reason recorded in properties, audited.
--   * api.dispose_sample(sample, expected_version, reason, notes) — status to
--     'disposed' (terminal), disposal record in properties/event, audited.
--   * api.release_sample(sample, expected_version, notes) — requires the
--     sample.release capability, refuses when the effective rule set fails, and
--     records the release + check snapshot.
--   * api.consume_sample widened: a quarantined or hold_exceeded sample can only
--     be withdrawn by an experiment named in properties.allowedUseExperimentIds,
--     and a disposed sample can never be withdrawn.
--
-- New capabilities sample.release / sample.quarantine / sample.dispose are
-- added to the resolver; viewer and api_client stay false. RLS/membership is
-- otherwise unchanged.

CREATE TABLE "api"."sample_release_rules" (
	"workspace_id" uuid NOT NULL,
	"sample_type" text DEFAULT '*' NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sample_release_rules_workspace_id_sample_type_pk" PRIMARY KEY("workspace_id","sample_type"),
	CONSTRAINT "chk_sample_release_rules_type" CHECK (length(btrim("api"."sample_release_rules"."sample_type")) BETWEEN 1 AND 100),
	CONSTRAINT "chk_sample_release_rules_rules" CHECK (jsonb_typeof("api"."sample_release_rules"."rules") = 'array')
);
--> statement-breakpoint
ALTER TABLE "api"."sample_events" DROP CONSTRAINT "chk_sample_events_operation";--> statement-breakpoint
ALTER TABLE "api"."sample_release_rules" ADD CONSTRAINT "sample_release_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sample_release_rules" ADD CONSTRAINT "sample_release_rules_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sample_release_rules_workspace" ON "api"."sample_release_rules" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."sample_events" ADD CONSTRAINT "chk_sample_events_operation" CHECK ("api"."sample_events"."operation" IN ('create','receive','consume','transfer','edit','archive','restore','hold_exceeded','quarantine','release','dispose'));--> statement-breakpoint

-- The new lifecycle properties are written through the existing record
-- property path, so register them in the model's base fields (system/protected
-- like the hold fields added in 0281) before anything can persist them.
INSERT INTO api.model_base_fields(model_key, field_key, label, presentation) VALUES
  ('sample','quarantineReason','Quarantine reason','{"protected":true}'),
  ('sample','quarantinedAt','Quarantined at','{"protected":true}'),
  ('sample','disposalReason','Disposal reason','{"protected":true}'),
  ('sample','disposedAt','Disposed at','{"protected":true}'),
  ('sample','releasedAt','Released at','{"protected":true}'),
  ('sample','releaseChecks','Release checks','{"protected":true}')
ON CONFLICT (model_key, field_key) DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Release rule set: storage, canonical fallback, validation and evaluation.
-- ---------------------------------------------------------------------------

-- Minimal canonical set used when a workspace has not declared one: no
-- measurement may carry a failing result. It never blocks a sample with no
-- measurements, so it is safe as a default.
CREATE OR REPLACE FUNCTION "internal"."canonical_sample_release_rules"()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '[{"key":"no-failed-result","kind":"no_result","result":"fail","label":"No failed measurement"}]'::jsonb
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."canonical_sample_release_rules"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."canonical_sample_release_rules"() TO authenticated;--> statement-breakpoint

-- Bounded, structural validation shared by the config RPC. It is deliberately
-- not a table CHECK (checks must be immutable); the table still enforces that
-- `rules` is an array.
CREATE OR REPLACE FUNCTION "internal"."validate_sample_release_rules"(p_rules jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_rule jsonb;
  v_kind text;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'array' THEN
    RAISE EXCEPTION 'release rules must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rules) > 64 THEN
    RAISE EXCEPTION 'release rules must contain at most 64 checks' USING ERRCODE = '22023';
  END IF;
  FOR v_rule IN SELECT value FROM jsonb_array_elements(p_rules) LOOP
    IF jsonb_typeof(v_rule) <> 'object' THEN
      RAISE EXCEPTION 'each release rule must be an object' USING ERRCODE = '22023';
    END IF;
    v_kind := v_rule ->> 'kind';
    IF v_kind NOT IN ('no_result','min_measurements','measurement_required','measurement_range') THEN
      RAISE EXCEPTION 'unknown release rule kind %', coalesce(v_kind, '<null>') USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'no_result' AND nullif(btrim(coalesce(v_rule ->> 'result','')), '') IS NULL THEN
      RAISE EXCEPTION 'no_result rule requires a result' USING ERRCODE = '22023';
    END IF;
    IF v_kind IN ('measurement_required','measurement_range')
       AND nullif(btrim(coalesce(v_rule ->> 'measurement','')), '') IS NULL THEN
      RAISE EXCEPTION '% rule requires a measurement', v_kind USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'min_measurements'
       AND coalesce(nullif(v_rule ->> 'count','')::integer, 0) < 1 THEN
      RAISE EXCEPTION 'min_measurements rule requires a positive count' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'measurement_range'
       AND NOT (v_rule ? 'min' OR v_rule ? 'max') THEN
      RAISE EXCEPTION 'measurement_range rule requires a min or max' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."validate_sample_release_rules"(jsonb) FROM PUBLIC;--> statement-breakpoint

-- Effective rules: exact sample type, else the workspace '*', else canonical.
-- SECURITY INVOKER so the sample_release_rules select policy (workspace
-- membership) still applies on the read.
CREATE OR REPLACE FUNCTION "internal"."sample_release_rules"(
  p_workspace_id uuid,
  p_sample_type text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    (
      SELECT rules FROM api.sample_release_rules
       WHERE workspace_id = p_workspace_id
         AND lower(sample_type) = lower(coalesce(p_sample_type, ''))
       LIMIT 1
    ),
    (
      SELECT rules FROM api.sample_release_rules
       WHERE workspace_id = p_workspace_id AND sample_type = '*'
       LIMIT 1
    ),
    "internal"."canonical_sample_release_rules"()
  )
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."sample_release_rules"(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."sample_release_rules"(uuid, text) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."validate_sample_release_rules"(jsonb) TO authenticated;--> statement-breakpoint

-- Evaluate one effective rule set against the LAB-03 measurement read model.
-- Returns a check-by-check result plus the overall verdict; it never throws so
-- callers can record the snapshot before deciding.
CREATE OR REPLACE FUNCTION "internal"."evaluate_sample_release_rules"(
  p_rules jsonb,
  p_measurements jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_rules jsonb := CASE WHEN jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) = 'array'
                        THEN coalesce(p_rules, '[]'::jsonb) ELSE '[]'::jsonb END;
  v_measurements jsonb := CASE WHEN jsonb_typeof(coalesce(p_measurements, '[]'::jsonb)) = 'array'
                               THEN coalesce(p_measurements, '[]'::jsonb) ELSE '[]'::jsonb END;
  v_rule jsonb;
  v_checks jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_key text;
  v_label text;
  v_kind text;
  v_passed boolean;
  v_detail text;
  v_count integer;
  v_total integer;
  v_out_of_range integer;
  v_min numeric;
  v_max numeric;
  v_result text;
BEGIN
  FOR v_rule IN SELECT value FROM jsonb_array_elements(v_rules) LOOP
    v_kind := v_rule ->> 'kind';
    v_key := coalesce(
      nullif(v_rule ->> 'key', ''),
      v_kind || ':' || coalesce(v_rule ->> 'measurement', v_rule ->> 'result', '')
    );
    v_label := coalesce(nullif(v_rule ->> 'label', ''), v_key);
    v_passed := false;
    v_detail := NULL;

    IF v_kind = 'no_result' THEN
      v_result := nullif(btrim(coalesce(v_rule ->> 'result', '')), '');
      IF v_result IS NULL THEN
        v_detail := 'rule is missing a result';
      ELSE
        SELECT count(*) INTO v_out_of_range
          FROM jsonb_array_elements(v_measurements) m
         WHERE lower(coalesce(m ->> 'result', '')) = lower(v_result);
        v_passed := v_out_of_range = 0;
        IF NOT v_passed THEN
          v_detail := format('%s measurement(s) with result %s', v_out_of_range, v_result);
        END IF;
      END IF;

    ELSIF v_kind = 'min_measurements' THEN
      v_count := coalesce(nullif(v_rule ->> 'count', '')::integer, 1);
      v_total := jsonb_array_length(v_measurements);
      v_passed := v_total >= v_count;
      IF NOT v_passed THEN
        v_detail := format('requires %s measurement(s), found %s', v_count, v_total);
      END IF;

    ELSIF v_kind = 'measurement_required' THEN
      SELECT count(*) INTO v_total
        FROM jsonb_array_elements(v_measurements) m
       WHERE lower(coalesce(m ->> 'measurement', '')) = lower(coalesce(v_rule ->> 'measurement', ''));
      v_passed := v_total > 0;
      IF NOT v_passed THEN
        v_detail := format('measurement %s not found', coalesce(v_rule ->> 'measurement', ''));
      END IF;

    ELSIF v_kind = 'measurement_range' THEN
      v_min := NULLIF(v_rule ->> 'min', '')::numeric;
      v_max := NULLIF(v_rule ->> 'max', '')::numeric;
      SELECT count(*),
             count(*) FILTER (WHERE
               (m ->> 'value') IS NULL
               OR (v_min IS NOT NULL AND coalesce((m ->> 'value')::numeric, 'NaN'::numeric) < v_min)
               OR (v_max IS NOT NULL AND coalesce((m ->> 'value')::numeric, 'NaN'::numeric) > v_max)
             )
        INTO v_total, v_out_of_range
        FROM jsonb_array_elements(v_measurements) m
       WHERE lower(coalesce(m ->> 'measurement', '')) = lower(coalesce(v_rule ->> 'measurement', ''));
      v_passed := v_total > 0 AND v_out_of_range = 0;
      IF NOT v_passed THEN
        v_detail := format('measurement %s is missing or outside the required range', coalesce(v_rule ->> 'measurement', ''));
      END IF;

    ELSE
      v_detail := format('unknown release rule kind %s', coalesce(v_kind, '<null>'));
      v_passed := false;
    END IF;

    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'label', v_label,
      'kind', v_kind,
      'passed', v_passed,
      'detail', v_detail
    ));
    IF NOT v_passed THEN
      v_failed := v_failed || jsonb_build_array(v_label);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'passed', jsonb_array_length(v_failed) = 0,
    'ruleCount', jsonb_array_length(v_rules),
    'failedCount', jsonb_array_length(v_failed),
    'failedLabels', v_failed,
    'checks', v_checks
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."evaluate_sample_release_rules"(jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."evaluate_sample_release_rules"(jsonb, jsonb) TO authenticated;--> statement-breakpoint

-- Controlled configuration of a workspace rule set. Write access to the table
-- is also capability-gated by RLS, so this RPC only adds validation + audit of
-- the actor.
CREATE OR REPLACE FUNCTION "api"."set_sample_release_rules"(
  p_workspace_id uuid,
  p_sample_type text,
  p_rules jsonb
)
RETURNS "api"."sample_release_rules"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_type text := btrim(coalesce(p_sample_type, '*'));
  v_row "api"."sample_release_rules";
BEGIN
  PERFORM "api"."require_capability"(p_workspace_id, 'sample.release');
  IF v_type = '' OR length(v_type) > 100 THEN
    RAISE EXCEPTION 'invalid sample type' USING ERRCODE = '22023';
  END IF;
  PERFORM "internal"."validate_sample_release_rules"(coalesce(p_rules, '[]'::jsonb));

  INSERT INTO "api"."sample_release_rules"
    (workspace_id, sample_type, rules, updated_by_user_id, updated_at)
  VALUES
    (p_workspace_id, v_type, coalesce(p_rules, '[]'::jsonb), "api"."current_user_id"(), now())
  ON CONFLICT (workspace_id, sample_type) DO UPDATE
    SET rules = EXCLUDED.rules,
        updated_by_user_id = "api"."current_user_id"(),
        updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."set_sample_release_rules"(uuid, text, jsonb) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."set_sample_release_rules"(uuid, text, jsonb) TO authenticated;--> statement-breakpoint

-- RLS: members read; writes require the sample.release capability.
ALTER TABLE "api"."sample_release_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."sample_release_rules" TO authenticated;--> statement-breakpoint

CREATE POLICY "sample_release_rules_select" ON "api"."sample_release_rules"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

CREATE POLICY "sample_release_rules_write" ON "api"."sample_release_rules"
  FOR ALL TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."has_capability"("workspace_id", 'sample.release'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."has_capability"("workspace_id", 'sample.release'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Caps: sample.release / sample.quarantine / sample.dispose. Release is the
-- authorised-person QC gate (owner/admin/steward/scientist/reviewer);
-- quarantine and disposal are scientific actions (no reviewer). Viewer and
-- api_client remain false.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    IF p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM api.agent_operation_proposals proposal
      WHERE proposal.workspace_id = p_workspace_id
        AND proposal.status = 'executing'
        AND proposal.executed_by_credential_id = api.current_credential_id()
        AND (
          (proposal.operation_kind LIKE 'pipeline_definition.%'
           AND p_capability = 'pipelines.manage'
           AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
          OR (proposal.operation_kind IN (
            'dataset_schema.create',
            'sheet_definition.create',
            'sheet_definition.update_draft'
          ) AND p_capability = 'schema.edit'
          AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
        )
    );
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' AND v_mask IS NOT NULL THEN
    RETURN p_capability = ANY (
      string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
    );
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- LAB-02 step 2: release is the authorised-person QC gate; quarantine and
    -- disposal are scientific actions. api_client stays fail-closed (the
    -- sample RPCs are not in the external allowlist).
    WHEN p_capability = 'sample.release' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'reviewer');
    WHEN p_capability IN ('sample.quarantine', 'sample.dispose') THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.has_capability(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO authenticated, api_client;--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.list_capabilities(p_workspace_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(capability ORDER BY capability), '{}'::text[])
    FROM unnest(ARRAY[
      'workspace.admin',
      'schema.edit',
      'schema.publish',
      'schema.retire',
      'record.link',
      'record.create',
      'instance.upgrade',
      'integrations.manage',
      'pipelines.manage',
      'extensions.manage',
      'sample.release',
      'sample.quarantine',
      'sample.dispose'
    ]) AS capability
   WHERE api.has_capability(p_workspace_id, capability)
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_capabilities(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_capabilities(uuid) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Release / quarantine / disposal RPCs. SECURITY INVOKER, like every other
-- sample mutation: the records UPDATE and sample_events INSERT remain
-- RLS-gated and actor-attributed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."quarantine_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_reason text;
BEGIN
  PERFORM "api"."require_capability"("api"."current_workspace_id"(), 'sample.quarantine');
  v_reason := btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'a quarantine reason is required' USING ERRCODE = 'SB093';
  END IF;
  IF length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'quarantine reason is too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot quarantine an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.status NOT IN ('available', 'reserved', 'hold_exceeded') THEN
    RAISE EXCEPTION 'cannot quarantine a % sample', v_row.status USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
     SET status = 'quarantined',
         properties = properties || jsonb_build_object(
           'quarantineReason', v_reason,
           'quarantinedAt', now()
         ),
         metadata_version = v_row.metadata_version + 1,
         updated_by_user_id = "api"."current_user_id"()
   WHERE id = p_record_id
   RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'quarantine', "api"."current_user_id"(), v_reason);

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."quarantine_sample"(uuid, int, text, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."quarantine_sample"(uuid, int, text, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."quarantine_sample"(uuid, int, text, text) IS
  'LAB-02: moves an available/reserved/hold_exceeded sample to quarantined with a required reason, recording the reason in properties and a canonical quarantine sample_event.';--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."dispose_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_reason text,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_reason text;
BEGIN
  PERFORM "api"."require_capability"("api"."current_workspace_id"(), 'sample.dispose');
  v_reason := btrim(coalesce(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'a disposal reason is required' USING ERRCODE = 'SB093';
  END IF;
  IF length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'disposal reason is too long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot dispose an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.status NOT IN ('available', 'reserved', 'quarantined', 'hold_exceeded', 'expired') THEN
    RAISE EXCEPTION 'cannot dispose a % sample', v_row.status USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
     SET status = 'disposed',
         properties = properties || jsonb_build_object(
           'disposalReason', v_reason,
           'disposedAt', now()
         ),
         metadata_version = v_row.metadata_version + 1,
         updated_by_user_id = "api"."current_user_id"()
   WHERE id = p_record_id
   RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'dispose', "api"."current_user_id"(), v_reason);

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."dispose_sample"(uuid, int, text, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."dispose_sample"(uuid, int, text, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."dispose_sample"(uuid, int, text, text) IS
  'LAB-02: moves a non-terminal sample to the terminal disposed state with a required reason, recording the disposal in properties and a canonical dispose sample_event. Remaining quantity is kept for lineage and audit.';--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."release_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_measurements jsonb;
  v_rules jsonb;
  v_eval jsonb;
  v_snapshot jsonb;
BEGIN
  PERFORM "api"."require_capability"("api"."current_workspace_id"(), 'sample.release');

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot release an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.status IN ('consumed', 'disposed') THEN
    RAISE EXCEPTION 'cannot release a % sample', v_row.status USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  -- Authoritative LAB-03 read model; never typed-in values or the standalone
  -- bench-reading table.
  v_measurements := "api"."sample_measurement_provenance"(p_record_id);
  v_rules := "internal"."sample_release_rules"(v_row.workspace_id, v_row.properties ->> 'sampleType');
  v_eval := "internal"."evaluate_sample_release_rules"(v_rules, v_measurements);

  IF NOT coalesce((v_eval ->> 'passed')::boolean, false) THEN
    RAISE EXCEPTION 'release checks failed: %', coalesce(v_eval -> 'failedLabels', '[]'::jsonb)
      USING ERRCODE = 'SB093';
  END IF;

  v_snapshot := v_eval || jsonb_build_object('evaluatedAt', now());

  -- Release returns the sample to the available lifecycle state and records the
  -- release plus the exact check snapshot on the sample.
  UPDATE "api"."records"
     SET status = 'available',
         properties = properties || jsonb_build_object(
           'releasedAt', now(),
           'releaseChecks', v_snapshot
         ),
         metadata_version = v_row.metadata_version + 1,
         updated_by_user_id = "api"."current_user_id"()
   WHERE id = p_record_id
   RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'release', "api"."current_user_id"(),
     coalesce(nullif(btrim(coalesce(p_notes, '')), ''), 'Released after passing release checks'));

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."release_sample"(uuid, int, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."release_sample"(uuid, int, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."release_sample"(uuid, int, text) IS
  'LAB-02: requires the sample.release capability, evaluates the effective per-sample-type rule set (workspace api.sample_release_rules or the canonical fallback) against api.sample_measurement_provenance, refuses on any failed check (SB093), then records the release and check snapshot and appends a canonical release sample_event.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Withdrawal enforcement: extend the step-1 consume_sample guard to cover
-- quarantine and terminal disposal. The allowed-use list is the only bypass for
-- a quarantined or hold_exceeded sample (an explicit, audited exception).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "api"."consume_sample"(uuid, numeric, int, text, uuid);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."consume_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL,
  p_experiment_id uuid DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_before numeric;
  v_after numeric;
  v_unit text;
  v_props jsonb;
  v_status text;
  v_allowed jsonb;
  v_permitted boolean;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'consume quantity must be positive' USING ERRCODE = 'SB006';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot consume an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  -- LAB-02: a disposed sample is terminal and can never be withdrawn.
  IF v_row.status = 'disposed' THEN
    RAISE EXCEPTION 'cannot withdraw a disposed sample' USING ERRCODE = 'SB004';
  END IF;

  -- LAB-02: a quarantined or past-hold sample may only be withdrawn by an
  -- explicitly allowed experiment.
  IF v_row.status IN ('hold_exceeded', 'quarantined') THEN
    v_allowed := CASE
      WHEN jsonb_typeof(v_row.properties -> 'allowedUseExperimentIds') = 'array'
        THEN v_row.properties -> 'allowedUseExperimentIds'
      ELSE '[]'::jsonb
    END;
    v_permitted := p_experiment_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(v_allowed) AS allowed(id)
       WHERE allowed.id = p_experiment_id::text
    );
    IF NOT v_permitted THEN
      RAISE EXCEPTION 'sample is % and this experiment is not allowed to withdraw it', v_row.status
        USING ERRCODE = 'SB004';
    END IF;
  END IF;

  v_before := NULLIF(v_row.properties ->> 'quantity', '')::numeric;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sample has no quantity to consume' USING ERRCODE = 'SB006';
  END IF;
  v_after := v_before - p_quantity;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'insufficient quantity: have %, consuming %', v_before, p_quantity
      USING ERRCODE = 'SB006';
  END IF;
  v_unit := v_row.properties ->> 'quantityUnit';
  v_props := v_row.properties || jsonb_build_object('quantity', v_after);
  -- When the sample is fully consumed, transition to the consumed lifecycle
  -- state (a permitted available/reserved -> consumed move).
  v_status := CASE WHEN v_after = 0 THEN 'consumed' ELSE v_row.status END;

  UPDATE "api"."records"
    SET properties = v_props,
        status = v_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, quantity_delta, quantity_before,
     quantity_after, quantity_unit, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'consume', -p_quantity, v_before, v_after,
     v_unit, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
