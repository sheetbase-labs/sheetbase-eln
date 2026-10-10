-- MDL-02.1 (ADR-0051) — typed relationship rules for workspace record models.
--
-- `api.model_relationship_rules.source_model_key` was a foreign key to
-- `api.model_kinds.key`, so a workspace-owned record model (`api.record_models`,
-- ADR-0051) could not be a relationship source; the MDL-02.1 Relations tab was
-- blocked. Mirror the field-definition kind guard from 0287: drop the FK and
-- accept either a built-in `model_kinds` key or a same-workspace
-- `record_models` key, raising SB071 otherwise.
--
-- Targets stay built-in record-backed models (the `target_model_key` FK is
-- unchanged): a workspace model may declare typed edges to the canonical
-- Models, but never to another workspace's private model. The stewardship RPC
-- and the link-creation enforcement trigger resolve the source through
-- `internal.model_key_for`, which 0287 extended to resolve a workspace model,
-- so a declared rule actually constrains links created from a workspace
-- model's records.

ALTER TABLE "api"."model_relationship_rules"
  DROP CONSTRAINT "model_relationship_rules_source_model_key_model_kinds_key_fk";
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."guard_model_relationship_rule_source"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "api"."model_kinds" WHERE "key" = NEW."source_model_key"
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."record_models"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "key" = NEW."source_model_key"
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'unknown relationship source model: %', NEW."source_model_key"
    USING ERRCODE='SB071';
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."guard_model_relationship_rule_source"() FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
CREATE TRIGGER "model_relationship_rules_source_guard"
  BEFORE INSERT OR UPDATE OF "source_model_key", "workspace_id"
  ON "api"."model_relationship_rules"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_model_relationship_rule_source"();
--> statement-breakpoint

