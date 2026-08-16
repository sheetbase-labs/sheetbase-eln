-- CORE-06.3 / 06.4 / 06.11: dedicated Notebook Template identity and
-- immutable published versions. Template configuration is not stored in
-- api.revisions. Sheet placements pin Sheet Definition Version IDs.
-- Parameters reuse CORE-03 Parameter objects and map by stable IDs.

CREATE TABLE api.notebook_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  lifecycle text NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  CONSTRAINT uq_notebook_templates_workspace_key UNIQUE (workspace_id, key),
  CONSTRAINT chk_notebook_templates_key CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  CONSTRAINT chk_notebook_templates_lifecycle CHECK (lifecycle IN ('active','retired')),
  CONSTRAINT chk_notebook_templates_revision CHECK (revision > 0),
  CONSTRAINT chk_notebook_templates_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_notebook_templates_description CHECK (description IS NULL OR length(description) <= 2000)
);

CREATE TABLE api.notebook_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  template_id uuid NOT NULL REFERENCES api.notebook_templates(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  lifecycle text NOT NULL DEFAULT 'draft',
  configuration_format_version integer NOT NULL DEFAULT 1,
  configuration jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  published_at timestamptz,
  published_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  retired_at timestamptz,
  retired_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  CONSTRAINT uq_notebook_template_versions_template_version UNIQUE (template_id, version),
  CONSTRAINT chk_notebook_template_versions_version CHECK (version > 0),
  CONSTRAINT chk_notebook_template_versions_lifecycle CHECK (lifecycle IN ('draft','published','retired')),
  CONSTRAINT chk_notebook_template_versions_format CHECK (configuration_format_version = 1),
  CONSTRAINT chk_notebook_template_versions_revision CHECK (revision > 0)
);

CREATE INDEX idx_notebook_templates_workspace ON api.notebook_templates (workspace_id);
CREATE INDEX idx_notebook_template_versions_template ON api.notebook_template_versions (template_id);

ALTER TABLE api.records
  ADD COLUMN source_notebook_template_version_id uuid
    REFERENCES api.notebook_template_versions(id) ON DELETE RESTRICT;

CREATE FUNCTION internal.guard_record_template_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.source_notebook_template_version_id IS NOT NULL
     AND NEW.source_notebook_template_version_id IS DISTINCT FROM OLD.source_notebook_template_version_id THEN
    RAISE EXCEPTION 'Notebook Template Version association is immutable' USING ERRCODE = 'SB090';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER guard_record_template_version
  BEFORE UPDATE ON api.records
  FOR EACH ROW
  EXECUTE FUNCTION internal.guard_record_template_version();

