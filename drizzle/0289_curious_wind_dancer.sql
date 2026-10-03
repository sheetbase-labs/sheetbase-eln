CREATE TABLE "api"."model_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"model_key" text NOT NULL,
	"name" text NOT NULL,
	"field_keys" text[] DEFAULT '{}' NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effect" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	CONSTRAINT "chk_model_rules_effect" CHECK ("api"."model_rules"."effect" IN ('flag_block_submit','warn','block')),
	CONSTRAINT "chk_model_rules_name" CHECK (length(btrim("api"."model_rules"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "chk_model_rules_message" CHECK (length(btrim("api"."model_rules"."message")) BETWEEN 1 AND 500),
	CONSTRAINT "chk_model_rules_condition" CHECK (jsonb_typeof("api"."model_rules"."condition") = 'object')
);
--> statement-breakpoint
ALTER TABLE "api"."model_rules" ADD CONSTRAINT "model_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."model_rules" ADD CONSTRAINT "model_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_model_rules_scope" ON "api"."model_rules" USING btree ("workspace_id","model_key");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- MDL-02 step 2 (ADR-0051) — workspace-owned model rules.
--
-- Rules reuse the existing model/field store and the existing record
-- validation and submission paths; no second validation engine is added.
-- A rule attaches to a built-in `model_kinds` key or a workspace-owned
-- `record_models` key exactly like `record_field_definitions`. Versioning is
-- deferred to MDL-03 (see the comment on `modelRules` in schema.ts).
--
-- RLS mirrors the sibling model configuration: workspace members read; only
-- the `schema.edit` capability inserts/updates; another workspace is
-- invisible. Removals run through the SECURITY DEFINER RPC.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."model_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

REVOKE ALL ON "api"."model_rules" FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."model_rules" TO api_client;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."model_rules" TO authenticated;
--> statement-breakpoint

CREATE POLICY "model_rules_select" ON "api"."model_rules"
  FOR SELECT TO authenticated
  USING (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"("workspace_id")
  );
--> statement-breakpoint

CREATE POLICY "model_rules_select_api_client" ON "api"."model_rules"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "model_rules_insert" ON "api"."model_rules"
  FOR INSERT TO authenticated
  WITH CHECK (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
    AND "created_by_user_id" = "api"."current_user_id"()
  );
--> statement-breakpoint

CREATE POLICY "model_rules_update" ON "api"."model_rules"
  FOR UPDATE TO authenticated
  USING (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
  )
  WITH CHECK (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
  );
--> statement-breakpoint

CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."model_rules"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint

-- Guard the rule shape for both the RPCs and direct PostgREST writes: the
-- model key must be the same built-in/workspace union the field store uses,
-- the "applies to" fields must exist for that model, and scope is immutable.
CREATE OR REPLACE FUNCTION "internal"."guard_model_rule"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM api.model_kinds WHERE key = NEW.model_key)
     AND NOT EXISTS (SELECT 1 FROM api.record_models
       WHERE workspace_id = NEW.workspace_id AND key = NEW.model_key) THEN
    RAISE EXCEPTION 'unknown model key: %', NEW.model_key USING ERRCODE = 'SB071';
  END IF;
  IF NEW.effect NOT IN ('flag_block_submit','warn','block') THEN
    RAISE EXCEPTION 'invalid rule effect: %', NEW.effect USING ERRCODE = 'SB071';
  END IF;
  IF NEW.condition IS NULL OR jsonb_typeof(NEW.condition) <> 'object' THEN
    RAISE EXCEPTION 'rule condition must be an object' USING ERRCODE = 'SB071';
  END IF;
  IF NEW.field_keys IS NULL OR cardinality(NEW.field_keys) = 0 THEN
    RAISE EXCEPTION 'a rule must apply to at least one field' USING ERRCODE = 'SB071';
  END IF;
  FOR k IN SELECT unnest(NEW.field_keys) LOOP
    IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions
        WHERE workspace_id = NEW.workspace_id AND kind = NEW.model_key AND field_name = k)
       AND NOT EXISTS (SELECT 1 FROM api.model_base_fields
        WHERE model_key = NEW.model_key AND field_key = k) THEN
      RAISE EXCEPTION 'unknown model rule field: %', k USING ERRCODE = 'SB071';
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.model_key IS DISTINCT FROM OLD.model_key) THEN
    RAISE EXCEPTION 'model rule scope is immutable' USING ERRCODE = 'SB072';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."guard_model_rule"() FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