-- Stewardship: declare (upsert) one typed-relationship rule. The source is a
-- built-in record-backed kind or a same-workspace workspace model; the target
-- remains a built-in record-backed model. Owner/admin only via the canonical
-- model-field admin check, which also pins the active workspace.
CREATE OR REPLACE FUNCTION "api"."configure_model_relationship_rule"(
  p_workspace_id uuid, p_source_model_key text, p_link_type text,
  p_target_model_key text, p_min_links integer DEFAULT 0,
  p_max_links integer DEFAULT NULL, p_label text DEFAULT NULL
) RETURNS "api"."model_relationship_rules"
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.model_relationship_rules; v_link text; v_label text;
BEGIN
  IF NOT api.is_model_field_admin(p_workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
  v_link := nullif(btrim(coalesce(p_link_type, '')), '');
  IF v_link IS NULL OR v_link NOT IN ('sample','protocol','dataset','reagent','analysis','file','general','template') THEN
    RAISE EXCEPTION 'link type must use the record link vocabulary' USING ERRCODE='SB071';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.model_kinds WHERE key=p_source_model_key AND identity_table='api.records')
     AND NOT EXISTS(SELECT 1 FROM api.record_models
       WHERE workspace_id=p_workspace_id AND key=p_source_model_key) THEN
    RAISE EXCEPTION 'relationship source must be a record model' USING ERRCODE='SB071';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.model_kinds WHERE key=p_target_model_key AND identity_table='api.records') THEN
    RAISE EXCEPTION 'relationship target must be a record-backed model' USING ERRCODE='SB071';
  END IF;
  IF coalesce(p_min_links, 0) < 0 THEN RAISE EXCEPTION 'minimum links cannot be negative' USING ERRCODE='SB071'; END IF;
  IF p_max_links IS NOT NULL AND p_max_links < coalesce(p_min_links, 0) THEN
    RAISE EXCEPTION 'maximum links cannot be below the minimum' USING ERRCODE='SB071';
  END IF;
  v_label := nullif(btrim(coalesce(p_label, '')), '');
  INSERT INTO api.model_relationship_rules(workspace_id,source_model_key,link_type,target_model_key,min_links,max_links,label,created_by_user_id)
  VALUES(p_workspace_id,p_source_model_key,v_link,p_target_model_key,coalesce(p_min_links,0),p_max_links,v_label,api.current_user_id())
  ON CONFLICT (workspace_id,source_model_key,link_type,target_model_key)
  DO UPDATE SET min_links=EXCLUDED.min_links, max_links=EXCLUDED.max_links, label=EXCLUDED.label, updated_at=now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."configure_model_relationship_rule"(uuid,text,text,text,integer,integer,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."configure_model_relationship_rule"(uuid,text,text,text,integer,integer,text) TO authenticated;
--> statement-breakpoint

-- Enforcement: resolve the source model key for a workspace model as well as a
-- built-in kind, so a rule declared by a workspace model constrains links
-- created from its records. `internal.model_key_for` (0287) returns the
-- built-in key first and falls back to the same-workspace record model, which
-- leaves every built-in source's behaviour unchanged. The rest of the trigger
-- is unchanged: SB080 for undeclared (type, target) pairs, SB081 for
-- over-maximum edges.
CREATE OR REPLACE FUNCTION "internal"."assert_model_relationship_rule"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_workspace uuid; v_source_model text; v_target_model text; v_count integer;
  v_has_rules boolean; v_rule api.model_relationship_rules;
BEGIN
  SELECT r.workspace_id, internal.model_key_for('api.records', r.kind)
    INTO v_workspace, v_source_model
    FROM api.records r
    WHERE r.id=NEW.source_record_id;
  IF v_workspace IS NULL THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM api.model_relationship_rules
    WHERE workspace_id=v_workspace AND source_model_key=v_source_model)
    INTO v_has_rules;
  IF NOT v_has_rules THEN RETURN NEW; END IF;
  IF NEW.target_record_id IS NOT NULL THEN
    SELECT m.key INTO v_target_model FROM api.records r JOIN api.model_kinds m
      ON m.record_kind=r.kind AND m.identity_table='api.records'
      WHERE r.id=NEW.target_record_id;
  ELSE
    SELECT key INTO v_target_model FROM api.model_kinds
      WHERE record_kind=NEW.target_kind AND identity_table='api.records';
  END IF;
  IF v_target_model IS NULL THEN
    RAISE EXCEPTION 'link target model is not recognised for model %', v_source_model USING ERRCODE='SB080';
  END IF;
  SELECT * INTO v_rule FROM api.model_relationship_rules
    WHERE workspace_id=v_workspace AND source_model_key=v_source_model
      AND link_type=NEW.link_type AND target_model_key=v_target_model;
  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'link type % to model % is not allowed for model %', NEW.link_type, v_target_model, v_source_model USING ERRCODE='SB080';
  END IF;
  IF v_rule.max_links IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM api.record_links
      WHERE source_record_id=NEW.source_record_id AND target_identifier=NEW.target_identifier AND link_type=NEW.link_type) THEN
      RETURN NEW;
    END IF;
    -- Serialize competing inserts per matched rule: lock the rule row before
    -- counting so two concurrent transactions cannot both observe count < max.
    -- One row, always the same row per bound: waits stay linear, no cycles.
    PERFORM 1 FROM api.model_relationship_rules WHERE id=v_rule.id FOR UPDATE;
    SELECT count(*) INTO v_count FROM api.record_links l
      LEFT JOIN api.records r ON r.id=l.target_record_id
      LEFT JOIN api.model_kinds mr ON mr.record_kind=r.kind AND mr.identity_table='api.records'
      LEFT JOIN api.model_kinds mk ON mk.record_kind=l.target_kind AND mk.identity_table='api.records'
      WHERE l.source_record_id=NEW.source_record_id AND l.link_type=NEW.link_type
        AND coalesce(mr.key, mk.key)=v_target_model;
    IF v_count >= v_rule.max_links THEN
      RAISE EXCEPTION 'link type % to model % exceeds the maximum of % for model %', NEW.link_type, v_target_model, v_rule.max_links, v_source_model USING ERRCODE='SB081';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."assert_model_relationship_rule"() FROM PUBLIC;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