CREATE FUNCTION internal.validate_notebook_template_configuration(
  p_workspace_id uuid,
  p_config jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  mapping jsonb;
  parameter jsonb;
  def_param jsonb;
  version_row api.sheet_definition_versions;
  definition api.sheet_definitions;
  parameter_ids text[] := '{}';
  parameter_keys text[] := '{}';
  placement_ids text[] := '{}';
  id text;
  order_seen numeric[] := '{}';
  mapped boolean;
BEGIN
  IF octet_length(p_config::text) > 1048576 THEN
    RAISE EXCEPTION 'Notebook Template configuration exceeds 1 MiB' USING ERRCODE = 'SB091';
  END IF;
  PERFORM internal.assert_sheet_definition_object(
    p_config,
    ARRAY['formatVersion','parameters','placements'],
    ARRAY['formatVersion','parameters','placements'],
    'configuration'
  );
  IF p_config->'formatVersion' <> '1'::jsonb THEN
    RAISE EXCEPTION 'unsupported Notebook Template configuration format' USING ERRCODE = 'SB091';
  END IF;
  IF jsonb_typeof(p_config->'parameters') <> 'array'
     OR jsonb_array_length(p_config->'parameters') > 64
     OR jsonb_typeof(p_config->'placements') <> 'array'
     OR jsonb_array_length(p_config->'placements') > 256 THEN
    RAISE EXCEPTION 'invalid Notebook Template sections' USING ERRCODE = 'SB091';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
    BEGIN
      PERFORM internal.validate_parameter(item);
    EXCEPTION WHEN SQLSTATE 'SB071' THEN
      RAISE EXCEPTION 'invalid Notebook Template parameter: %', SQLERRM USING ERRCODE = 'SB091';
    END;
    id := item->>'id';
    IF id = ANY(parameter_ids) OR item->>'key' = ANY(parameter_keys) THEN
      RAISE EXCEPTION 'duplicate Notebook Template parameter identity' USING ERRCODE = 'SB091';
    END IF;
    parameter_ids := array_append(parameter_ids, id);
    parameter_keys := array_append(parameter_keys, item->>'key');
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'placements') LOOP
    IF jsonb_typeof(item) <> 'object' OR item->>'kind' NOT IN ('narrative','sheet','section_placeholder') THEN
      RAISE EXCEPTION 'invalid Template placement kind' USING ERRCODE = 'SB091';
    END IF;
    id := internal.sheet_definition_uuid(item->>'id','placements.id')::text;
    IF id = ANY(placement_ids) THEN
      RAISE EXCEPTION 'duplicate Template placement id' USING ERRCODE = 'SB091';
    END IF;
    placement_ids := array_append(placement_ids, id);
    IF jsonb_typeof(item->'order') <> 'number'
       OR (item->>'order')::numeric <> trunc((item->>'order')::numeric)
       OR (item->>'order')::numeric < 1
       OR (item->>'order')::numeric = ANY(order_seen) THEN
      RAISE EXCEPTION 'Template placements require unique positive integer order' USING ERRCODE = 'SB091';
    END IF;
    order_seen := array_append(order_seen, (item->>'order')::numeric);

    IF item->>'kind' = 'narrative' THEN
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','blockType','payload'],
        ARRAY['id','kind','order','blockType','payload'],
        'placements.narrative'
      );
      IF item->>'blockType' NOT IN (
        'rich_text','checklist','linked_record','callout','table','chart',
        'plate_map','file','metric','procedure_step','protocol_reference','materials'
      ) THEN
        RAISE EXCEPTION 'narrative placement cannot be a Sheet block' USING ERRCODE = 'SB091';
      END IF;
      IF jsonb_typeof(item->'payload') <> 'object' THEN
        RAISE EXCEPTION 'narrative placement payload must be an object' USING ERRCODE = 'SB091';
      END IF;
    ELSIF item->>'kind' = 'section_placeholder' THEN
      -- CORE-06.11: reserved reference shape so future versioned Sections
      -- can be named without Template inheritance.
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','key','label'],
        ARRAY['id','kind','order','key','label'],
        'placements.section'
      );
      IF item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
         OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'invalid Template section placeholder' USING ERRCODE = 'SB091';
      END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','definitionVersionId','parameterMappings'],
        ARRAY['id','kind','order','definitionVersionId','parameterMappings','title'],
        'placements.sheet'
      );
      IF item ? 'title' AND (jsonb_typeof(item->'title') <> 'string' OR length(btrim(item->>'title')) > 200) THEN
        RAISE EXCEPTION 'invalid Sheet placement title' USING ERRCODE = 'SB091';
      END IF;
      SELECT * INTO version_row
        FROM api.sheet_definition_versions definition_version
        WHERE definition_version.id = internal.sheet_definition_uuid(
          item->>'definitionVersionId','placements.definitionVersionId'
        );
      IF version_row.id IS NULL OR version_row.lifecycle <> 'published' THEN
        RAISE EXCEPTION 'Sheet placement must pin a published Sheet Definition Version' USING ERRCODE = 'SB091';
      END IF;
      SELECT * INTO definition FROM api.sheet_definitions sheet_def
        WHERE sheet_def.id = version_row.definition_id;
      IF definition.workspace_id IS DISTINCT FROM p_workspace_id OR definition.lifecycle <> 'active' THEN
        RAISE EXCEPTION 'Sheet Definition Version must belong to this workspace' USING ERRCODE = 'SB091';
      END IF;
      IF jsonb_typeof(item->'parameterMappings') <> 'array'
         OR jsonb_array_length(item->'parameterMappings') > 64 THEN
        RAISE EXCEPTION 'invalid parameterMappings' USING ERRCODE = 'SB091';
      END IF;
      FOR mapping IN SELECT value FROM jsonb_array_elements(item->'parameterMappings') LOOP
        PERFORM internal.assert_sheet_definition_object(
          mapping,
          ARRAY['templateParameterId','definitionParameterId'],
          ARRAY['templateParameterId','definitionParameterId'],
          'parameterMappings'
        );
        IF (mapping->>'templateParameterId') <> ALL(parameter_ids) THEN
          RAISE EXCEPTION 'parameter mapping names an unknown Template parameter' USING ERRCODE = 'SB091';
        END IF;
        SELECT value INTO parameter
          FROM jsonb_array_elements(p_config->'parameters') value
          WHERE value->>'id' = mapping->>'templateParameterId';
        SELECT value INTO def_param
          FROM jsonb_array_elements(coalesce(version_row.configuration->'parameters','[]'::jsonb)) value
          WHERE value->>'id' = mapping->>'definitionParameterId';
        IF def_param IS NULL THEN
          RAISE EXCEPTION 'parameter mapping names an unknown Sheet Definition parameter' USING ERRCODE = 'SB091';
        END IF;
        IF parameter->'type' IS DISTINCT FROM def_param->'type' THEN
          RAISE EXCEPTION 'Template parameter type must match the mapped Definition parameter' USING ERRCODE = 'SB091';
        END IF;
      END LOOP;
      FOR def_param IN SELECT value FROM jsonb_array_elements(coalesce(version_row.configuration->'parameters','[]'::jsonb)) LOOP
        IF def_param->>'required' = 'true' THEN
          mapped := EXISTS (
            SELECT 1 FROM jsonb_array_elements(item->'parameterMappings') map_row
            WHERE map_row->>'definitionParameterId' = def_param->>'id'
          );
          IF NOT mapped THEN
            RAISE EXCEPTION 'required Sheet Definition parameter % is unmapped', def_param->>'id'
              USING ERRCODE = 'SB091';
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

