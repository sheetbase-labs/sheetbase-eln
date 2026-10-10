-- SHEET-02.1 — requesting a column promotion is not performing it.
--
-- Today the only path is api.promote_local_field, which forks a draft Dataset Schema
-- Version and immediately adds the local field to it. That is the right *effect*, but it
-- is not an approval: nobody is asked, and there is no record of what was requested.
--
-- This adds the pending record and the request RPC. It reuses the same fork and the same
-- field append, so a request produces exactly the draft version a direct promotion would
-- — and, as before, writes nothing to the dataset. What is new is that the draft is held
-- pending against an approval request (MDL-03), and the request is recorded.
--
-- SHEET-02.2 owns what happens on approval: writing the values as a snapshot sourced from
-- the sheet and switching the columns from local to dataset in one transaction.

CREATE TABLE api.column_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  sheet_instance_id uuid NOT NULL REFERENCES api.sheet_instances(id) ON DELETE CASCADE,
  field_id uuid NOT NULL,
  target text NOT NULL,
  schema_definition_id uuid REFERENCES api.dataset_schema_definitions(id) ON DELETE SET NULL,
  schema_version_id uuid REFERENCES api.dataset_schema_versions(id) ON DELETE SET NULL,
  model_key text,
  state text NOT NULL DEFAULT 'pending',
  approval_request_id uuid REFERENCES api.approval_requests(id) ON DELETE SET NULL,
  reason text,
  requested_by_user_id text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_column_promotions_target CHECK (target IN ('dataset_schema', 'model_field')),
  CONSTRAINT chk_column_promotions_state CHECK (
    state IN ('pending', 'approved', 'returned', 'applied', 'withdrawn')
  ),
  -- A dataset promotion names the Definition and the draft Version it is pending
  -- against; a model promotion names the model it would create the field in.
  CONSTRAINT chk_column_promotions_shape CHECK (
    (target = 'dataset_schema'
      AND schema_definition_id IS NOT NULL AND schema_version_id IS NOT NULL)
    OR (target = 'model_field' AND model_key IS NOT NULL)
  ),
  -- A decided promotion has a decision time; a pending one has none.
  CONSTRAINT chk_column_promotions_decided CHECK (
    (state = 'pending') = (decided_at IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_column_promotions_instance ON api.column_promotions(sheet_instance_id);
--> statement-breakpoint
CREATE INDEX idx_column_promotions_workspace ON api.column_promotions(workspace_id);
--> statement-breakpoint
-- One open request per local field: a second pending promotion of the same field would
-- fork a second draft version for the same column.
CREATE UNIQUE INDEX uq_column_promotions_open_field
  ON api.column_promotions(sheet_instance_id, field_id)
  WHERE state = 'pending';
--> statement-breakpoint

ALTER TABLE api.column_promotions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY column_promotions_select ON api.column_promotions
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.column_promotions TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.request_column_promotion(
  p_instance_id uuid,
  p_field_id uuid,
  p_target text,
  p_schema_definition_id uuid,
  p_model_key text,
  p_reason text,
  p_idempotency_key text,
  p_expected_revision bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  instance api.sheet_instances;
  preview jsonb;
  local_field jsonb;
  digest text;
  replay jsonb;
  actor text := api.current_user_id();
  write_version api.dataset_schema_versions;
  source_id uuid;
  fields jsonb;
  promotion api.column_promotions;
  approval_row api.approval_requests;
  approval uuid;
BEGIN
  IF p_instance_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('instance', p_instance_id, 'edit');
  END IF;
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(instance.workspace_id, 'schema.edit');

  preview := api.preview_local_field_promotion(
    p_instance_id, p_field_id, p_target, p_schema_definition_id, p_model_key
  );
  IF (preview->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'local field values are incompatible with promotion' USING ERRCODE = 'SB071';
  END IF;
  local_field := preview->'field';

  digest := encode(sha256(convert_to(jsonb_build_object(
    'instance', p_instance_id,
    'field', p_field_id,
    'target', p_target,
    'schema', p_schema_definition_id,
    'modelKey', p_model_key,
    'request', true
  )::text, 'UTF8')), 'hex');
  replay := internal.replay_configuration_change(
    instance.workspace_id, actor, 'column_promotion_request', p_idempotency_key, digest
  );
  IF replay IS NOT NULL THEN RETURN replay; END IF;

  IF p_target = 'dataset_schema' THEN
    IF p_schema_definition_id IS NULL THEN
      RAISE EXCEPTION 'Dataset Schema Definition is required' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM api.dataset_schema_versions
       WHERE schema_id = p_schema_definition_id AND lifecycle = 'draft'
    ) THEN
      RAISE EXCEPTION 'a draft Dataset Schema Version already exists' USING ERRCODE = 'SB072';
    END IF;
    SELECT id INTO source_id
      FROM api.dataset_schema_versions
     WHERE schema_id = p_schema_definition_id
     ORDER BY version DESC
     LIMIT 1;
    write_version := internal.fork_dataset_schema_version(source_id);

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'field_id', field_id, 'key', key, 'label', label, 'description', description,
      'logical_type', logical_type, 'nullable', nullable, 'default_value', default_value,
      'quantity', quantity, 'validation', validation, 'category', category,
      'relationship', relationship, 'cardinality', cardinality, 'display_order', display_order
    ) ORDER BY display_order), '[]'::jsonb) INTO fields
      FROM api.dataset_schema_version_fields
     WHERE schema_version_id = write_version.id;
    fields := fields || jsonb_build_array(jsonb_build_object(
      'field_id', p_field_id,
      'key', local_field->>'key',
      'label', local_field->>'label',
      'description', local_field->>'description',
      'logical_type', local_field->>'logicalType',
      'nullable', (local_field->>'nullable')::boolean,
      'default_value', local_field->'defaultValue',
      'quantity', local_field->'quantity',
      'validation', coalesce(local_field->'validation','{}'::jsonb),
      'category', local_field->'category',
      'relationship', local_field->'relationship',
      'cardinality', coalesce(local_field->>'cardinality','one')
    ));
    PERFORM api.replace_dataset_schema_version_fields(write_version.id, fields);
  ELSIF p_target <> 'model_field' THEN
    RAISE EXCEPTION 'unsupported promotion target' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.column_promotions(
    workspace_id, sheet_instance_id, field_id, target,
    schema_definition_id, schema_version_id, model_key,
    reason, requested_by_user_id
  ) VALUES (
    instance.workspace_id, p_instance_id, p_field_id, p_target,
    p_schema_definition_id, write_version.id, p_model_key,
    p_reason, actor
  ) RETURNING * INTO promotion;

  -- MDL-03 owns the approval; the request names the promotion as its object.
  approval_row := api.submit_approval_request(
    instance.workspace_id,
    'column_promotion',
    promotion.id,
    ARRAY['steward']::text[],
    coalesce(p_reason, 'Promote a Sheet column'),
    true,
    1,
    p_expected_revision
  );
  approval := approval_row.id;
  UPDATE api.column_promotions
     SET approval_request_id = approval, updated_at = now()
   WHERE id = promotion.id;

  RETURN jsonb_build_object(
    'ok', true,
    'promotionId', promotion.id,
    'state', 'pending',
    'targetKind', p_target,
    'schemaVersionId', write_version.id,
    'approvalRequestId', approval,
    'idempotent', false
  );
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.request_column_promotion(uuid, uuid, text, uuid, text, text, text, bigint) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.request_column_promotion(uuid, uuid, text, uuid, text, text, text, bigint) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
