CREATE TABLE "api"."model_relationship_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_model_key" text NOT NULL,
	"link_type" text NOT NULL,
	"target_model_key" text NOT NULL,
	"min_links" integer DEFAULT 0 NOT NULL,
	"max_links" integer,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	CONSTRAINT "uq_model_relationship_rules_scope" UNIQUE("workspace_id","source_model_key","link_type","target_model_key"),
	CONSTRAINT "chk_model_relationship_rules_min" CHECK ("api"."model_relationship_rules"."min_links" >= 0),
	CONSTRAINT "chk_model_relationship_rules_max" CHECK ("api"."model_relationship_rules"."max_links" IS NULL OR "api"."model_relationship_rules"."max_links" >= "api"."model_relationship_rules"."min_links")
);
--> statement-breakpoint
ALTER TABLE "api"."model_relationship_rules" ADD CONSTRAINT "model_relationship_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."model_relationship_rules" ADD CONSTRAINT "model_relationship_rules_source_model_key_model_kinds_key_fk" FOREIGN KEY ("source_model_key") REFERENCES "api"."model_kinds"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."model_relationship_rules" ADD CONSTRAINT "model_relationship_rules_target_model_key_model_kinds_key_fk" FOREIGN KEY ("target_model_key") REFERENCES "api"."model_kinds"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."model_relationship_rules" ADD CONSTRAINT "model_relationship_rules_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_model_relationship_rules_scope" ON "api"."model_relationship_rules" USING btree ("workspace_id","source_model_key","link_type");
--> statement-breakpoint
-- MODEL-03: Model relationship rules — RLS, stewardship RPCs, and
-- link-creation enforcement. Rules are workspace-scoped configuration over
-- the canonical Models (both keys reference model_kinds); the links stay
-- authoritative in record_links. Enforcement is a BEFORE INSERT trigger so
-- it covers the create_record_link RPC, direct PostgREST inserts, and the
-- internal block-copy upserts alike. The world closes per source Model: a
-- Model with no declared rules keeps current behaviour untouched, while a
-- Model with any rule allows only its declared (link type, target model)
-- pairs. Minimum counts are completeness metadata for readers (they
-- cannot be violated by adding a link); maximum counts and
-- type/target allowability fail closed here with SB080/SB081.
ALTER TABLE "api"."model_relationship_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "model_relationship_rules_select" ON "api"."model_relationship_rules"
  FOR SELECT TO authenticated
  USING (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"("workspace_id")
  );--> statement-breakpoint
CREATE POLICY "model_relationship_rules_select_api_client" ON "api"."model_relationship_rules"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());--> statement-breakpoint
REVOKE ALL ON "api"."model_relationship_rules" FROM PUBLIC, anon, authenticated, api_client;--> statement-breakpoint
GRANT SELECT ON "api"."model_relationship_rules" TO authenticated, api_client;--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."model_relationship_rules"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
-- Stewardship: declare (upsert) or remove one typed-relationship rule.
-- Owner/admin only via the canonical model-field admin check, which also
-- pins the active workspace. Both keys must be record-backed models
-- (mirrors the 0057 reference guard); link types stay inside the
-- record_links vocabulary so a rule can never demand an uninsertable edge.
CREATE FUNCTION "api"."configure_model_relationship_rule"(
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
  IF NOT EXISTS(SELECT 1 FROM api.model_kinds WHERE key=p_source_model_key AND identity_table='api.records') THEN
    RAISE EXCEPTION 'relationship source must be a record-backed model' USING ERRCODE='SB071';
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
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."configure_model_relationship_rule"(uuid,text,text,text,integer,integer,text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."configure_model_relationship_rule"(uuid,text,text,text,integer,integer,text) TO authenticated;--> statement-breakpoint
CREATE FUNCTION "api"."remove_model_relationship_rule"(p_rule_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.model_relationship_rules;
BEGIN
  SELECT * INTO v FROM api.model_relationship_rules WHERE id=p_rule_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'relationship rule not found' USING ERRCODE='SB071'; END IF;
  IF NOT api.is_model_field_admin(v.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
  DELETE FROM api.model_relationship_rules WHERE id=p_rule_id;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."remove_model_relationship_rule"(uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."remove_model_relationship_rule"(uuid) TO authenticated;--> statement-breakpoint
-- Enforcement: reject undeclared (link type, target model) pairs (SB080)
-- and over-maximum edges (SB081) wherever the link is created. The world
-- closes per source Model: a Model with no declared rules keeps current
-- behaviour untouched, while a Model with any rule allows only its
-- declared pairs. Re-linking the same edge (the materials/plate/template
-- dedupe upsert path) does not grow the count, so it is exempt from the
-- maximum check while the unique (source, target_identifier, link_type)
-- constraint keeps dedupe authority. Workspace isolation stays with the
-- existing same-workspace guard and RLS — this trigger only judges
-- type/target allowability.
CREATE OR REPLACE FUNCTION "internal"."assert_model_relationship_rule"()
RETURNS trigger
-- SECURITY DEFINER: row locks (FOR UPDATE below) require more than the
-- SELECT-only grants member roles hold on the rules table. Scope is
-- re-established inside: the workspace derives from the source-record row
-- and the rule lookup is pinned to it; the outer INSERT's RLS still
-- authorizes the link itself.
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_workspace uuid; v_source_model text; v_target_model text; v_count integer;
  v_has_rules boolean; v_rule api.model_relationship_rules;
BEGIN
  SELECT r.workspace_id, m.key INTO v_workspace, v_source_model
    FROM api.records r LEFT JOIN api.model_kinds m
      ON m.record_kind=r.kind AND m.identity_table='api.records'
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
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."assert_model_relationship_rule"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "assert_model_relationship_rule"
  BEFORE INSERT ON "api"."record_links"
  FOR EACH ROW EXECUTE FUNCTION "internal"."assert_model_relationship_rule"();--> statement-breakpoint
NOTIFY pgrst, 'reload schema';