CREATE FUNCTION internal.guard_notebook_template()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notebook Templates cannot be deleted' USING ERRCODE = 'SB090';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.workspace_id, NEW.key, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.workspace_id, OLD.key, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'Notebook Template identity is immutable' USING ERRCODE = 'SB090';
    END IF;
    IF OLD.lifecycle = 'retired' THEN
      RAISE EXCEPTION 'retired Notebook Templates are immutable' USING ERRCODE = 'SB090';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER guard_notebook_template
  BEFORE UPDATE OR DELETE ON api.notebook_templates
  FOR EACH ROW EXECUTE FUNCTION internal.guard_notebook_template();

CREATE FUNCTION internal.guard_notebook_template_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE parent api.notebook_templates; expected integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Notebook Template Versions cannot be deleted' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO parent FROM api.notebook_templates WHERE id = NEW.template_id FOR UPDATE;
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Notebook Template missing' USING ERRCODE = '23503'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF parent.lifecycle <> 'active' THEN
      RAISE EXCEPTION 'retired Notebook Template cannot be configured' USING ERRCODE = 'SB090';
    END IF;
    SELECT coalesce(max(version),0)+1 INTO expected FROM api.notebook_template_versions WHERE template_id = NEW.template_id;
    IF NEW.version <> expected OR NEW.lifecycle <> 'draft' OR NEW.revision <> 1
       OR NEW.published_at IS NOT NULL OR NEW.published_by_user_id IS NOT NULL
       OR NEW.retired_at IS NOT NULL OR NEW.retired_by_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Notebook Template Versions must be explicit monotonic drafts' USING ERRCODE = 'SB091';
    END IF;
    PERFORM internal.validate_notebook_template_configuration(parent.workspace_id, NEW.configuration);
  ELSE
    IF (NEW.id, NEW.template_id, NEW.version, NEW.configuration_format_version, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.template_id, OLD.version, OLD.configuration_format_version, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'Notebook Template Version identity is immutable' USING ERRCODE = 'SB090';
    END IF;
    IF OLD.lifecycle = 'retired' THEN
      RAISE EXCEPTION 'retired Notebook Template Versions are immutable' USING ERRCODE = 'SB090';
    END IF;
    IF OLD.lifecycle = 'published' THEN
      IF NEW.lifecycle <> 'retired'
         OR NEW.configuration IS DISTINCT FROM OLD.configuration
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
         OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id THEN
        RAISE EXCEPTION 'published Notebook Template Versions are immutable' USING ERRCODE = 'SB090';
      END IF;
    ELSE
      IF parent.lifecycle <> 'active' AND NEW.lifecycle <> 'retired' THEN
        RAISE EXCEPTION 'retired Notebook Template cannot be configured' USING ERRCODE = 'SB090';
      END IF;
      PERFORM internal.validate_notebook_template_configuration(parent.workspace_id, NEW.configuration);
      IF NEW.lifecycle = 'published' AND (NEW.published_at IS NULL OR NEW.published_by_user_id IS NULL) THEN
        RAISE EXCEPTION 'publication attribution is required' USING ERRCODE = 'SB091';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER guard_notebook_template_version
  BEFORE INSERT OR UPDATE OR DELETE ON api.notebook_template_versions
  FOR EACH ROW EXECUTE FUNCTION internal.guard_notebook_template_version();

ALTER TABLE api.notebook_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.notebook_template_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.notebook_templates, api.notebook_template_versions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON api.notebook_templates, api.notebook_template_versions FROM authenticated;
CREATE POLICY notebook_templates_read ON api.notebook_templates
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY notebook_template_versions_read ON api.notebook_template_versions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM api.notebook_templates t
    WHERE t.id = template_id
      AND t.workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(t.workspace_id)
  ));

