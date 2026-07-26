-- REV-005: configurable reviewer checklists and data-integrity checks.
-- Check definitions are versioned and immutable (like workflow definitions).
-- Check results are bound to a frozen revision, never to live data, and are
-- themselves immutable so historical evidence cannot be rewritten.

CREATE TABLE "internal"."review_check_definitions" (
  "definition_key" text NOT NULL,
  "version" integer NOT NULL,
  "definition" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_key, version),
  CONSTRAINT "chk_review_check_definition_key"
    CHECK (definition_key ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  CONSTRAINT "chk_review_check_definition_version" CHECK (version > 0),
  CONSTRAINT "chk_review_check_definition_shape"
    CHECK (jsonb_typeof(definition) = 'object' AND jsonb_typeof(definition->'checks') = 'array')
);
--> statement-breakpoint

INSERT INTO "internal"."review_check_definitions" (definition_key, version, definition)
VALUES (
  'default-scientific-checks',
  1,
  '{"checks":[
    {"key":"completeness-title","category":"completeness","severity":"blocking","label":"Record has a non-empty title","rule":{"type":"completeness-title"}},
    {"key":"completeness-blocks","category":"completeness","severity":"warning","label":"At least one content block present","rule":{"type":"min-count","path":"blocks","minCount":1}},
    {"key":"schema-valid-columns","category":"schema","severity":"blocking","label":"All scientific columns have valid logical types","rule":{"type":"schema-valid-columns"}},
    {"key":"formula-supported","category":"formula","severity":"blocking","label":"All formulas are supported","rule":{"type":"formula-supported"}},
    {"key":"formula-no-stale-results","category":"stale-result","severity":"warning","label":"No stale formula results","rule":{"type":"formula-no-stale"}},
    {"key":"required-links","category":"required-link","severity":"informational","label":"Record links present","rule":{"type":"required-links","linkTypes":["file"]}}
  ]}'
);
REVOKE ALL ON "internal"."review_check_definitions"
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE TABLE "api"."review_check_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  "record_id" uuid NOT NULL REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  "revision_id" uuid NOT NULL REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "check_definition_key" text NOT NULL,
  "check_definition_version" integer NOT NULL,
  "revision_integrity_digest" text NOT NULL,
  "check_definition_digest" text NOT NULL,
  "input_digest" text NOT NULL,
  "overall_status" text NOT NULL,
  "pass_count" integer NOT NULL DEFAULT 0,
  "blocking_failure_count" integer NOT NULL DEFAULT 0,
  "warning_failure_count" integer NOT NULL DEFAULT 0,
  "info_failure_count" integer NOT NULL DEFAULT 0,
  "results" jsonb NOT NULL,
  "run_by_user_id" text NOT NULL REFERENCES "internal"."user"("id") ON DELETE RESTRICT,
  "run_session_id" text NOT NULL,
  "run_role" text NOT NULL,
  "run_at" timestamptz NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_review_check_results_status"
    CHECK (overall_status IN ('pass','warning','fail')),
  CONSTRAINT "chk_review_check_results_definition_key"
    CHECK (check_definition_key ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  CONSTRAINT "chk_review_check_results_definition_version"
    CHECK (check_definition_version > 0),
  CONSTRAINT "chk_review_check_results_revision_digest"
    CHECK (revision_integrity_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_review_check_results_definition_digest"
    CHECK (check_definition_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_review_check_results_input_digest"
    CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_review_check_results_idempotency_key"
    CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT "chk_review_check_results_counts"
    CHECK (pass_count >= 0 AND blocking_failure_count >= 0 AND warning_failure_count >= 0 AND info_failure_count >= 0),
  CONSTRAINT "chk_review_check_results_results_shape"
    CHECK (jsonb_typeof(results) = 'array'),
  CONSTRAINT "review_check_results_definition_fk"
    FOREIGN KEY (check_definition_key, check_definition_version)
    REFERENCES "internal"."review_check_definitions"(definition_key, version)
    ON DELETE RESTRICT,
  CONSTRAINT "uq_review_check_results_actor_idempotency"
    UNIQUE (workspace_id, run_by_user_id, idempotency_key)
);
--> statement-breakpoint

CREATE INDEX "idx_review_check_results_revision"
  ON "api"."review_check_results" ("revision_id");
CREATE INDEX "idx_review_check_results_workspace_status"
  ON "api"."review_check_results" ("workspace_id", "overall_status", "run_at" DESC);
CREATE INDEX "idx_review_check_results_record"
  ON "api"."review_check_results" ("record_id", "run_at" DESC);
--> statement-breakpoint

ALTER TABLE "api"."review_check_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review_check_results_select" ON "api"."review_check_results"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );
--> statement-breakpoint

GRANT SELECT ON "api"."review_check_results" TO authenticated;
--> statement-breakpoint

-- Immutability: once a check result is recorded it cannot be altered by any
-- application role. The migrator retains cleanup access for test fixtures.
CREATE FUNCTION "internal"."prevent_check_result_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'review check results are immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_check_result_mutation"()
  FROM PUBLIC, authenticated, api_client;
CREATE TRIGGER "prevent_check_result_mutation"
  BEFORE UPDATE OR DELETE ON "api"."review_check_results"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_check_result_mutation"();
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "api"."review_check_results"
  FROM authenticated, api_client;
--> statement-breakpoint

-- Evaluate a single check item against a frozen canonical snapshot.
-- Returns a JSONB object: { key, category, severity, label, status, evidence }.
CREATE FUNCTION "internal"."evaluate_check_item"(
  p_envelope jsonb,
  p_check_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rule_type text := p_check_item->'rule'->>'type';
  item_status text := 'pass';
  evidence jsonb := '{}'::jsonb;

  field_text text;
  field_value jsonb;
  array_len int;
  min_count int;
  path_text text;

  table_item jsonb;
  column_item jsonb;
  logical_type text;
  total_columns int := 0;
  invalid_columns jsonb := '[]'::jsonb;

  formula_item jsonb;
  calc_item jsonb;
  total_formulas int := 0;
  unsupported_formulas jsonb := '[]'::jsonb;
  stale_formulas jsonb := '[]'::jsonb;
  missing_results jsonb := '[]'::jsonb;
  formula_version_text text;
  calc_version_text text;

  link_item jsonb;
  link_type text;
  found_link_types text[] := ARRAY[]::text[];
  required_link_types text[] := ARRAY[]::text[];
  missing_link_types text[] := ARRAY[]::text[];
  required_type text;
BEGIN
  IF rule_type = 'completeness-title' THEN
    field_text := p_envelope->'record'->>'title';
    IF field_text IS NULL OR btrim(field_text) = '' THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('title', to_jsonb(field_text));

  ELSIF rule_type = 'min-count' THEN
    path_text := p_check_item->'rule'->>'path';
    field_value := p_envelope->path_text;
    array_len := CASE WHEN jsonb_typeof(field_value) = 'array'
      THEN jsonb_array_length(field_value) ELSE 0 END;
    min_count := COALESCE((p_check_item->'rule'->>'minCount')::int, 0);
    IF array_len < min_count THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object(
      'path', path_text,
      'count', array_len,
      'minCount', min_count
    );

  ELSIF rule_type = 'schema-valid-columns' THEN
    FOR table_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'scientificTables') = 'array'
          THEN p_envelope->'scientificTables' ELSE '[]'::jsonb END
      )
    LOOP
      FOR column_item IN
        SELECT value FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(table_item->'columns') = 'array'
            THEN table_item->'columns' ELSE '[]'::jsonb END
        )
      LOOP
        total_columns := total_columns + 1;
        logical_type := column_item->>'logicalType';
        IF logical_type IS NULL
           OR logical_type NOT IN (
             'text','integer','decimal','boolean','date','timestamp','category','reference'
           ) THEN
          item_status := 'fail';
          invalid_columns := invalid_columns || jsonb_build_array(jsonb_build_object(
            'tableId', table_item->>'id',
            'columnId', column_item->>'id',
            'fieldName', column_item->>'fieldName',
            'logicalType', to_jsonb(logical_type)
          ));
        END IF;
      END LOOP;
    END LOOP;
    evidence := jsonb_build_object(
      'totalColumns', total_columns,
      'invalidColumns', invalid_columns
    );

  ELSIF rule_type = 'formula-supported' THEN
    FOR formula_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'formulas') = 'array'
          THEN p_envelope->'formulas' ELSE '[]'::jsonb END
      )
    LOOP
      total_formulas := total_formulas + 1;
      IF formula_item->>'status' <> 'supported' THEN
        item_status := 'fail';
        unsupported_formulas := unsupported_formulas || jsonb_build_array(jsonb_build_object(
          'id', formula_item->>'id',
          'status', formula_item->>'status'
        ));
      END IF;
    END LOOP;
    evidence := jsonb_build_object(
      'totalFormulas', total_formulas,
      'unsupportedFormulas', unsupported_formulas
    );

  ELSIF rule_type = 'formula-no-stale' THEN
    FOR formula_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'formulas') = 'array'
          THEN p_envelope->'formulas' ELSE '[]'::jsonb END
      )
    LOOP
      total_formulas := total_formulas + 1;
      calc_item := formula_item->'calculation';
      formula_version_text := formula_item->>'version';

      IF calc_item IS NULL OR jsonb_typeof(calc_item) = 'null' THEN
        item_status := 'fail';
        missing_results := missing_results || jsonb_build_array(jsonb_build_object(
          'id', formula_item->>'id',
          'reason', 'no_cached_result'
        ));
      ELSE
        calc_version_text := calc_item->>'formula_version';
        IF calc_version_text IS DISTINCT FROM formula_version_text THEN
          item_status := 'fail';
          stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object(
            'id', formula_item->>'id',
            'formulaVersion', formula_version_text,
            'cachedVersion', calc_version_text,
            'reason', 'version_mismatch'
          ));
        ELSIF calc_item->>'status' <> 'completed' THEN
          item_status := 'fail';
          stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object(
            'id', formula_item->>'id',
            'calculationStatus', calc_item->>'status',
            'reason', 'incomplete'
          ));
        END IF;
      END IF;
    END LOOP;
    evidence := jsonb_build_object(
      'totalFormulas', total_formulas,
      'staleFormulas', stale_formulas,
      'missingResults', missing_results
    );

  ELSIF rule_type = 'required-links' THEN
    FOR required_type IN
      SELECT value FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_check_item->'rule'->'linkTypes') = 'array'
          THEN p_check_item->'rule'->'linkTypes' ELSE '[]'::jsonb END
      )
    LOOP
      required_link_types := array_append(required_link_types, required_type);
    END LOOP;

    FOR link_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'links') = 'array'
          THEN p_envelope->'links' ELSE '[]'::jsonb END
      )
    LOOP
      link_type := link_item->>'linkType';
      IF link_type IS NOT NULL AND NOT (link_type = ANY(found_link_types)) THEN
        found_link_types := array_append(found_link_types, link_type);
      END IF;
    END LOOP;

    FOREACH required_type IN ARRAY required_link_types LOOP
      IF NOT (required_type = ANY(found_link_types)) THEN
        item_status := 'fail';
        missing_link_types := array_append(missing_link_types, required_type);
      END IF;
    END LOOP;

    evidence := jsonb_build_object(
      'requiredLinkTypes', to_jsonb(required_link_types),
      'foundLinkTypes', to_jsonb(found_link_types),
      'missingLinkTypes', to_jsonb(missing_link_types)
    );

  ELSE
    item_status := 'fail';
    evidence := jsonb_build_object('error', 'unknown rule type', 'ruleType', rule_type);
  END IF;

  RETURN jsonb_build_object(
    'key', p_check_item->>'key',
    'category', p_check_item->>'category',
    'severity', p_check_item->>'severity',
    'label', p_check_item->>'label',
    'status', item_status,
    'evidence', evidence
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."evaluate_check_item"(jsonb, jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- Run all checks from a versioned definition against a frozen revision's
-- canonical snapshot and store the immutable result. The inputs (the
-- canonical snapshot) are read exclusively from api.revisions, never from
-- live tables, so later draft edits cannot change a historical result.
CREATE FUNCTION "api"."run_revision_checks"(
  p_revision_id uuid,
  p_check_definition_key text,
  p_check_definition_version integer,
  p_confirmed boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claimed_workspace uuid;
  actor text;
  session_id text;
  actor_role text;
  revision_row api.revisions;
  definition_row internal.review_check_definitions;
  check_item jsonb;
  item_result jsonb;
  results jsonb := '[]'::jsonb;
  overall_status text := 'pass';
  pass_count int := 0;
  blocking_failures int := 0;
  warning_failures int := 0;
  info_failures int := 0;
  total_count int := 0;
  input_digest text;
  definition_digest text;
  existing_result api.review_check_results;
  run_at timestamptz := clock_timestamp();
  result_row api.review_check_results;
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
     OR NOT api.is_workspace_member(claimed_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_check_definition_key IS NULL
     OR p_check_definition_key !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR coalesce(p_check_definition_version, 0) < 1 THEN
    RAISE EXCEPTION 'versioned check definition is required' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO definition_row FROM internal.review_check_definitions
  WHERE definition_key = p_check_definition_key
    AND version = p_check_definition_version;
  IF definition_row.definition_key IS NULL THEN
    RAISE EXCEPTION 'unknown check definition version' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO revision_row FROM api.revisions
  WHERE id = p_revision_id
    AND workspace_id = claimed_workspace;
  IF revision_row.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- Idempotency: return the existing result if the same actor already ran
  -- this exact check definition against this exact revision.
  SELECT * INTO existing_result FROM api.review_check_results
  WHERE workspace_id = claimed_workspace
    AND run_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  IF existing_result.id IS NOT NULL THEN
    IF existing_result.revision_id <> p_revision_id
       OR existing_result.check_definition_key <> p_check_definition_key
       OR existing_result.check_definition_version <> p_check_definition_version THEN
      RAISE EXCEPTION 'idempotency key was used for a different check run'
        USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'id', existing_result.id,
      'overallStatus', existing_result.overall_status,
      'passCount', existing_result.pass_count,
      'blockingFailureCount', existing_result.blocking_failure_count,
      'warningFailureCount', existing_result.warning_failure_count,
      'infoFailureCount', existing_result.info_failure_count,
      'idempotent', true
    );
  END IF;

  -- Compute digests: the input is the frozen canonical snapshot; the
  -- definition digest pins the exact check logic used.
  input_digest := internal.revision_integrity_digest(revision_row.canonical_snapshot);
  definition_digest := encode(
    sha256(convert_to(definition_row.definition::text, 'UTF8')), 'hex'
  );

  -- Verify the revision's stored digest matches a fresh computation. The
  -- revision is immutable so this should always hold, but it proves the
  -- inputs have not been tampered with.
  IF input_digest <> revision_row.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE = 'SB001';
  END IF;

  -- Evaluate each check item against the frozen snapshot.
  FOR check_item IN
    SELECT t.value FROM jsonb_array_elements(definition_row.definition->'checks')
      WITH ORDINALITY AS t(value, ord)
    ORDER BY t.ord
  LOOP
    item_result := internal.evaluate_check_item(revision_row.canonical_snapshot, check_item);
    results := results || jsonb_build_array(item_result);
    total_count := total_count + 1;

    IF item_result->>'status' = 'pass' THEN
      pass_count := pass_count + 1;
    ELSE
      IF item_result->>'severity' = 'blocking' THEN
        blocking_failures := blocking_failures + 1;
      ELSIF item_result->>'severity' = 'warning' THEN
        warning_failures := warning_failures + 1;
      ELSIF item_result->>'severity' = 'informational' THEN
        info_failures := info_failures + 1;
      END IF;
    END IF;
  END LOOP;

  IF blocking_failures > 0 THEN
    overall_status := 'fail';
  ELSIF warning_failures > 0 THEN
    overall_status := 'warning';
  ELSE
    overall_status := 'pass';
  END IF;

  INSERT INTO api.review_check_results (
    workspace_id, record_id, revision_id,
    check_definition_key, check_definition_version,
    revision_integrity_digest, check_definition_digest, input_digest,
    overall_status, pass_count, blocking_failure_count,
    warning_failure_count, info_failure_count,
    results, run_by_user_id, run_session_id, run_role, run_at,
    idempotency_key, created_at
  ) VALUES (
    claimed_workspace, revision_row.record_id, revision_row.id,
    p_check_definition_key, p_check_definition_version,
    revision_row.integrity_digest, definition_digest, input_digest,
    overall_status, pass_count, blocking_failures,
    warning_failures, info_failures,
    results, actor, session_id, actor_role, run_at,
    p_idempotency_key, run_at
  ) RETURNING * INTO result_row;

  RETURN jsonb_build_object(
    'id', result_row.id,
    'revisionId', result_row.revision_id,
    'checkDefinitionKey', result_row.check_definition_key,
    'checkDefinitionVersion', result_row.check_definition_version,
    'revisionIntegrityDigest', result_row.revision_integrity_digest,
    'checkDefinitionDigest', result_row.check_definition_digest,
    'inputDigest', result_row.input_digest,
    'overallStatus', result_row.overall_status,
    'passCount', result_row.pass_count,
    'blockingFailureCount', result_row.blocking_failure_count,
    'warningFailureCount', result_row.warning_failure_count,
    'infoFailureCount', result_row.info_failure_count,
    'results', result_row.results,
    'runAt', result_row.run_at,
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO existing_result FROM api.review_check_results
  WHERE workspace_id = claimed_workspace
    AND run_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  IF existing_result.id IS NOT NULL
     AND existing_result.revision_id = p_revision_id
     AND existing_result.check_definition_key = p_check_definition_key
     AND existing_result.check_definition_version = p_check_definition_version THEN
    RETURN jsonb_build_object(
      'id', existing_result.id,
      'overallStatus', existing_result.overall_status,
      'passCount', existing_result.pass_count,
      'blockingFailureCount', existing_result.blocking_failure_count,
      'warningFailureCount', existing_result.warning_failure_count,
      'infoFailureCount', existing_result.info_failure_count,
      'idempotent', true
    );
  END IF;
  RAISE;
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."run_revision_checks"(uuid,text,integer,boolean,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."run_revision_checks"(uuid,text,integer,boolean,text)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
