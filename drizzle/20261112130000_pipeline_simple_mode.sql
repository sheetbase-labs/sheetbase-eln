-- Simple pipelines (a recipe), Convert to Standard, and Duplicate.
--
-- A Simple version is written as a recipe (`configuration.recipe`) and stores
-- the steps the recipe compiles to beside it, so the runner reads steps only.
-- A pipeline moves to a more expressive mode and never back: a version may not
-- be written in a simpler mode than any version before it. Converting Simple to
-- Standard keeps the steps and drops the recipe. Duplicating a version starts a
-- new pipeline from it, in the mode it was written in.

CREATE FUNCTION internal.pipeline_mode_rank(p_mode text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE coalesce(p_mode, 'standard') WHEN 'simple' THEN 1 WHEN 'standard' THEN 2 WHEN 'advanced' THEN 3 ELSE 0 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_mode_rank(text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.pipeline_version_mode_rules() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_mode text := NEW.configuration->>'mode';
  v_before integer;
BEGIN
  IF v_mode = 'simple' AND jsonb_typeof(NEW.configuration->'recipe') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a Simple pipeline version carries its recipe' USING ERRCODE = 'SB070';
  END IF;
  IF v_mode IS DISTINCT FROM 'simple' AND NEW.configuration ? 'recipe' THEN
    RAISE EXCEPTION 'only a Simple pipeline version carries a recipe' USING ERRCODE = 'SB070';
  END IF;
  SELECT coalesce(max(internal.pipeline_mode_rank(configuration->>'mode')), 0) INTO v_before
    FROM api.pipeline_definition_versions
   WHERE definition_id = NEW.definition_id AND version < NEW.version;
  IF internal.pipeline_mode_rank(v_mode) < v_before THEN
    RAISE EXCEPTION 'a pipeline cannot go back to a simpler mode; duplicate an older version instead'
      USING ERRCODE = 'SB070';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_version_mode_rules() OWNER TO migrator;
--> statement-breakpoint

CREATE TRIGGER pipeline_version_mode_rules
  BEFORE INSERT OR UPDATE OF configuration ON api.pipeline_definition_versions
  FOR EACH ROW EXECUTE FUNCTION internal.pipeline_version_mode_rules();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Convert a Simple pipeline to Standard
-- ---------------------------------------------------------------------------
-- The draft becomes Standard in place; with no draft, the newest version is
-- copied into a new Standard draft. Published versions are never changed, so
-- the published one keeps running until the draft is published.
CREATE FUNCTION api.convert_pipeline_to_standard(p_workspace_id uuid, p_definition_id uuid)
    RETURNS api.pipeline_definition_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_source api.pipeline_definition_versions;
  v_config jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_source FROM api.pipeline_definition_versions
   WHERE definition_id = p_definition_id AND workspace_id = p_workspace_id
   ORDER BY (lifecycle = 'draft') DESC, version DESC
   LIMIT 1 FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'pipeline has no version to convert' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.configuration->>'mode' IS DISTINCT FROM 'simple' THEN
    RAISE EXCEPTION 'only a Simple pipeline can be converted to Standard' USING ERRCODE = 'SB034';
  END IF;
  v_config := (v_source.configuration - 'recipe') || jsonb_build_object('mode', 'standard');
  IF v_source.lifecycle = 'draft' THEN
    RETURN api.update_pipeline_definition_version_draft(
      p_workspace_id, v_source.id, v_source.revision, v_config);
  END IF;
  RETURN api.create_pipeline_definition_version(p_workspace_id, p_definition_id, v_config);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.convert_pipeline_to_standard(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.convert_pipeline_to_standard(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.convert_pipeline_to_standard(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Duplicate a version as a new pipeline
-- ---------------------------------------------------------------------------
-- The copy starts as draft 1 in the same mode, with nothing carried over but
-- the configuration: no runs, starts or history.
CREATE FUNCTION api.duplicate_pipeline_definition(
  p_workspace_id uuid, p_version_id uuid, p_key text, p_name text)
    RETURNS api.pipeline_definitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.pipeline_definition_versions;
  v_source api.pipeline_definitions;
  v_new api.pipeline_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id;
  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT * INTO v_source FROM api.pipeline_definitions WHERE id = v_version.definition_id;
  v_new := api.create_pipeline_definition(p_workspace_id, p_key, p_name, v_source.description);
  PERFORM api.create_pipeline_definition_version(p_workspace_id, v_new.id, v_version.configuration);
  RETURN v_new;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.duplicate_pipeline_definition(uuid, uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.duplicate_pipeline_definition(uuid, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.duplicate_pipeline_definition(uuid, uuid, text, text) TO authenticated;