CREATE TRIGGER "model_rule_guard" BEFORE INSERT OR UPDATE OR DELETE ON "api"."model_rules"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_model_rule"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Condition DSL. `{}` (or `true`) always matches. A condition is a boolean
-- combinator (`all`, `any`, `not`) or a leaf over a custom-field value:
--   {"field":"dose","op":"gt","value":100}
-- Operators: eq, neq, gt, gte, lt, lte, in, not_in, is_null, not_null,
-- matches (POSIX regex on the value's text). Numeric operands compare
-- numerically; everything else compares as text, so ISO dates/timestamps
-- order correctly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."model_rule_condition_matches"(
  p_condition jsonb, p_values jsonb
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
  elem jsonb; v jsonb; cmp jsonb; op text; field text;
  v_num numeric; c_num numeric; v_txt text; c_txt text;
BEGIN
  IF p_condition IS NULL OR p_condition = '{}'::jsonb OR p_condition = 'true'::jsonb THEN
    RETURN true;
  END IF;
  IF p_condition ? 'not' THEN
    RETURN NOT internal.model_rule_condition_matches(p_condition->'not', p_values);
  END IF;
  IF p_condition ? 'all' THEN
    IF jsonb_typeof(p_condition->'all') <> 'array' THEN
      RAISE EXCEPTION 'all must be an array' USING ERRCODE = 'SB071';
    END IF;
    FOR elem IN SELECT value FROM jsonb_array_elements(p_condition->'all') LOOP
      IF NOT internal.model_rule_condition_matches(elem, p_values) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF p_condition ? 'any' THEN
    IF jsonb_typeof(p_condition->'any') <> 'array' THEN
      RAISE EXCEPTION 'any must be an array' USING ERRCODE = 'SB071';
    END IF;
    FOR elem IN SELECT value FROM jsonb_array_elements(p_condition->'any') LOOP
      IF internal.model_rule_condition_matches(elem, p_values) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;

  field := p_condition->>'field';
  op := coalesce(nullif(p_condition->>'op', ''), 'eq');
  cmp := p_condition->'value';
  IF field IS NULL THEN
    RAISE EXCEPTION 'model rule condition requires a field' USING ERRCODE = 'SB071';
  END IF;
  v := p_values -> field;

  IF op = 'is_null' THEN RETURN v IS NULL OR v = 'null'::jsonb; END IF;
  IF op = 'not_null' THEN RETURN NOT (v IS NULL OR v = 'null'::jsonb); END IF;
  IF v IS NULL OR v = 'null'::jsonb THEN RETURN false; END IF;
  IF op = 'eq' THEN RETURN v IS NOT DISTINCT FROM cmp; END IF;
  IF op = 'neq' THEN RETURN v IS DISTINCT FROM cmp; END IF;
  IF op = 'in' THEN
    IF jsonb_typeof(cmp) <> 'array' THEN RAISE EXCEPTION 'in requires an array' USING ERRCODE = 'SB071'; END IF;
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(cmp) x WHERE x = v);
  END IF;
  IF op = 'not_in' THEN
    IF jsonb_typeof(cmp) <> 'array' THEN RAISE EXCEPTION 'not_in requires an array' USING ERRCODE = 'SB071'; END IF;
    RETURN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cmp) x WHERE x = v);
  END IF;
  IF op = 'matches' THEN
    IF cmp IS NULL THEN RAISE EXCEPTION 'matches requires a pattern' USING ERRCODE = 'SB071'; END IF;
    RETURN (v #>> '{}') ~ (cmp #>> '{}');
  END IF;
  IF op NOT IN ('gt','gte','lt','lte') THEN
    RAISE EXCEPTION 'unknown model rule operator: %', op USING ERRCODE = 'SB071';
  END IF;

  v_txt := coalesce(v #>> '{}', '');
  c_txt := coalesce(cmp #>> '{}', '');
  v_num := CASE WHEN jsonb_typeof(v) = 'number' THEN (v #>> '{}')::numeric END;
  c_num := CASE WHEN jsonb_typeof(cmp) = 'number' THEN (cmp #>> '{}')::numeric END;
  IF v_num IS NOT NULL AND c_num IS NOT NULL THEN
    RETURN CASE op
      WHEN 'gt' THEN v_num > c_num WHEN 'gte' THEN v_num >= c_num
      WHEN 'lt' THEN v_num < c_num WHEN 'lte' THEN v_num <= c_num END;
  END IF;
  RETURN CASE op
    WHEN 'gt' THEN v_txt > c_txt WHEN 'gte' THEN v_txt >= c_txt
    WHEN 'lt' THEN v_txt < c_txt WHEN 'lte' THEN v_txt <= c_txt END;
END $$;
--> statement-breakpoint

-- Evaluate every rule of a model against a record's custom fields. Returns
-- the matched rules grouped by effect so the write path (block/warn) and the
-- submit path (block + flag_block_submit) share one engine.
CREATE OR REPLACE FUNCTION "internal"."evaluate_model_rules"(
  p_workspace uuid, p_model text, p_values jsonb
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'blocked', coalesce(bool_or(effect = 'block'), false),
    'blockSubmit', coalesce(bool_or(effect IN ('block','flag_block_submit')), false),
    'warnings', coalesce(jsonb_agg(
      jsonb_build_object('ruleId', id, 'effect', effect, 'message', message)
      ORDER BY created_at, id) FILTER (WHERE effect = 'warn'), '[]'::jsonb),
    'blocks', coalesce(jsonb_agg(
      jsonb_build_object('ruleId', id, 'effect', effect, 'message', message)
      ORDER BY created_at, id) FILTER (WHERE effect = 'block'), '[]'::jsonb),
    'submitBlocks', coalesce(jsonb_agg(
      jsonb_build_object('ruleId', id, 'effect', effect, 'message', message)
      ORDER BY created_at, id) FILTER (WHERE effect = 'flag_block_submit'), '[]'::jsonb)
  )
  FROM api.model_rules
  WHERE workspace_id = p_workspace
    AND model_key = p_model
    AND internal.model_rule_condition_matches(condition, coalesce(p_values, '{}'::jsonb));
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."evaluate_model_rules"(uuid, text, jsonb) FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."assert_model_rules_allow_submit"(
  p_workspace uuid, p_model text, p_values jsonb
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE evaluated jsonb; reason text;
BEGIN
  IF p_model IS NULL THEN RETURN; END IF;
  evaluated := internal.evaluate_model_rules(p_workspace, p_model, p_values);
  IF coalesce((evaluated->>'blockSubmit')::boolean, false) THEN
    reason := coalesce(
      evaluated->'submitBlocks'->0->>'message',
      evaluated->'blocks'->0->>'message',
      'record does not satisfy the model rules'
    );
    RAISE EXCEPTION 'cannot submit: %', reason USING ERRCODE = 'SB083';
  END IF;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."assert_model_rules_allow_submit"(uuid, text, jsonb) FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- Canonical write path: after the existing field validation, refuse a
-- `block` rule and report `warn` rules as a non-blocking notice. A
-- `flag_block_submit` rule is deliberately accepted here; the submit RPC is
-- the gate for it. This extends the existing trigger rather than adding a
-- second validation engine.
CREATE OR REPLACE FUNCTION "internal"."guard_model_custom_fields"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE model text; old_fields jsonb; evaluated jsonb; warning jsonb;
BEGIN
 IF TG_TABLE_NAME='records' THEN
   model:=internal.model_key_for('api.records',NEW.kind);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id AND NEW.kind IS NOT DISTINCT FROM OLD.kind THEN OLD.custom_fields ELSE '{}'::jsonb END;
 ELSE
   model:=internal.model_key_for('api.'||TG_TABLE_NAME,NULL);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN OLD.custom_fields ELSE '{}'::jsonb END;
 END IF;
 IF model IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='records' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'locked_at' IS NOT NULL AND NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011'; END IF;
 NEW.custom_fields:=internal.validate_model_fields(NEW.workspace_id,model,NEW.custom_fields,old_fields);
 evaluated:=internal.evaluate_model_rules(NEW.workspace_id,model,NEW.custom_fields);
 IF coalesce((evaluated->>'blocked')::boolean,false) THEN
   RAISE EXCEPTION '%', evaluated->'blocks'->0->>'message' USING ERRCODE='SB083';
 END IF;
 FOR warning IN SELECT value FROM jsonb_array_elements(evaluated->'warnings') LOOP
   RAISE WARNING 'model rule %: %', warning->>'ruleId', warning->>'message';
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint

-- Canonical submit path: `submit_record_revision` gains the model-rule
-- submit gate (effect `flag_block_submit` or `block`). The rest of the
-- GOV-04/SCI-03/WORK-01 body is unchanged.
CREATE OR REPLACE FUNCTION api.submit_record_revision(
  p_record_id uuid,
  p_expected_source_digest text,
  p_workflow_definition_key text,
  p_workflow_definition_version integer,
  p_reviewer_user_ids text[],
  p_confirmed boolean,
  p_idempotency_key text,
  p_due_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claimed_workspace uuid;
  actor text;
  session_id text;
  actor_role text;
  record_row api.records;
  envelope jsonb;
  actual_digest text;
  normalized_reviewers text[];
  revision_row api.revisions;
  submission_row api.review_submissions;
  existing_submission api.review_submissions;
  existing_revision api.revisions;
  submitted_at timestamptz := clock_timestamp();
  v_revision_id uuid;
BEGIN
  BEGIN
    claimed_workspace := nullif(api.claim_probe()->>'workspace_id', '')::uuid;
    actor := nullif(api.claim_probe()->>'sub', '');
    session_id := nullif(api.claim_probe()->>'session_id', '');
    actor_role := nullif(api.claim_probe()->>'role', '');
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END;
  IF claimed_workspace IS NULL OR actor IS NULL OR session_id IS NULL
     OR actor_role <> 'authenticated' OR p_confirmed IS DISTINCT FROM true
     OR NOT api.is_workspace_writer(claimed_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_source_digest IS NULL
     OR p_expected_source_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'expected source digest is required' USING ERRCODE = '22023';
  END IF;
  IF p_workflow_definition_key IS NULL
     OR p_workflow_definition_key !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR coalesce(p_workflow_definition_version, 0) < 1 THEN
    RAISE EXCEPTION 'versioned workflow definition is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM internal.review_workflow_definitions definition
    WHERE definition.definition_key = p_workflow_definition_key
      AND definition.version = p_workflow_definition_version
  ) THEN
    RAISE EXCEPTION 'unknown workflow definition version' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(reviewer ORDER BY reviewer) INTO normalized_reviewers
  FROM (SELECT DISTINCT unnest(p_reviewer_user_ids) reviewer) reviewers
    WHERE reviewer IS NOT NULL AND reviewer <> '';
  IF coalesce(cardinality(normalized_reviewers), 0) = 0 THEN
    RAISE EXCEPTION 'at least one assigned reviewer is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(normalized_reviewers) reviewer
    WHERE NOT EXISTS (
      SELECT 1 FROM api.workspace_memberships membership
      WHERE membership.workspace_id = claimed_workspace
        AND membership.user_id = reviewer
    )
  ) THEN
    RAISE EXCEPTION 'assigned reviewer is not a workspace member' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_submission
  FROM api.review_submissions
  WHERE workspace_id = claimed_workspace
    AND submitted_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  IF existing_submission.id IS NOT NULL THEN
    SELECT * INTO existing_revision FROM api.revisions
    WHERE id = existing_submission.revision_id;
    IF existing_submission.record_id <> p_record_id
       OR existing_submission.workflow_definition_key <> p_workflow_definition_key
       OR existing_submission.workflow_definition_version <> p_workflow_definition_version
       OR existing_submission.assigned_reviewer_user_ids <> normalized_reviewers
       OR existing_revision.integrity_digest <> p_expected_source_digest THEN
      RAISE EXCEPTION 'idempotency key was used for a different submission' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'revision', jsonb_build_object('id', existing_revision.id, 'integrityDigest', existing_revision.integrity_digest),
      'submission', jsonb_build_object('id', existing_submission.id, 'state', existing_submission.state),
      'idempotent', true
    );
  END IF;

  -- GOV-04: archived records fail closed exactly like deleted ones.
  SELECT * INTO record_row FROM api.records
  WHERE id = p_record_id
    AND workspace_id = claimed_workspace
    AND deleted_at IS NULL
    AND archived_at IS NULL
  FOR UPDATE;
  IF record_row.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- MDL-02 step 2: model rules can block submission (`flag_block_submit` or
  -- `block`). Submission is the canonical gate for a record the write path
  -- accepted but flagged.
  PERFORM internal.assert_model_rules_allow_submit(
    record_row.workspace_id,
    internal.model_key_for('api.records', record_row.kind),
    record_row.custom_fields
  );

  -- Evidence boundary: allocate the revision UUID, bind unbound frozen
  -- evidence to it, and only then capture the envelope (snapshot) and digest.
  v_revision_id := gen_random_uuid();
  PERFORM "internal"."bind_frozen_evidence_for_submission"(
    record_row.id, v_revision_id
  );

  envelope := internal.build_revision_envelope(record_row.id);
  actual_digest := internal.revision_integrity_digest(
    internal.envelope_for_digest(envelope)
  );
  IF actual_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION 'submission source changed' USING ERRCODE = 'SB001';
  END IF;

  INSERT INTO api.revisions (
    id, record_id, workspace_id, structure_version, metadata_version,
    metadata_snapshot, block_snapshot, canonical_snapshot,
    integrity_algorithm, integrity_digest, reason, created_at, updated_at,
    created_by_user_id
  ) VALUES (
    v_revision_id, record_row.id, record_row.workspace_id,
    record_row.structure_version, record_row.metadata_version,
    envelope->'record', envelope->'blocks', envelope,
    'sha256', actual_digest, 'submit', submitted_at, submitted_at, actor
  ) RETURNING * INTO revision_row;

  INSERT INTO api.review_submissions (
    workspace_id, record_id, revision_id, state,
    workflow_definition_key, workflow_definition_version,
    assigned_reviewer_user_ids, submitted_by_user_id, submitted_at,
    submitted_session_id, submitted_role, idempotency_key, due_at,
    created_at, updated_at
  ) VALUES (
    claimed_workspace, record_row.id, revision_row.id, 'submitted',
    p_workflow_definition_key, p_workflow_definition_version,
    normalized_reviewers, actor, submitted_at, session_id, actor_role, p_idempotency_key,
    p_due_at,
    submitted_at, submitted_at
  ) RETURNING * INTO submission_row;

  PERFORM "internal"."persist_revision_sheet_evidence"(revision_row.id);

  RETURN jsonb_build_object(
    'revision', jsonb_build_object('id', revision_row.id, 'integrityDigest', revision_row.integrity_digest),
    'submission', jsonb_build_object('id', submission_row.id, 'state', submission_row.state),
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO existing_submission
  FROM api.review_submissions
  WHERE workspace_id = claimed_workspace
    AND submitted_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  SELECT * INTO existing_revision FROM api.revisions
  WHERE id = existing_submission.revision_id;
  IF existing_submission.id IS NULL
     OR existing_submission.record_id <> p_record_id
     OR existing_submission.workflow_definition_key <> p_workflow_definition_key
     OR existing_submission.workflow_definition_version <> p_workflow_definition_version
     OR existing_submission.assigned_reviewer_user_ids <> normalized_reviewers
     OR existing_revision.id IS NULL
     OR existing_revision.integrity_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION 'idempotency key was used for a different submission' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'revision', jsonb_build_object('id', existing_revision.id, 'integrityDigest', existing_revision.integrity_digest),
    'submission', jsonb_build_object('id', existing_submission.id, 'state', existing_submission.state),
    'idempotent', true
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Stewardship RPCs (schema.edit gated), a read-only validation report, and
-- listing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."create_model_rule"(
  p_workspace_id uuid, p_model_key text, p_name text, p_field_keys text[],
  p_condition jsonb, p_effect text, p_message text
) RETURNS "api"."model_rules"
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.model_rules;
BEGIN
  PERFORM api.require_capability(p_workspace_id, 'schema.edit');
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'rule name must be 1-200 characters' USING ERRCODE = 'SB071';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'rule message must be 1-500 characters' USING ERRCODE = 'SB071';
  END IF;
  INSERT INTO api.model_rules(
    workspace_id, model_key, name, field_keys, condition, effect, message, created_by_user_id
  ) VALUES (
    p_workspace_id, p_model_key, btrim(p_name), coalesce(p_field_keys, '{}'::text[]),
    coalesce(p_condition, '{}'::jsonb), p_effect, btrim(p_message), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_model_rule"(uuid, text, text, text[], jsonb, text, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_model_rule"(uuid, text, text, text[], jsonb, text, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."update_model_rule"(
  p_rule_id uuid, p_patch jsonb
) RETURNS "api"."model_rules"
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.model_rules; patch jsonb;
BEGIN
  SELECT * INTO v FROM api.model_rules WHERE id = p_rule_id FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'model rule not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(v.workspace_id, 'schema.edit');
  patch := coalesce(p_patch, '{}'::jsonb);
  IF jsonb_typeof(patch) <> 'object' THEN
    RAISE EXCEPTION 'rule patch must be an object' USING ERRCODE = 'SB071';
  END IF;
  IF patch - ARRAY['name','fieldKeys','condition','effect','message'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'unknown model rule patch property' USING ERRCODE = 'SB071';
  END IF;
  IF patch ? 'fieldKeys' AND jsonb_typeof(patch->'fieldKeys') <> 'array' THEN
    RAISE EXCEPTION 'fieldKeys must be an array' USING ERRCODE = 'SB071';
  END IF;
  UPDATE api.model_rules SET
    name = coalesce(patch->>'name', name),
    field_keys = CASE WHEN patch ? 'fieldKeys'
      THEN ARRAY(SELECT jsonb_array_elements_text(patch->'fieldKeys')) ELSE field_keys END,
    condition = CASE WHEN patch ? 'condition' THEN patch->'condition' ELSE condition END,
    effect = coalesce(patch->>'effect', effect),
    message = coalesce(patch->>'message', message),
    updated_at = now()
  WHERE id = p_rule_id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."update_model_rule"(uuid, jsonb) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."update_model_rule"(uuid, jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."remove_model_rule"(p_rule_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.model_rules;
BEGIN
  SELECT * INTO v FROM api.model_rules WHERE id = p_rule_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'model rule not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(v.workspace_id, 'schema.edit');
  DELETE FROM api.model_rules WHERE id = p_rule_id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."remove_model_rule"(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."remove_model_rule"(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."list_model_rules"(
  p_workspace_id uuid, p_model_key text DEFAULT NULL
) RETURNS SETOF "api"."model_rules"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT * FROM api.model_rules
  WHERE workspace_id = p_workspace_id
    AND (p_model_key IS NULL OR model_key = p_model_key)
    AND api.is_workspace_member(p_workspace_id)
  ORDER BY model_key, created_at, id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."list_model_rules"(uuid, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."list_model_rules"(uuid, text) TO authenticated;
--> statement-breakpoint

-- Read-only validation report for a record: the same engine the write and
-- submit paths use, exposed so a client can show the non-blocking `warn`
-- notices and the submit-blocked state.
CREATE FUNCTION "api"."model_record_validation"(p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r api.records; model text;
BEGIN
  SELECT * INTO r FROM api.records WHERE id = p_record_id;
  IF r.id IS NULL OR NOT api.is_workspace_member(r.workspace_id) THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '42501';
  END IF;
  model := internal.model_key_for('api.records', r.kind);
  IF model IS NULL THEN
    RETURN jsonb_build_object(
      'blocked', false, 'blockSubmit', false,
      'warnings', '[]'::jsonb, 'blocks', '[]'::jsonb, 'submitBlocks', '[]'::jsonb
    );
  END IF;
  RETURN internal.evaluate_model_rules(r.workspace_id, model, r.custom_fields);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."model_record_validation"(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."model_record_validation"(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';