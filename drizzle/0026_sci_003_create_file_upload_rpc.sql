-- SCI-003: transactional upload-authorize RPC. create_record + file_objects
-- insert are now a single atomic call so a metadata failure cannot leave an
-- orphan file record. SECURITY INVOKER: RLS, change events and audit
-- attribution fire exactly as for the previous two-call flow.

CREATE OR REPLACE FUNCTION "api"."create_file_upload"(
  p_project_id uuid,
  p_display_name text,
  p_media_type text,
  p_byte_size bigint,
  p_storage_key text,
  p_checksum text DEFAULT NULL,
  p_storage_backend text DEFAULT 'local',
  p_file_object_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(
  record_id uuid,
  identifier text,
  file_object_id uuid,
  storage_key text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_record "api"."records";
BEGIN
  -- Reuse create_record so workspace/user claims, identifier sequencing, RLS
  -- and the record change event are identical to a manual record creation.
  SELECT * INTO v_record FROM "api"."create_record"(
    p_project_id, 'file', p_display_name, 'active', ARRAY[]::text[], '{}'::jsonb
  );

  -- Atomic metadata insert. If this fails (constraint, RLS, duplicate key),
  -- the record insert rolls back — no orphan file records.
  INSERT INTO "api"."file_objects"
    (id, workspace_id, record_id, storage_key, display_name, media_type,
     byte_size, checksum, status, storage_backend,
     created_by_user_id, updated_by_user_id)
  VALUES
    (p_file_object_id, v_record.workspace_id, v_record.id, p_storage_key,
     p_display_name, p_media_type, p_byte_size, p_checksum, 'active',
     p_storage_backend,
     "api"."current_user_id"(), "api"."current_user_id"());

  RETURN QUERY
    SELECT v_record.id, v_record.identifier, p_file_object_id, p_storage_key;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_file_upload"(uuid, text, text, bigint, text, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_file_upload"(uuid, text, text, bigint, text, text, text, uuid) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';--> statement-breakpoint
