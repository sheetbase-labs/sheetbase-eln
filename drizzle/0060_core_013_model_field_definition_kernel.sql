-- CORE-01.3: retain the established Model storage while making canonical
-- semantics explicit. No definition, option, or record value is replaced.
ALTER TABLE api.record_field_definitions
  ADD COLUMN quantity jsonb,
  ADD COLUMN cardinality text NOT NULL DEFAULT 'one',
  ADD COLUMN category_source jsonb,
  ADD COLUMN relationship jsonb,
  ADD CONSTRAINT chk_record_field_definitions_cardinality
    CHECK (cardinality IN ('one', 'many')),
  ADD CONSTRAINT chk_record_field_definitions_quantity
    CHECK (quantity IS NULL OR jsonb_typeof(quantity) = 'object'),
  ADD CONSTRAINT chk_record_field_definitions_category_source
    CHECK (category_source IS NULL OR jsonb_typeof(category_source) = 'object'),
  ADD CONSTRAINT chk_record_field_definitions_relationship
    CHECK (relationship IS NULL OR jsonb_typeof(relationship) = 'object');
--> statement-breakpoint

-- Explicit compatibility projections: opaque legacy units deliberately remain
-- unclassified until an administrator supplies scientific semantics.
UPDATE api.record_field_definitions
SET category_source = jsonb_build_object('kind', 'embedded')
WHERE logical_type = 'category';

UPDATE api.record_field_definitions
SET relationship = jsonb_build_object(
  'target', jsonb_build_object('kind', 'model', 'modelKey', validation->>'targetModelKey'),
  'cardinality', 'one'
)
WHERE logical_type = 'reference'
  AND validation->>'targetModelKey' IS NOT NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.canonicalize_model_field_definition()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target_key text;
BEGIN
  IF NEW.cardinality <> 'one' THEN
    RAISE EXCEPTION 'many-valued Model fields are not supported yet' USING ERRCODE='SB071';
  END IF;
  IF NEW.quantity IS NOT NULL AND NEW.logical_type NOT IN ('integer', 'decimal') THEN
    RAISE EXCEPTION 'quantity semantics require an integer or decimal field' USING ERRCODE='SB071';
  END IF;
  IF NEW.quantity IS NOT NULL AND (
    coalesce(nullif(btrim(NEW.quantity->>'kind'), ''), '') = '' OR
    coalesce(nullif(btrim(NEW.quantity->>'dimension'), ''), '') = '' OR
    coalesce(nullif(btrim(NEW.quantity->>'storageUnit'), ''), '') = ''
  ) THEN
    RAISE EXCEPTION 'quantity requires kind, dimension and storageUnit' USING ERRCODE='SB071';
  END IF;
  IF NEW.logical_type = 'category' THEN
    NEW.category_source := coalesce(NEW.category_source, jsonb_build_object('kind', 'embedded'));
    IF NEW.category_source->>'kind' NOT IN ('embedded', 'vocabulary') OR
       (NEW.category_source->>'kind' = 'vocabulary' AND coalesce(nullif(btrim(NEW.category_source->>'vocabularyId'), ''), '') = '') THEN
      RAISE EXCEPTION 'invalid category source' USING ERRCODE='SB071';
    END IF;
  ELSIF NEW.category_source IS NOT NULL THEN
    RAISE EXCEPTION 'category source is only valid for category fields' USING ERRCODE='SB071';
  END IF;
  IF NEW.logical_type = 'reference' THEN
    target_key := NEW.validation->>'targetModelKey';
    IF NEW.relationship IS NULL AND target_key IS NOT NULL THEN
      NEW.relationship := jsonb_build_object('target', jsonb_build_object('kind', 'model', 'modelKey', target_key), 'cardinality', NEW.cardinality);
    END IF;
    IF NEW.relationship IS NOT NULL THEN
      IF NEW.relationship->'target'->>'kind' <> 'model' OR
         coalesce(nullif(btrim(NEW.relationship->'target'->>'modelKey'), ''), '') = '' OR
         NEW.relationship->>'cardinality' <> NEW.cardinality THEN
        RAISE EXCEPTION 'invalid Model reference relationship' USING ERRCODE='SB071';
      END IF;
      target_key := NEW.relationship->'target'->>'modelKey';
      IF NEW.validation ? 'targetModelKey' AND NEW.validation->>'targetModelKey' <> target_key THEN
        RAISE EXCEPTION 'reference relationship conflicts with targetModelKey' USING ERRCODE='SB071';
      END IF;
      NEW.validation := NEW.validation || jsonb_build_object('targetModelKey', target_key);
    END IF;
  ELSIF NEW.relationship IS NOT NULL THEN
    RAISE EXCEPTION 'relationship is only valid for reference fields' USING ERRCODE='SB071';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER canonicalize_model_field_definition
BEFORE INSERT OR UPDATE OF logical_type, validation, quantity, cardinality, category_source, relationship
ON api.record_field_definitions
FOR EACH ROW EXECUTE FUNCTION internal.canonicalize_model_field_definition();
--> statement-breakpoint

CREATE FUNCTION api.configure_model_field_semantics(
  p_definition_id uuid, p_quantity jsonb DEFAULT NULL, p_cardinality text DEFAULT 'one',
  p_category_source jsonb DEFAULT NULL, p_relationship jsonb DEFAULT NULL
) RETURNS api.record_field_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.record_field_definitions;
BEGIN
  SELECT * INTO v FROM api.record_field_definitions WHERE id=p_definition_id FOR UPDATE;
  IF v.id IS NULL OR NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
  IF v.lifecycle <> 'draft' THEN RAISE EXCEPTION 'active field contract is immutable' USING ERRCODE='SB072'; END IF;
  UPDATE api.record_field_definitions SET quantity=p_quantity, cardinality=coalesce(p_cardinality, 'one'), category_source=p_category_source, relationship=p_relationship, updated_at=now()
  WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION api.configure_model_field_semantics(uuid,jsonb,text,jsonb,jsonb) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.configure_model_field_semantics(uuid,jsonb,text,jsonb,jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.model_field_manifest(p_record_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('definitions',coalesce(jsonb_agg(jsonb_build_object('id',d.id,'modelKey',d.kind,'fieldName',d.field_name,'logicalType',d.logical_type,'nullable',d.nullable,'defaultValue',d.default_value,'unit',d.unit,'quantity',d.quantity,'cardinality',d.cardinality,'categorySource',d.category_source,'relationship',d.relationship,'validation',d.validation,'lifecycle',d.lifecycle,'options',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'key',o.key,'label',o.label,'displayOrder',o.display_order,'lifecycle',o.lifecycle) ORDER BY o.display_order,o.key,o.id) FROM api.model_field_options o WHERE o.definition_id=d.id),'[]')) ORDER BY d.kind,d.field_name,d.id) FILTER (WHERE d.id IS NOT NULL),'[]'))
 FROM api.records r LEFT JOIN api.record_field_definitions d ON d.workspace_id=r.workspace_id AND d.kind=internal.model_key_for('api.records',r.kind) AND d.lifecycle IN ('active','retired') WHERE r.id=p_record_id $$;

NOTIFY pgrst, 'reload schema';
