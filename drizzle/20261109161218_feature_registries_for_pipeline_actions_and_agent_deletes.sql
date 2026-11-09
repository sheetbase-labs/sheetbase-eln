-- Two shared lists become tables, so a feature's migration adds a row instead
-- of rewriting a function another feature is also rewriting
-- (docs/development/features.md):
--
--   internal.pipeline_actions       the actions a pipeline step may run, which
--                                   internal.pipeline_action_errors checks
--   internal.agent_allowed_deletes  the deletes agents may do behind a
--                                   confirmation (agent_action_always_never)
--
-- Both are seeded from the functions as they stand, so nothing changes.

CREATE TABLE internal.pipeline_actions (
    operation text PRIMARY KEY,
    definition jsonb NOT NULL,
    CONSTRAINT chk_pipeline_actions_definition CHECK (
      jsonb_typeof(definition) = 'object'
      AND definition->>'operation' = operation
      AND jsonb_typeof(definition->'arguments') = 'array'
    )
);
ALTER TABLE internal.pipeline_actions OWNER TO migrator;
COMMENT ON TABLE internal.pipeline_actions IS
  'Pipeline step actions the database accepts; each feature''s migration adds its own.';

DO $$
DECLARE
  v_def text;
  v_catalogue text;
  v_declaration text := 'v_catalogue constant jsonb := $catalogue$';
  v_lookup text := 'SELECT value INTO v_definition FROM jsonb_array_elements(v_catalogue) WHERE value->>''operation'' = v_action->>''operation'';';
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  v_catalogue := substring(v_def FROM '\$catalogue\$(.*)\$catalogue\$');
  IF v_catalogue IS NULL OR position(v_declaration IN v_def) = 0 OR position(v_lookup IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;

  -- The function took the first definition of an operation; so does this.
  INSERT INTO internal.pipeline_actions (operation, definition)
  SELECT value->>'operation', value
  FROM jsonb_array_elements(v_catalogue::jsonb) WITH ORDINALITY AS entry(value, n)
  ORDER BY n
  ON CONFLICT (operation) DO NOTHING;

  v_def := replace(v_def,
    '  ' || v_declaration || v_catalogue || '$catalogue$::jsonb;' || chr(10), '');
  IF position('$catalogue$' IN v_def) > 0 THEN
    RAISE EXCEPTION 'could not remove the catalogue from internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, v_lookup,
    'SELECT definition INTO v_definition FROM internal.pipeline_actions WHERE operation = v_action->>''operation'';');
  -- It reads a table now: stable, and run as its owner so every caller can.
  v_def := replace(v_def, E'\n IMMUTABLE\n', E'\n STABLE SECURITY DEFINER\n');
  IF position('STABLE SECURITY DEFINER' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected volatility on internal.pipeline_action_errors';
  END IF;
  EXECUTE v_def;
END $$;

CREATE TABLE internal.agent_allowed_deletes (
    action_key text PRIMARY KEY
);
ALTER TABLE internal.agent_allowed_deletes OWNER TO migrator;
COMMENT ON TABLE internal.agent_allowed_deletes IS
  'Action keys that look like a delete but that agents may do behind a confirmation. Mirrors agentMayDelete in src/features/<name>/feature.ts.';

INSERT INTO internal.agent_allowed_deletes (action_key) VALUES
  ('delete_workspace_group'),
  -- A deleted file can be restored.
  ('delete_file');

-- The same rule as agentActionAlwaysNever in src/lib/agent-action-policy.ts.
-- It still backs chk_agent_action_policies_fixed: a key taken off the list
-- later is refused for new policies, and set_agent_action_policy and
-- resolve_agent_action_level check it on every call.
CREATE OR REPLACE FUNCTION internal.agent_action_always_never(p_action_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT (p_action_key ~ '(^|_)(sign|amend|lock|unlock|delete|destroy|purge)(_|$)'
          AND NOT EXISTS (
            SELECT 1 FROM internal.agent_allowed_deletes allowed
            WHERE allowed.action_key = p_action_key))
      OR p_action_key ~ '^submit_(experiment|record|review|notebook|for_review)'
      OR p_action_key IN ('submit_for_review', 'decide_review', 'release_sample', 'approve_signature')
$$;
