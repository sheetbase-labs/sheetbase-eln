ALTER TABLE "api"."notebook_template_versions" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "api"."notebook_template_versions" ADD COLUMN "signed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "api"."notebook_template_versions" ADD COLUMN "signed_meaning" text;--> statement-breakpoint
ALTER TABLE "api"."notebook_template_versions" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."notebook_template_versions" ADD CONSTRAINT "notebook_template_versions_signed_by_user_id_user_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- CORE-06 governance: publishing and retiring a template version records a
-- reason; retiring is an e-signature (the caller must be certified) and is
-- blocked while unsigned records are still pinned to the version.
DROP FUNCTION IF EXISTS api.publish_notebook_template_version(uuid,bigint);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.publish_notebook_template_version(
  p_version_id uuid,
  p_expected_revision bigint,
  p_reason text
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
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
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  IF result.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Notebook Template Versions can be published' USING ERRCODE = 'SB090';
  END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  UPDATE api.notebook_template_versions
    SET lifecycle = 'published', published_at = now(), published_by_user_id = actor,
        reason = btrim(p_reason), updated_at = now(), updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.publish_notebook_template_version(uuid,bigint,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.publish_notebook_template_version(uuid,bigint,text) TO authenticated;
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.retire_notebook_template_version(uuid,bigint);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.retire_notebook_template_version(
  p_version_id uuid,
  p_expected_revision bigint,
  p_reason text,
  p_meaning text
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result api.notebook_template_versions;
  template api.notebook_templates;
  actor text := api.current_user_id();
  unsigned integer;
BEGIN
  SELECT * INTO result FROM api.notebook_template_versions WHERE id = p_version_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE = '42501'; END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = result.template_id FOR UPDATE;
  PERFORM api.require_capability(template.workspace_id, 'schema.retire');
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  IF p_meaning IS NULL OR length(btrim(p_meaning)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a signature meaning is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.user_signature_certifications c
    WHERE c.workspace_id = template.workspace_id AND c.user_id = actor AND c.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'signature certification required' USING ERRCODE = '42501';
  END IF;
  IF result.lifecycle = 'retired' THEN RETURN result; END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  SELECT count(*) INTO unsigned FROM api.records r
    WHERE r.source_notebook_template_version_id = result.id
      AND r.locked_at IS NULL AND r.deleted_at IS NULL AND r.archived_at IS NULL;
  IF unsigned > 0 THEN
    RAISE EXCEPTION 'unsigned records are still on this version' USING ERRCODE = 'SB091';
  END IF;
  UPDATE api.notebook_template_versions
    SET lifecycle = 'retired', retired_at = now(), retired_by_user_id = actor,
        reason = btrim(p_reason), signed_by_user_id = actor,
        signed_meaning = btrim(p_meaning), signed_at = now(),
        updated_at = now(), updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.retire_notebook_template_version(uuid,bigint,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.retire_notebook_template_version(uuid,bigint,text,text) TO authenticated;