CREATE FUNCTION api.create_notebook_template(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_description text,
  p_configuration jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  template api.notebook_templates;
  version api.notebook_template_versions;
  actor text := api.current_user_id();
BEGIN
  PERFORM api.require_capability(p_workspace_id, 'schema.edit');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$'
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
     OR length(coalesce(p_description,'')) > 2000 THEN
    RAISE EXCEPTION 'invalid Notebook Template metadata' USING ERRCODE = 'SB091';
  END IF;
  PERFORM internal.validate_notebook_template_configuration(p_workspace_id, p_configuration);
  INSERT INTO api.notebook_templates(
    workspace_id, key, name, description, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name), nullif(btrim(p_description),''), actor, actor
  ) RETURNING * INTO template;
  INSERT INTO api.notebook_template_versions(
    template_id, version, configuration, created_by_user_id, updated_by_user_id
  ) VALUES (template.id, 1, p_configuration, actor, actor)
  RETURNING * INTO version;
  RETURN jsonb_build_object('template', to_jsonb(template), 'version', to_jsonb(version));
END
$$;

CREATE FUNCTION api.create_notebook_template_version(
  p_template_id uuid,
  p_expected_template_revision bigint,
  p_configuration jsonb
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  template api.notebook_templates;
  result api.notebook_template_versions;
  next_version integer;
  actor text := api.current_user_id();
BEGIN
  SELECT * INTO template FROM api.notebook_templates WHERE id = p_template_id FOR UPDATE;
  IF template.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(template.workspace_id, 'schema.edit');
  IF template.revision <> p_expected_template_revision THEN
    RAISE EXCEPTION 'stale Notebook Template revision' USING ERRCODE = 'SB001';
  END IF;
  IF template.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'retired Notebook Template cannot be configured' USING ERRCODE = 'SB090';
  END IF;
  PERFORM internal.validate_notebook_template_configuration(template.workspace_id, p_configuration);
  SELECT coalesce(max(version),0)+1 INTO next_version FROM api.notebook_template_versions WHERE template_id = template.id;
  INSERT INTO api.notebook_template_versions(
    template_id, version, configuration, created_by_user_id, updated_by_user_id
  ) VALUES (template.id, next_version, p_configuration, actor, actor)
  RETURNING * INTO result;
  UPDATE api.notebook_templates
    SET revision = revision + 1, updated_at = now(), updated_by_user_id = actor
    WHERE id = template.id;
  RETURN result;
END
$$;

CREATE FUNCTION api.update_notebook_template_version(
  p_version_id uuid,
  p_expected_revision bigint,
  p_configuration jsonb
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result api.notebook_template_versions;
  template api.notebook_templates;
  actor text := api.current_user_id();
BEGIN
  SELECT * INTO result FROM api.notebook_template_versions WHERE id = p_version_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE = '42501'; END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = result.template_id FOR UPDATE;
  PERFORM api.require_capability(template.workspace_id, 'schema.edit');
  IF result.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Notebook Template Versions can be edited' USING ERRCODE = 'SB090';
  END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  PERFORM internal.validate_notebook_template_configuration(template.workspace_id, p_configuration);
  UPDATE api.notebook_template_versions
    SET configuration = p_configuration,
        revision = revision + 1,
        updated_at = now(),
        updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END
$$;

CREATE FUNCTION api.publish_notebook_template_version(
  p_version_id uuid,
  p_expected_revision bigint
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result api.notebook_template_versions;
  template api.notebook_templates;
  actor text := api.current_user_id();
BEGIN
  SELECT * INTO result FROM api.notebook_template_versions WHERE id = p_version_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501'; END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = result.template_id FOR UPDATE;
  PERFORM api.require_capability(template.workspace_id, 'schema.publish');
  IF result.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Notebook Template Versions can be published' USING ERRCODE = 'SB090';
  END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  UPDATE api.notebook_template_versions
    SET lifecycle = 'published',
        published_at = now(),
        published_by_user_id = actor,
        updated_at = now(),
        updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END
$$;

CREATE FUNCTION api.retire_notebook_template_version(
  p_version_id uuid,
  p_expected_revision bigint
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result api.notebook_template_versions;
  template api.notebook_templates;
  actor text := api.current_user_id();
BEGIN
  SELECT * INTO result FROM api.notebook_template_versions WHERE id = p_version_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE = '42501'; END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = result.template_id FOR UPDATE;
  PERFORM api.require_capability(template.workspace_id, 'schema.retire');
  IF result.lifecycle = 'retired' THEN RETURN result; END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  UPDATE api.notebook_template_versions
    SET lifecycle = 'retired',
        retired_at = now(),
        retired_by_user_id = actor,
        updated_at = now(),
        updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END
$$;

ALTER FUNCTION api.discover_object_dependencies(text, uuid)
  RENAME TO discover_object_dependencies_core062;

CREATE FUNCTION api.discover_object_dependencies(p_kind text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  base jsonb;
  items jsonb := '[]'::jsonb;
  template api.notebook_templates;
  version api.notebook_template_versions;
BEGIN
  IF p_kind = 'notebook_template' THEN
    IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
      RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO template FROM api.notebook_templates
      WHERE id = p_object_id AND workspace_id = workspace;
    IF template.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'notebook_template_version', v.id, 'template_version',
      CASE WHEN v.lifecycle = 'published' THEN 'active' ELSE 'historical' END,
      'blocks_deletion', 'v' || v.version::text
    ) ORDER BY v.version), '[]'::jsonb) INTO items
    FROM api.notebook_template_versions v WHERE v.template_id = template.id;
    RETURN jsonb_build_object('kind', p_kind, 'id', p_object_id, 'dependencies', coalesce(items,'[]'::jsonb));
  END IF;

  IF p_kind = 'notebook_template_version' THEN
    IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
      RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
    END IF;
    SELECT v.* INTO version
      FROM api.notebook_template_versions v
      JOIN api.notebook_templates t ON t.id = v.template_id
      WHERE v.id = p_object_id AND t.workspace_id = workspace;
    IF version.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_definition_version', def_id, 'template_sheet_placement',
      'active', 'informational', 'pinned definition'
    ) ORDER BY def_id), '[]'::jsonb) INTO items
    FROM (
      SELECT DISTINCT internal.collect_uuid(placement->>'definitionVersionId') AS def_id
      FROM jsonb_array_elements(coalesce(version.configuration->'placements','[]'::jsonb)) placement
      WHERE placement->>'kind' = 'sheet'
    ) refs
    WHERE def_id IS NOT NULL;
    RETURN jsonb_build_object('kind', p_kind, 'id', p_object_id, 'dependencies', coalesce(items,'[]'::jsonb));
  END IF;

  base := api.discover_object_dependencies_core062(p_kind, p_object_id);
  RETURN base;
END
$$;

REVOKE EXECUTE ON FUNCTION
  internal.validate_notebook_template_configuration(uuid, jsonb),
  internal.guard_notebook_template(),
  internal.guard_notebook_template_version(),
  internal.guard_record_template_version(),
  api.discover_object_dependencies_core062(text, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
REVOKE EXECUTE ON FUNCTION
  api.create_notebook_template(uuid, text, text, text, jsonb),
  api.create_notebook_template_version(uuid, bigint, jsonb),
  api.update_notebook_template_version(uuid, bigint, jsonb),
  api.publish_notebook_template_version(uuid, bigint),
  api.retire_notebook_template_version(uuid, bigint),
  api.discover_object_dependencies(text, uuid)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.create_notebook_template(uuid, text, text, text, jsonb),
  api.create_notebook_template_version(uuid, bigint, jsonb),
  api.update_notebook_template_version(uuid, bigint, jsonb),
  api.publish_notebook_template_version(uuid, bigint),
  api.retire_notebook_template_version(uuid, bigint),
  api.discover_object_dependencies(text, uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
